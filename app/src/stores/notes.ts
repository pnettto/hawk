import { writable, get } from 'svelte/store'
import * as notesApi from '../api/notes'
import { ApiError } from '../api/client'
import { showError, showToast } from './toast'
import { savingStore } from './saving'
import { DocSession, type DocFields } from '../sync/docSession'
import { parseTags, TAG_LINE_RE } from '../lib/notes/tags'
import type { Note, NoteMetadata } from '../types/models'
import type { SyncEvent } from './sync'

// What the Notepad list shows. "day" is the fixed Day Notes view.
export type NotesFilter =
  | { kind: 'all' }
  | { kind: 'day' }
  | { kind: 'tag'; tag: string }
  | { kind: 'trash' }

interface NotesState {
  // Metadata index of every note, trashed ones included. Notes whose body has
  // been loaded also carry `content` and `rev`.
  allNotes: NoteMetadata[]
  selectedNid: string | null
  filter: NotesFilter
  // How All notes and tag views are ordered: last edit or creation.
  sort: NotesSort
  loaded: boolean
}

export type NotesSort = 'changed' | 'added'

const FILTER_KEY = 'hawk_notes_filter'

function readFilter(): NotesFilter {
  try {
    const f = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null') as NotesFilter | null
    if (f && (f.kind === 'all' || f.kind === 'day' || f.kind === 'trash')) return { kind: f.kind }
    if (f?.kind === 'tag' && typeof f.tag === 'string') return f
  } catch {
    // Storage unavailable — fall back to the default view.
  }
  return { kind: 'all' }
}

function writeFilter(f: NotesFilter) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(f))
  } catch {
    // Not worth surfacing.
  }
}

const SORT_KEY = 'hawk_notes_sort'

function readSort(): NotesSort {
  try {
    return localStorage.getItem(SORT_KEY) === 'added' ? 'added' : 'changed'
  } catch {
    return 'changed'
  }
}

// The id of a day's first note. Fixed so two devices typing into an empty day
// converge on one note. Mirrors server/utils/notesStore.ts:dayNoteId.
export const dayNoteId = (dateStr: string) => `day-${dateStr}`

// Notes that only exist on this device as an empty placeholder for a day.
// They stay out of Notepad until something is typed.
export const isDayDraft = (n: NoteMetadata) => !!(n.local && n.day)

export function sortDayNotes<T extends NoteMetadata>(notes: T[]): T[] {
  return [...notes].sort((a, b) => (a.dayOrder ?? 0) - (b.dayOrder ?? 0) || a.createdAt - b.createdAt)
}

