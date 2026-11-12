import { writable, get } from 'svelte/store'
import * as logsApi from '../api/logs'
import { savingStore } from './saving'
import { showError, showToast } from './toast'
import type { DayLog, LogsByDate, Task } from '../types/models'
import { formatDate } from '../utils/date'
import type { SyncEvent } from './sync'

interface LogsState {
  byDate: LogsByDate
}

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

  const dayOf = (dateStr: string): DayLog => {
    const d = get({ subscribe }).byDate[dateStr]
    return { tasks: d?.tasks ?? [] }
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
      return { tasks }
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
        const server: DayLog = { tasks: log.tasks ?? [] }
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
        reconcile(dateStr, { tasks: log.tasks ?? [] }, !taskWrites.has(dateStr))
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
        reconcile(dateStr, { tasks: res.tasks }, true)
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

  // Removing a task also removes its subtasks.
  function withDescendants(tasks: Task[], id: string): Task[] {
    const ids = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      for (const t of tasks) {
        if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
          ids.add(t.id)
          grew = true
        }
      }
    }
    return tasks.filter((t) => ids.has(t.id))
  }

  // `quiet` skips the undo toast, for a task the user only just started.
  function removeTask(dateStr: string, id: string, opts: { quiet?: boolean } = {}) {
    const all = dayOf(dateStr).tasks
    const task = all.find((t) => t.id === id)
    if (!task) return
    const removed = withDescendants(all, id)
    const removedIds = new Set(removed.map((t) => t.id))
    setDay(dateStr, (d) => ({ ...d, tasks: d.tasks.filter((t) => !removedIds.has(t.id)) }))
    for (const rid of removedIds) {
      dirtyTasks.get(dateStr)?.delete(rid)
      setOf(removedTasks, dateStr).add(rid)
    }
    scheduleTaskWrite(dateStr, true)
    if (opts.quiet) return
    showToast(task.text ? `Deleted “${task.text.slice(0, 40)}”` : 'Task deleted', {
      action: 'Undo',
      duration: UNDO_MS,
      onAction: () => {
        for (const t of removed) upsertTask(dateStr, t, { immediate: true })
      },
    })
  }

  // Copy a task (and its subtasks) to another day as new tasks.
  function copyTaskTree(all: Task[], task: Task, toDate: string) {
    const parent = addTask(toDate, { text: task.text, time: task.time, comment: task.comment })
    for (const child of all.filter((t) => t.parentId === task.id)) {
      addTask(toDate, {
        text: child.text,
        done: child.done,
        comment: child.comment,
        parentId: parent.id,
      })
    }
  }

  // Copy unfinished tasks to another day (as new tasks).
  function carryOver(fromDate: string, toDate: string, ids: string[]) {
    const all = dayOf(fromDate).tasks
    for (const t of all.filter((t) => ids.includes(t.id))) copyTaskTree(all, t, toDate)
  }

  // Move a single task onto the next day.
  function carryTaskOver(dateStr: string, id: string) {
    const all = dayOf(dateStr).tasks
    const task = all.find((t) => t.id === id)
    if (!task) return
    const next = new Date(dateStr + 'T12:00:00')
    next.setDate(next.getDate() + 1)
    copyTaskTree(all, task, formatDate(next))
    removeTask(dateStr, id, { quiet: true })
  }

  // Unsaved task edits (beforeunload guard, focus refresh).
  function hasUnsavedWork(): boolean {
    for (const v of dirtyTasks.values()) if (v.size) return true
    for (const v of removedTasks.values()) if (v.size) return true
    return false
  }

  function flushOnHide() {
    for (const dateStr of [...taskTimers.keys()]) void flushTasks(dateStr)
  }

  // ---- history -----------------------------------------------------------

  async function restoreVersion(dateStr: string, savedAt: number): Promise<boolean> {
    try {
      await flushTasks(dateStr)
      const res = await savingStore.track(logsApi.restoreDayVersion(dateStr, savedAt))
      if (res.tasks) {
        dirtyTasks.get(dateStr)?.clear()
        removedTasks.get(dateStr)?.clear()
        writeEpoch.set(dateStr, (writeEpoch.get(dateStr) ?? 0) + 1)
        setDay(dateStr, (d) => ({ ...d, tasks: res.tasks! }))
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
    carryTaskOver,
    flushTasks,
    hasUnsavedWork,
    flushOnHide,
    restoreVersion,
    applySyncEvent,
  }
}

export const logsStore = createLogsStore()
