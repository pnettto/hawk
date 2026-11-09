import { writable, get } from 'svelte/store'
import * as logsApi from '../api/logs'
import { savingStore } from './saving'
import { showError, showToast } from './toast'
import { DocSession, type DocFields } from '../sync/docSession'
import type { DayLog, DayNote, LogsByDate, Task } from '../types/models'
import { formatDate } from '../utils/date'
import type { SyncEvent } from './sync'

interface LogsState {
  byDate: LogsByDate
}

// The note a day starts with. Fixed id so two devices typing into an empty
// day converge on the same note instead of creating two.
export const DEFAULT_NOTE_ID = 'main'

const TASK_DEBOUNCE_MS = 400
const UNDO_MS = 6000

const inFlight = new Map<string, Promise<DayLog | null>>()

export function sortTasks(tasks: Task[]): Task[] {
  // Timed tasks first, in time order; then untimed in manual order.
  return [...tasks].sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time) || a.order - b.order
    if (a.time) return -1
    if (b.time) return 1
    return a.order - b.order
  })
}

export function sortNotes(notes: DayNote[]): DayNote[] {
  return [...notes].sort((a, b) => a.order - b.order)
}

function createLogsStore() {
  const { subscribe, update } = writable<LogsState>({ byDate: {} })

  // ---- per-date task write state ---------------------------------------
  // Task ids edited locally and not yet acknowledged by the server. Remote
  // data never overwrites these.
  const dirtyTasks = new Map<string, Set<string>>()
  const removedTasks = new Map<string, Set<string>>()
  const taskTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const taskWrites = new Map<string, Promise<void>>()
  const snapshotWanted = new Set<string>()
  // Bumped whenever a task write completes, so a GET that was issued before
  // the write can be recognised as stale when it lands.
  const writeEpoch = new Map<string, number>()

  // Day-note sessions keyed `${date}/${noteId}`.
  const noteSessions = new Map<string, DocSession>()
  const pendingNoteDeletes = new Map<string, ReturnType<typeof setTimeout>>()

  const dayOf = (dateStr: string): DayLog => {
    const d = get({ subscribe }).byDate[dateStr]
    return { tasks: d?.tasks ?? [], notes: d?.notes ?? [] }
  }

  function setDay(dateStr: string, fn: (d: DayLog) => DayLog) {
    update((s) => ({ byDate: { ...s.byDate, [dateStr]: fn(dayOf(dateStr)) } }))
  }

  const setOf = (m: Map<string, Set<string>>, k: string) => {
    let v = m.get(k)
    if (!v) m.set(k, (v = new Set()))
    return v
  }

  // ---- loading -----------------------------------------------------------

  // Fold a server copy of the day into local state without clobbering edits
  // that haven't been acknowledged yet.
  function reconcile(dateStr: string, server: DayLog, tasksFresh: boolean) {
    // Feed open sessions first (outside the store update — they call back
    // into setDay via onChange). They ignore anything not newer than theirs.
    for (const n of server.notes) {
      noteSessions.get(`${dateStr}/${n.id}`)?.receiveRemote({ title: n.title, body: n.markdown }, n.rev)
    }
    setDay(dateStr, (local) => {
      let tasks = local.tasks
      if (tasksFresh) {
        const dirty = dirtyTasks.get(dateStr) ?? new Set()
        const removed = removedTasks.get(dateStr) ?? new Set()
        const localById = new Map(local.tasks.map((t) => [t.id, t]))
        tasks = server.tasks
          .filter((t) => !removed.has(t.id))
          .map((t) => (dirty.has(t.id) && localById.has(t.id) ? localById.get(t.id)! : t))
        for (const id of dirty) {
          if (!tasks.some((t) => t.id === id) && localById.has(id)) tasks.push(localById.get(id)!)
        }
      }

      const notes: DayNote[] = []
      for (const n of server.notes) {
        if (pendingNoteDeletes.has(`${dateStr}/${n.id}`)) continue
        const session = noteSessions.get(`${dateStr}/${n.id}`)
        if (session) {
          const doc = session.local()
          notes.push({ ...n, title: doc.title, markdown: doc.body, rev: Math.max(n.rev, session.rev) })
        } else {
          notes.push(n)
        }
      }
      // Keep local-only notes that haven't reached the server yet.
      for (const n of local.notes) {
        if (notes.some((x) => x.id === n.id)) continue
        const session = noteSessions.get(`${dateStr}/${n.id}`)
        if (session?.hasLocalEdits || n.rev === 0) notes.push(n)
      }
      return { tasks, notes }
    })
  }

  async function loadForDate(dateStr: string, force = false): Promise<DayLog | null> {
    if (!force) {
      const cached = get({ subscribe }).byDate[dateStr]
      if (cached) return cached
    }
    if (inFlight.has(dateStr)) return inFlight.get(dateStr)!

    const epoch = writeEpoch.get(dateStr) ?? 0
    const promise = (async () => {
      try {
        const log = await logsApi.getDayLog(dateStr)
        const server: DayLog = { tasks: log.tasks ?? [], notes: log.notes ?? [] }
        const fresh = (writeEpoch.get(dateStr) ?? 0) === epoch && !taskWrites.has(dateStr)
        reconcile(dateStr, server, fresh)
        return dayOf(dateStr)
      } catch (e) {
        console.error(`Failed to load log for ${dateStr}:`, e)
        return null
      } finally {
        inFlight.delete(dateStr)
      }
    })()
    inFlight.set(dateStr, promise)
    return promise
  }

  function prefetchSurrounding(date: Date) {
    const prev = new Date(date)
    prev.setDate(prev.getDate() - 1)
    const next = new Date(date)
    next.setDate(next.getDate() + 1)
    loadForDate(formatDate(prev))
    loadForDate(formatDate(next))
  }

  async function loadForRange(start: string, end: string): Promise<LogsByDate> {
    try {
      const data = await logsApi.getRangeLog(start, end)
      for (const [dateStr, log] of Object.entries(data)) {
        reconcile(dateStr, { tasks: log.tasks ?? [], notes: log.notes ?? [] }, !taskWrites.has(dateStr))
      }
      return data
    } catch (e) {
      console.error(`Failed to load range ${start} to ${end}:`, e)
      return {}
    }
  }

  // ---- tasks -------------------------------------------------------------

  function scheduleTaskWrite(dateStr: string, immediate = false) {
    savingStore.markPending(`tasks:${dateStr}`)
    const t = taskTimers.get(dateStr)
    if (t) clearTimeout(t)
    taskTimers.set(
      dateStr,
      setTimeout(() => {
        taskTimers.delete(dateStr)
        void flushTasks(dateStr)
      }, immediate ? 0 : TASK_DEBOUNCE_MS),
    )
  }

  async function flushTasks(dateStr: string, opts: { snapshot?: boolean } = {}): Promise<void> {
    const t = taskTimers.get(dateStr)
    if (t) {
      clearTimeout(t)
      taskTimers.delete(dateStr)
    }
    if (opts.snapshot) snapshotWanted.add(dateStr)
    while (taskWrites.has(dateStr)) await taskWrites.get(dateStr)

    const dirty = new Set(dirtyTasks.get(dateStr) ?? [])
    const removed = new Set(removedTasks.get(dateStr) ?? [])
    const snapshot = snapshotWanted.has(dateStr)
    if (!dirty.size && !removed.size && !snapshot) {
      savingStore.clearPending(`tasks:${dateStr}`)
      return
    }
    const day = dayOf(dateStr)
    const upsert = day.tasks.filter((t) => dirty.has(t.id))
    // Snapshot of exactly what we sent, to tell later edits apart.
    const sent = new Map(upsert.map((t) => [t.id, JSON.stringify(t)]))
    snapshotWanted.delete(dateStr)

    const write = (async () => {
      try {
        const res = await savingStore.track(
          logsApi.patchTasks(dateStr, { upsert, remove: [...removed] }, { snapshot }),
        )
        // Acknowledge what was sent unless it was edited again meanwhile.
        const nowDirty = dirtyTasks.get(dateStr)
        const now = new Map(dayOf(dateStr).tasks.map((t) => [t.id, JSON.stringify(t)]))
        for (const [id, json] of sent) if (now.get(id) === json) nowDirty?.delete(id)
        for (const id of removed) removedTasks.get(dateStr)?.delete(id)
        writeEpoch.set(dateStr, (writeEpoch.get(dateStr) ?? 0) + 1)
        reconcile(dateStr, { tasks: res.tasks, notes: dayOf(dateStr).notes }, true)
      } catch (e) {
        console.error(`Failed to save tasks for ${dateStr}:`, e)
        showError('Couldn’t save tasks — retrying…')
        setTimeout(() => scheduleTaskWrite(dateStr, true), 3000)
      }
    })()
    taskWrites.set(dateStr, write)
    await write
    taskWrites.delete(dateStr)
    if (dirtyTasks.get(dateStr)?.size || removedTasks.get(dateStr)?.size) {
      if (!taskTimers.has(dateStr)) scheduleTaskWrite(dateStr)
    } else {
      savingStore.clearPending(`tasks:${dateStr}`)
    }
  }

  function upsertTask(dateStr: string, task: Task, opts: { immediate?: boolean } = {}) {
    setDay(dateStr, (d) => {
      const exists = d.tasks.some((t) => t.id === task.id)
      return {
        ...d,
        tasks: exists ? d.tasks.map((t) => (t.id === task.id ? task : t)) : [...d.tasks, task],
      }
    })
    setOf(dirtyTasks, dateStr).add(task.id)
    removedTasks.get(dateStr)?.delete(task.id)
    scheduleTaskWrite(dateStr, opts.immediate)
  }

  function editTask(dateStr: string, id: string, patch: Partial<Task>, opts: { immediate?: boolean } = {}) {
    const cur = dayOf(dateStr).tasks.find((t) => t.id === id)
    if (!cur) return
    upsertTask(dateStr, { ...cur, ...patch }, opts)
  }

  function addTask(dateStr: string, input: Partial<Task> & { text: string }): Task {
    const tasks = dayOf(dateStr).tasks
    const task: Task = {
      id: crypto.randomUUID(),
      done: false,
      order: Math.max(0, ...tasks.map((t) => t.order)) + 1,
      ...input,
    }
    upsertTask(dateStr, task, { immediate: true })
    return task
  }

  function removeTask(dateStr: string, id: string) {
    const task = dayOf(dateStr).tasks.find((t) => t.id === id)
    if (!task) return
    setDay(dateStr, (d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }))
    dirtyTasks.get(dateStr)?.delete(id)
    setOf(removedTasks, dateStr).add(id)
    scheduleTaskWrite(dateStr, true)
    showToast(task.text ? `Deleted “${task.text.slice(0, 40)}”` : 'Task deleted', {
      action: 'Undo',
      duration: UNDO_MS,
      onAction: () => upsertTask(dateStr, task, { immediate: true }),
    })
  }

  // Copy unfinished tasks to another day (as new tasks).
  function carryOver(fromDate: string, toDate: string, ids: string[]) {
    const src = dayOf(fromDate).tasks.filter((t) => ids.includes(t.id))
    for (const t of src) addTask(toDate, { text: t.text, time: t.time, comment: t.comment })
  }

  // ---- day notes ---------------------------------------------------------

  function noteSession(dateStr: string, noteId: string): DocSession {
    const key = `${dateStr}/${noteId}`
    const existing = noteSessions.get(key)
    if (existing) return existing
    const note = dayOf(dateStr).notes.find((n) => n.id === noteId)
    const session = new DocSession({
      key: `day:${key}`,
      doc: { title: note?.title ?? '', body: note?.markdown ?? '' },
      rev: note?.rev ?? 0,
      save: async (doc, baseRev, opts) => {
        const cur = dayOf(dateStr).notes.find((n) => n.id === noteId)
        const order = cur?.order ?? 0
        const res = await logsApi.saveDayNote(
          dateStr,
          { id: noteId, title: doc.title, markdown: doc.body, order },
          baseRev,
          { snapshot: opts.snapshot, keepalive: opts.keepalive },
        )
        if (res.ok) return { ok: true, rev: res.data.note.rev }
        const remote = res.conflict.note
        return { ok: false, conflict: { doc: { title: remote.title, body: remote.markdown }, rev: remote.rev } }
      },
      onChange: (doc: DocFields) => {
        setDay(dateStr, (d) => {
          const exists = d.notes.some((n) => n.id === noteId)
          const patched = { title: doc.title, markdown: doc.body }
          return {
            ...d,
            notes: exists
              ? d.notes.map((n) => (n.id === noteId ? { ...n, ...patched } : n))
              : [...d.notes, { id: noteId, order: 0, rev: 0, updatedAt: Date.now(), ...patched }],
          }
        })
      },
      onSaved: (_doc, rev) => {
        setDay(dateStr, (d) => ({
          ...d,
          notes: d.notes.map((n) => (n.id === noteId ? { ...n, rev } : n)),
        }))
      },
    })
    noteSessions.set(key, session)
    return session
  }

  function addNote(dateStr: string): string {
    const notes = dayOf(dateStr).notes
    const id = crypto.randomUUID()
    // The default note may only exist virtually (nothing typed yet); give the
    // new one an order after it either way.
    const order = Math.max(0, ...notes.map((n) => n.order)) + 1
    setDay(dateStr, (d) => ({
      ...d,
      notes: [...d.notes, { id, title: '', markdown: '', order, rev: 0, updatedAt: Date.now() }],
    }))
    noteSession(dateStr, id).touch()
    return id
  }

  function renameNote(dateStr: string, noteId: string, title: string) {
    noteSession(dateStr, noteId).setTitle(title)
    setDay(dateStr, (d) => ({
      ...d,
      notes: d.notes.map((n) => (n.id === noteId ? { ...n, title } : n)),
    }))
  }

  // Optimistic delete with an Undo window; the server call fires after it.
  function deleteNote(dateStr: string, noteId: string) {
    const key = `${dateStr}/${noteId}`
    const note = dayOf(dateStr).notes.find((n) => n.id === noteId)
    if (!note) return
    const session = noteSessions.get(key)
    const live = session ? { ...note, title: session.local().title, markdown: session.local().body } : note
    setDay(dateStr, (d) => ({ ...d, notes: d.notes.filter((n) => n.id !== noteId) }))
    const timer = setTimeout(async () => {
      pendingNoteDeletes.delete(key)
      noteSessions.delete(key)
      if (session) await session.dispose()
      try {
        await savingStore.track(logsApi.deleteDayNote(dateStr, noteId))
      } catch (e) {
        console.error('Failed to delete day note', e)
        showError('Failed to delete note.')
        setDay(dateStr, (d) => ({ ...d, notes: [...d.notes, live] }))
      }
    }, UNDO_MS)
    pendingNoteDeletes.set(key, timer)
    showToast(`Deleted “${live.title || 'Untitled'}”`, {
      action: 'Undo',
      duration: UNDO_MS,
      onAction: () => {
        clearTimeout(timer)
        pendingNoteDeletes.delete(key)
        setDay(dateStr, (d) => ({ ...d, notes: [...d.notes, live] }))
      },
    })
  }

  // Unsaved edits anywhere in the journal (beforeunload guard, focus refresh).
  function hasUnsavedWork(): boolean {
    for (const s of noteSessions.values()) if (s.hasLocalEdits) return true
    for (const v of dirtyTasks.values()) if (v.size) return true
    for (const v of removedTasks.values()) if (v.size) return true
    return false
  }

  function flushOnHide() {
    for (const s of noteSessions.values()) s.flushOnHide()
    for (const dateStr of [...taskTimers.keys()]) void flushTasks(dateStr)
  }

  // ---- history -----------------------------------------------------------

  async function restoreVersion(
    dateStr: string,
    target: logsApi.DayHistoryTarget,
    savedAt: number,
  ): Promise<boolean> {
    try {
      if (target.section === 'tasks') await flushTasks(dateStr)
      const res = await savingStore.track(logsApi.restoreDayVersion(dateStr, target, savedAt))
      if (res.tasks) {
        dirtyTasks.get(dateStr)?.clear()
        removedTasks.get(dateStr)?.clear()
        writeEpoch.set(dateStr, (writeEpoch.get(dateStr) ?? 0) + 1)
        setDay(dateStr, (d) => ({ ...d, tasks: res.tasks! }))
      }
      if (res.note && target.section === 'notes') {
        const note = res.note
        setDay(dateStr, (d) => ({
          ...d,
          notes: d.notes.some((n) => n.id === note.id)
            ? d.notes.map((n) => (n.id === note.id ? note : n))
            : [...d.notes, note],
        }))
        noteSessions
          .get(`${dateStr}/${note.id}`)
          ?.receiveRemote({ title: note.title, body: note.markdown }, note.rev, { force: true })
      }
      return true
    } catch (e) {
      console.error('Failed to restore day version:', e)
      return false
    }
  }

  async function applySyncEvent(evt: SyncEvent): Promise<void> {
    if (evt.type !== 'log.saved') return
    // Only refetch if we already have this date loaded — no point pulling a
    // day the user isn't looking at.
    if (!get({ subscribe }).byDate[evt.ref]) return
    await loadForDate(evt.ref, /* force */ true)
  }

  return {
    subscribe,
    loadForDate,
    loadForRange,
    prefetchSurrounding,
    addTask,
    editTask,
    removeTask,
    carryOver,
    flushTasks,
    noteSession,
    addNote,
    renameNote,
    deleteNote,
    hasUnsavedWork,
    flushOnHide,
    restoreVersion,
    applySyncEvent,
  }
}

export const logsStore = createLogsStore()