// Tag -> number of live notes carrying it, most used first.
export function tagCounts(notes: NoteMetadata[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const n of notes) {
    if (n.deletedAt || isDayDraft(n)) continue
    for (const t of n.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

// "Mon, Nov 9, 2026" — what an untitled day note is called.
export function dayLabel(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export const noteLabel = (n: NoteMetadata) => n.title.trim() || (n.day ? dayLabel(n.day) : 'Untitled')

// Mirrors server/utils/notesStore.ts:buildPreview — kept in sync so the list
// updates instantly on edit instead of waiting for a server round-trip (and
// our own writes' sync events get echo-suppressed, so the server preview
// would never make it back here anyway).
export function buildPreview(markdown: string | undefined, max = 140): string {
  if (!markdown) return ''
  const stripped = markdown
    .replace(TAG_LINE_RE, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\\([\\`*_{}\[\]()#+\-.!~>|])/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.length > max ? stripped.slice(0, max).trimEnd() + '…' : stripped
}

// Tracks notes mid-mutation so a server refresh can't resurrect them between
// the optimistic update and the request finishing.
const inFlightOps = new Set<string>()

// One sync session per note whose body has been loaded. Sessions outlive the
// editor mount so switching notes never drops a pending save, and a remote
// update for a background note still lands in the right place.
const sessions = new Map<string, DocSession>()

function createNotesStore() {
  const { subscribe, update } = writable<NotesState>({
    allNotes: [],
    selectedNid: null,
    filter: readFilter(),
    sort: readSort(),
    loaded: false,
  })

  // Pending destructive operations awaiting Undo expiry. Keyed by op id; on
  // expiry the server call fires; on undo we just revert local state.
  const pendingDestructive = new Map<string, ReturnType<typeof setTimeout>>()
  const UNDO_MS = 6000

  const find = (nid: string) => get({ subscribe }).allNotes.find((n) => n.id === nid) as Note | undefined

  // Fold the server's index into local state. Bodies already loaded are kept
  // unless the server has a newer version and no editor holds the note;
  // notes missing on the server are dropped unless they're still local-only
  // or mid-mutation.
  function mergeIndex(local: NoteMetadata[], fresh: NoteMetadata[]): NoteMetadata[] {
    const localById = new Map(local.map((n) => [n.id, n as Note]))
    const out: NoteMetadata[] = []
    for (const f of fresh) {
      const l = localById.get(f.id)
      localById.delete(f.id)
      if (!l) {
        out.push(f)
        continue
      }
      if (inFlightOps.has(f.id)) {
        out.push(l)
        continue
      }
      const session = sessions.get(f.id)
      const merged: Note = { ...(f as Note) }
      if (l.content !== undefined && (session || (f.updatedAt || 0) <= (l.updatedAt || 0))) {
        merged.content = l.content
        merged.rev = l.rev
      }
      // Unsaved typing wins for what the list shows.
      if (session?.hasLocalEdits) {
        merged.title = l.title
        merged.preview = l.preview
        merged.tags = l.tags
        merged.updatedAt = l.updatedAt
      }
      out.push(merged)
    }
    for (const l of localById.values()) {
      if (l.local || inFlightOps.has(l.id) || sessions.get(l.id)?.hasLocalEdits) out.push(l)
    }
    return out
  }

  async function load() {
    try {
      const fresh = await notesApi.getNotesIndex()
      update((s) => ({ ...s, allNotes: mergeIndex(s.allNotes, Array.isArray(fresh) ? fresh : []), loaded: true }))
    } catch (e) {
      console.error('[notes] load failed', e)
    }
  }

  async function refresh() {
    if (hasUnsavedWork()) await flushSaves()
    await load()
    // Also re-fetch the open note's body. The session ignores anything not
    // newer than what it has, so a slow response can't roll the editor back.
    const nid = get({ subscribe }).selectedNid
    if (nid && sessions.has(nid)) await refetchNote(nid)
  }

  // Pull one note after a remote change.
  async function refetchNote(nid: string) {
    let full: Note
    try {
      full = await notesApi.getNote(nid)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) removeLocal(nid)
      else console.error('[notes] refetch failed', e)
      return
    }
    if (inFlightOps.has(nid) || pendingDestructive.has(`perm-del:${nid}`)) return
    const session = sessions.get(nid)
    update((s) => {
      const meta: Note = { ...full, preview: buildPreview(full.content) }
      const exists = s.allNotes.some((n) => n.id === nid)
      const allNotes = exists
        ? s.allNotes.map((n) => {
            if (n.id !== nid) return n
            // An open session owns title/body; it gets them via receiveRemote.
            if (!session) return meta
            const cur = n as Note
            return { ...meta, title: cur.title, content: cur.content, rev: cur.rev, preview: cur.preview, tags: cur.tags }
          })
        : [...s.allNotes, meta]
      return { ...s, allNotes }
    })
    session?.receiveRemote(docOf(full), full.rev ?? 0)
  }

  function removeLocal(nid: string) {
    update((s) => ({
      ...s,
      allNotes: s.allNotes.filter((n) => n.id !== nid),
      selectedNid: s.selectedNid === nid ? null : s.selectedNid,
    }))
    dropSession(nid)
  }

  async function applySyncEvent(evt: SyncEvent): Promise<void> {
    // Defense in depth — server already filters by originClientId.
    if (inFlightOps.has(evt.ref)) return
    switch (evt.type) {
      case 'note.saved':
      case 'note.trashed':
      case 'note.restored':
        await refetchNote(evt.ref)
        break
      case 'note.deleted':
        removeLocal(evt.ref)
        break
      case 'trash.emptied':
        update((s) => ({ ...s, allNotes: s.allNotes.filter((n) => !n.deletedAt || inFlightOps.has(n.id)) }))
        await load()
        break
    }
  }

  const docOf = (n: Note): DocFields => ({ title: n.title ?? '', body: n.content ?? '' })

  function dropSession(nid: string) {
    const session = sessions.get(nid)
    if (!session) return
    sessions.delete(nid)
    void session.dispose()
  }

  function patchNote(nid: string, patch: Partial<Note>) {
    update((s) => ({
      ...s,
      allNotes: s.allNotes.map((n) => (n.id === nid ? { ...n, ...patch } : n)),
    }))
  }

  // Get (or create) the sync session for a note whose content is loaded.
  function sessionFor(nid: string): DocSession | null {
    const existing = sessions.get(nid)
    if (existing) return existing
    const note = find(nid)
    if (!note || note.content === undefined) return null
    const session = new DocSession({
      key: `note:${nid}`,
      doc: docOf(note),
      rev: note.rev ?? 0,
      save: async (doc, baseRev, opts) => {
        const cur = find(nid)
        if (!cur) return { ok: true, rev: baseRev }
        const res = await notesApi.saveNoteChecked(
          {
            id: nid,
            title: doc.title,
            content: doc.body,
            createdAt: cur.createdAt,
            day: cur.day,
            dayOrder: cur.dayOrder,
          },
          baseRev,
          { snapshot: opts.snapshot, keepalive: opts.keepalive },
        )
        if (res.ok) return { ok: true, rev: res.data.rev ?? baseRev + 1 }
        const remote = res.conflict.note as Note
        return { ok: false, conflict: { doc: docOf(remote), rev: remote.rev ?? 0 } }
      },
      onChange: (doc) => {
        patchNote(nid, {
          title: doc.title,
          content: doc.body,
          preview: buildPreview(doc.body),
          tags: parseTags(doc.body),
          updatedAt: Date.now(),
        })
      },
      onSaved: (_doc, rev) => patchNote(nid, { rev, local: undefined }),
    })
    sessions.set(nid, session)
    return session
  }

  function setFilter(filter: NotesFilter) {
    writeFilter(filter)
    update((s) => ({ ...s, filter, selectedNid: null }))
  }

  function setSort(sort: NotesSort) {
    try {
      localStorage.setItem(SORT_KEY, sort)
    } catch {
      // Not worth surfacing.
    }
    update((s) => ({ ...s, sort }))
  }

  function clearSelectedNote() {
    const prev = get({ subscribe }).selectedNid
    if (prev) void sessions.get(prev)?.flush()
    update((s) => ({ ...s, selectedNid: null }))
  }

  // Make sure a note's body is loaded so an editor can open it.
  async function loadBody(nid: string) {
    const note = find(nid)
    if (!note || note.content !== undefined) return
    const full = await notesApi.getNote(nid)
    if (full) patchNote(nid, { ...full, preview: buildPreview(full.content) })
  }

  async function selectNote(nid: string) {
    // Moving on from the previous note — save what's pending there now.
    const prev = get({ subscribe }).selectedNid
    if (prev && prev !== nid) void sessions.get(prev)?.flush()
    update((s) => ({ ...s, selectedNid: nid }))
    try {
      await loadBody(nid)
    } catch (e) {
      console.error('[notes] failed to load note', e)
      showError('Failed to open note.')
    }
  }

  // New note, saved right away. A tag lands on the note's last line; `day`
  // makes it a journal note for that date.
  function createNote(opts: { tag?: string; day?: string; dayOrder?: number; select?: boolean } = {}): string {
    const nid = crypto.randomUUID()
    const content = opts.tag ? `#${opts.tag}` : ''
    const note: Note = {
      id: nid,
      title: '',
      content,
      tags: parseTags(content),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      local: true,
    }
    if (opts.day) {
      note.day = opts.day
      note.dayOrder = opts.dayOrder ?? 0
    }
    update((s) => ({
      ...s,
      allNotes: [note, ...s.allNotes],
      selectedNid: opts.select === false ? s.selectedNid : nid,
    }))
    sessionFor(nid)?.touch()
    return nid
  }

  // A day with no notes still shows one to type into. It's a local draft
  // under the day's fixed id, saved once something is written.
  function ensureDayDraft(dateStr: string) {
    const s = get({ subscribe })
    if (!s.loaded) return
    if (s.allNotes.some((n) => n.day === dateStr && !n.deletedAt)) return
    // The fixed id may belong to a trashed note.
    const taken = s.allNotes.some((n) => n.id === dayNoteId(dateStr))
    const id = taken ? `${dayNoteId(dateStr)}-${crypto.randomUUID().slice(0, 8)}` : dayNoteId(dateStr)
    const now = Date.now()
    const draft: Note = { id, title: '', content: '', tags: [], day: dateStr, dayOrder: 0, createdAt: now, updatedAt: now, local: true }
    update((st) => ({ ...st, allNotes: [...st.allNotes, draft] }))
  }

  // Title edits go through the session so they're saved (and merged) with
  // the body. The list updates immediately.
  function setTitle(nid: string, title: string) {
    patchNote(nid, { title, updatedAt: Date.now() })
    sessionFor(nid)?.setTitle(title)
  }

  // Share toggle: a metadata-only save. The server keeps the body and doesn't
  // bump the text revision, so it can't conflict with an open editor.
  async function setPublic(nid: string, isPublic: boolean) {
    const note = find(nid)
    if (!note) return
    await sessions.get(nid)?.flush()
    patchNote(nid, { isPublic })
    try {
      await savingStore.track(notesApi.saveNote({ id: nid, isPublic }))
    } catch (e) {
      console.error('Failed to update sharing', e)
      patchNote(nid, { isPublic: !isPublic })
      showError('Failed to update sharing.')
    }
  }

  function hasUnsavedWork() {
    for (const s of sessions.values()) if (s.hasLocalEdits) return true
    return false
  }

  async function flushSaves(): Promise<void> {
    await Promise.all(Array.from(sessions.values()).map((s) => s.flush()))
  }

  // Page is being hidden/closed: drafts + keepalive saves for every note.
  function flushOnHide() {
    for (const s of sessions.values()) s.flushOnHide()
  }

  // Saves pending edits and records a version-history checkpoint. `force`
  // checkpoints even without edits since the last one (history popover).
  async function triggerSnapshot(nid: string, force = false) {
    // Nothing to checkpoint on a day placeholder nobody has typed into.
    const note = find(nid)
    if (note && isDayDraft(note) && !sessions.get(nid)?.hasLocalEdits) return
    await sessionFor(nid)?.flush({ snapshot: true, force })
  }

  async function restoreVersion(nid: string, savedAt: number): Promise<boolean> {
    try {
      const res = (await savingStore.track(notesApi.restoreNoteVersion(nid, savedAt))) as
        | { success: boolean; note: Note }
        | undefined
      if (res?.note) {
        patchNote(nid, { ...res.note, preview: buildPreview(res.note.content) })
        sessions.get(nid)?.receiveRemote(docOf(res.note), res.note.rev ?? 0, { force: true })
      }
      return true
    } catch (e) {
      console.error('Failed to restore note version', e)
      showError('Failed to restore version.')
      return false
    }
  }

  function trashNote(nid: string) {
    trashNotes([nid])
  }

  // Move several notes to trash at once, with one toast and one Undo.
  function trashNotes(nids: string[]) {
    const notes = nids.map((id) => find(id)).filter((n): n is Note => !!n && !n.deletedAt)
    if (notes.length === 0) return
    const ids = new Set(notes.map((n) => n.id))
    const original = JSON.parse(JSON.stringify(get({ subscribe }).allNotes)) as NoteMetadata[]
    for (const id of ids) inFlightOps.add(id)
    const now = Date.now()
    update((s) => ({
      ...s,
      allNotes: s.allNotes.map((n) => (ids.has(n.id) ? { ...n, deletedAt: now } : n)),
      selectedNid: s.selectedNid && ids.has(s.selectedNid) ? null : s.selectedNid,
    }))
    // Land pending typing first, so a note that was never saved exists to trash.
    Promise.all(
      notes.map((n) => Promise.resolve(sessions.get(n.id)?.flush()).then(() => notesApi.trashNote(n.id))),
    )
      .then(() => {
        for (const id of ids) inFlightOps.delete(id)
        const msg = notes.length === 1 ? `Moved “${noteLabel(notes[0])}” to trash` : `Moved ${notes.length} notes to trash`
        showToast(msg, {
          action: 'Undo',
          duration: UNDO_MS,
          onAction: () => {
            for (const id of ids) restoreNote(id)
          },
        })
      })
      .catch((e) => {
        console.error('Failed to trash note:', e)
        for (const id of ids) inFlightOps.delete(id)
        update((s) => ({ ...s, allNotes: original }))
        showError(notes.length === 1 ? 'Failed to delete note.' : 'Failed to delete notes.')
      })
  }

  function restoreNote(nid: string) {
    const original = JSON.parse(JSON.stringify(get({ subscribe }).allNotes)) as NoteMetadata[]
    inFlightOps.add(nid)
    update((s) => ({
      ...s,
      allNotes: s.allNotes.map((n) => {
        if (n.id !== nid) return n
        const { deletedAt: _drop, ...rest } = n
        return rest as NoteMetadata
      }),
    }))
    notesApi
      .restoreNote(nid)
      .then(() => inFlightOps.delete(nid))
      .catch((e) => {
        console.error('Failed to restore note:', e)
        inFlightOps.delete(nid)
        update((s) => ({ ...s, allNotes: original }))
        showError('Failed to restore note.')
      })
  }

  function permanentlyDeleteNote(nid: string) {
    const cur = get({ subscribe })
    const removed = cur.allNotes.find((n) => n.id === nid)
    if (!removed) return
    const originalNotes = JSON.parse(JSON.stringify(cur.allNotes)) as NoteMetadata[]
    const originalSelectedNid = cur.selectedNid

    inFlightOps.add(nid)
    update((s) => ({
      ...s,
      allNotes: s.allNotes.filter((n) => n.id !== nid),
      selectedNid: s.selectedNid === nid ? null : s.selectedNid,
    }))

    const opKey = `perm-del:${nid}`
    let undone = false

    const timer = setTimeout(() => {
      pendingDestructive.delete(opKey)
      if (undone) return
      dropSession(nid)
      notesApi
        .permanentlyDeleteNote(nid)
        .then(() => inFlightOps.delete(nid))
        .catch((e) => {
          console.error('Failed to permanently delete note:', e)
          inFlightOps.delete(nid)
          update((s) => ({ ...s, allNotes: originalNotes }))
          showError('Failed to delete note.')
        })
    }, UNDO_MS)
    pendingDestructive.set(opKey, timer)

    showToast(`Deleted “${noteLabel(removed)}”`, {
      action: 'Undo',
      duration: UNDO_MS,
      onAction: () => {
        undone = true
        clearTimeout(timer)
        pendingDestructive.delete(opKey)
        inFlightOps.delete(nid)
        update((s) => ({ ...s, allNotes: originalNotes, selectedNid: originalSelectedNid }))
      },
    })
  }

  function emptyTrash() {
    const cur = get({ subscribe })
    const trashed = cur.allNotes.filter((n) => !!n.deletedAt)
    if (trashed.length === 0) return
    const original = JSON.parse(JSON.stringify(cur.allNotes)) as NoteMetadata[]

    update((s) => ({ ...s, allNotes: s.allNotes.filter((n) => !n.deletedAt) }))

    const opKey = `empty-trash`
    let undone = false

    const timer = setTimeout(async () => {
      pendingDestructive.delete(opKey)
      if (undone) return
      for (const n of trashed) dropSession(n.id)
      try {
        await notesApi.emptyTrash()
      } catch (e) {
        console.error('Failed to empty trash:', e)
        update((s) => ({ ...s, allNotes: original }))
        showError('Failed to empty trash.')
      }
    }, UNDO_MS)
    pendingDestructive.set(opKey, timer)

    showToast(`Emptied trash (${trashed.length})`, {
      action: 'Undo',
      duration: UNDO_MS,
      onAction: () => {
        undone = true
        clearTimeout(timer)
        pendingDestructive.delete(opKey)
        update((s) => ({ ...s, allNotes: original }))
      },
    })
  }

  return {
    subscribe,
    load,
    refresh,
    setFilter,
    setSort,
    selectNote,
    clearSelectedNote,
    loadBody,
    createNote,
    ensureDayDraft,
    setTitle,
    setPublic,
    sessionFor,
    flushSaves,
    flushOnHide,
    triggerSnapshot,
    restoreVersion,
    trashNote,
    trashNotes,
    restoreNote,
    permanentlyDeleteNote,
    emptyTrash,
    hasUnsavedWork,
    applySyncEvent,
  }
}

export const notesStore = createNotesStore()
