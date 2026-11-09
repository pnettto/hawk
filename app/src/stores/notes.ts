import { writable, get } from 'svelte/store'
import * as notesApi from '../api/notes'
import { showError, showToast } from './toast'
import { savingStore } from './saving'
import { DocSession, type DocFields } from '../sync/docSession'
import type { Collection, Note, NoteMetadata } from '../types/models'
import type { SyncEvent } from './sync'

export type NotesView = 'collection' | 'all' | 'trash'

interface NotesState {
  collections: Collection[]
  // Metadata-only index of every note in every collection. The selected note's
  // entry may also carry full content (merged in by selectNote/saveNote).
  allNotes: NoteMetadata[]
  selectedCid: string | null
  selectedNid: string | null
  view: NotesView
  loaded: boolean
}

// Tracks notes mid-mutation so a server refresh can't resurrect them between
// the optimistic update and the request finishing.
const inFlightOps = new Set<string>()

// Mirrors server/routeHandlers/notes.ts:buildPreview — kept in sync so the
// list updates instantly on edit instead of waiting for a server round-trip
// (and our own writes' sync events get echo-suppressed, so the server preview
// would never make it back here anyway).
function buildPreview(markdown: string | undefined, max = 140): string {
  if (!markdown) return ''
  const stripped = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\\([\\`*_{}\[\]()#+\-.!~>|])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.length > max ? stripped.slice(0, max).trimEnd() + '…' : stripped
}

// One sync session per note whose body has been loaded. Sessions outlive the
// editor mount so switching notes never drops a pending save, and a remote
// update for a background note still lands in the right place.
const sessions = new Map<string, DocSession>()

function createNotesStore() {
  const { subscribe, update } = writable<NotesState>({
    collections: [],
    allNotes: [],
    selectedCid: null,
    selectedNid: null,
    view: 'collection',
    loaded: false,
  })

  // Pending destructive operations awaiting Undo expiry. Keyed by op id; on
  // expiry the server call fires; on undo we just revert local state.
  const pendingDestructive = new Map<string, ReturnType<typeof setTimeout>>()
  const UNDO_MS = 6000

  async function load() {
    try {
      const [collections, fullIndex] = await Promise.all([
        notesApi.getCollections(),
        notesApi.getNotesIndex(),
      ])
      update((s) => {
        const fresh = Array.isArray(fullIndex) ? fullIndex : []
        // Preserve already-loaded `content` for any note still in the index.
        // Without this, navigating away and back to /notes would clobber the
        // selected note's body with metadata-only data, and any snapshot
        // trigger that fires before the body is refetched would save an
        // empty version over the real one.
        const localById = new Map(s.allNotes.map((n) => [n.id, n as Note]))
        const allNotes = fresh.map((sn) => {
          const local = localById.get(sn.id)
          // Keep fields the index doesn't carry (body, rev) so returning to
          // the page doesn't drop them.
          return local && local.content !== undefined
            ? ({
                ...sn,
                content: local.content,
                rev: local.rev,
                isPublic: (sn as Note).isPublic ?? local.isPublic,
              } as NoteMetadata)
            : sn
        })
        const selectedCid =
          s.selectedCid && collections.find((c) => c.id === s.selectedCid)
            ? s.selectedCid
            : collections[0]?.id ?? null
        return { ...s, collections, allNotes, selectedCid, loaded: true }
      })
    } catch (e) {
      console.error('[notes] load failed', e)
    }
  }

  // Last-write-wins merge of a fresh server-side metadata list into the local
  // allNotes. Used by both refresh() and applySyncEvent. If `restrictToCids`
  // is set, only entries in those cids are subject to deletion when missing
  // from the fresh list (so a per-collection refresh doesn't wipe other cids).
  function mergeIndexInto(
    local: NoteMetadata[],
    fresh: NoteMetadata[],
    restrictToCids: string[] | null = null,
  ): NoteMetadata[] {
    const localMap = new Map(local.map((n) => [n.id, n]))
    if (restrictToCids) {
      const cidSet = new Set(restrictToCids)
      const freshIds = new Set(fresh.map((n) => n.id))
      for (const [id, n] of localMap) {
        if (cidSet.has(n.cid) && !freshIds.has(id) && !inFlightOps.has(id)) {
          localMap.delete(id)
        }
      }
    }
    for (const sn of fresh) {
      if (inFlightOps.has(sn.id)) continue
      const local = localMap.get(sn.id)
      if (local) {
        if ((sn.updatedAt || 0) >= (local.updatedAt || 0)) {
          localMap.set(sn.id, { ...local, ...sn })
        }
      } else {
        localMap.set(sn.id, sn)
      }
    }
    return Array.from(localMap.values())
  }

  async function refresh() {
    if (hasUnsavedWork()) await flushSaves()
    try {
      const [collections, fullIndex] = await Promise.all([
        notesApi.getCollections(),
        notesApi.getNotesIndex(),
      ])
      update((s) => {
        const serverIndex = Array.isArray(fullIndex) ? fullIndex : []
        const allNotes = mergeIndexInto(s.allNotes, serverIndex)
        const selectedCid =
          s.selectedCid && collections.find((c) => c.id === s.selectedCid)
            ? s.selectedCid
            : collections[0]?.id ?? null
        return { ...s, collections, allNotes, selectedCid }
      })

      // Also re-fetch the open note's full content (titles/dates may have changed).
      // The session ignores anything not newer than what it has, so a slow
      // response can't roll the editor back.
      const cur = get({ subscribe })
      const session = cur.selectedNid ? sessions.get(cur.selectedNid) : null
      if (cur.selectedNid && session) {
        const fullNote = await notesApi.getNote(cur.selectedNid)
        if (fullNote) session.receiveRemote(docOf(fullNote), fullNote.rev ?? 0)
      }
    } catch (e) {
      console.error('[notes] refresh failed', e)
    }
  }

  // Re-fetch one collection's slice of allNotes (active + trashed) and merge
  // last-write-wins. Used by applySyncEvent so a single remote write only
  // costs one collection refetch, not a full index reload.
  async function refetchCollectionSlice(cid: string): Promise<void> {
    try {
      const [active, trash] = await Promise.all([
        notesApi.getCollectionNotes(cid).catch(() => [] as NoteMetadata[]),
        notesApi.getTrash(cid).catch(() => [] as NoteMetadata[]),
      ])
      const fresh = [...active, ...trash]
      update((s) => ({
        ...s,
        allNotes: mergeIndexInto(s.allNotes, fresh, [cid]),
      }))
    } catch (e) {
      console.error('[notes] refetchCollectionSlice failed', e)
    }
  }

  async function applySyncEvent(evt: SyncEvent): Promise<void> {
    // Defense in depth — server already filters by originClientId.
    if (inFlightOps.has(evt.ref)) return

    switch (evt.type) {
      case 'note.saved': {
        if (!evt.cid) return
        // Don't resurrect a note we're about to permanently delete.
        if (pendingDestructive.has(`perm-del:${evt.ref}`)) return
        await refetchCollectionSlice(evt.cid)
        const session = sessions.get(evt.ref)
        if (session) {
          try {
            const full = await notesApi.getNote(evt.ref)
            if (full) session.receiveRemote(docOf(full), full.rev ?? 0)
          } catch (e) {
            console.error('[notes] applySyncEvent getNote failed', e)
          }
        } else {
          // Not open anywhere — drop any cached body so the next open
          // fetches the fresh one.
          update((s) => ({
            ...s,
            allNotes: s.allNotes.map((n) => {
              if (n.id !== evt.ref || (n as Note).content === undefined) return n
              const { content: _c, ...meta } = n as Note
              return meta
            }),
          }))
        }
        break
      }
      case 'note.trashed':
      case 'note.restored': {
        if (!evt.cid) return
        await refetchCollectionSlice(evt.cid)
        break
      }
      case 'note.deleted': {
        if (!evt.cid) return
        update((s) => ({
          ...s,
          allNotes: s.allNotes.filter((n) => n.id !== evt.ref),
          selectedNid: s.selectedNid === evt.ref ? null : s.selectedNid,
        }))
        dropSession(evt.ref)
        break
      }
      case 'trash.emptied': {
        if (!evt.cid) return
        // Drop everything trashed in this collection, then reconcile.
        update((s) => ({
          ...s,
          allNotes: s.allNotes.filter(
            (n) => !(n.cid === evt.cid && !!n.deletedAt),
          ),
        }))
        await refetchCollectionSlice(evt.cid)
        break
      }
      case 'collection.saved': {
        try {
          const collections = await notesApi.getCollections()
          update((s) => {
            const selectedCid =
              s.selectedCid && collections.find((c) => c.id === s.selectedCid)
                ? s.selectedCid
                : collections[0]?.id ?? null
            return { ...s, collections, selectedCid }
          })
        } catch (e) {
          console.error('[notes] applySyncEvent collection.saved failed', e)
        }
        break
      }
      case 'collection.deleted': {
        try {
          const collections = await notesApi.getCollections()
          update((s) => {
            const allNotes = evt.cid
              ? s.allNotes.filter((n) => n.cid !== evt.cid)
              : s.allNotes
            const selectedCid =
              s.selectedCid && collections.find((c) => c.id === s.selectedCid)
                ? s.selectedCid
                : collections[0]?.id ?? null
            const selectedNid =
              s.selectedNid &&
              !allNotes.find((n) => n.id === s.selectedNid)
                ? null
                : s.selectedNid
            return { ...s, collections, allNotes, selectedCid, selectedNid }
          })
        } catch (e) {
          console.error('[notes] applySyncEvent collection.deleted failed', e)
        }
        break
      }
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
    const note = get({ subscribe }).allNotes.find((n) => n.id === nid) as Note | undefined
    if (!note || note.content === undefined) return null
    const session = new DocSession({
      key: `note:${nid}`,
      doc: docOf(note),
      rev: note.rev ?? 0,
      save: async (doc, baseRev, opts) => {
        const cur = get({ subscribe }).allNotes.find((n) => n.id === nid)
        if (!cur) return { ok: true, rev: baseRev }
        const res = await notesApi.saveNoteChecked(
          { id: nid, cid: cur.cid, title: doc.title, content: doc.body, createdAt: cur.createdAt },
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
          updatedAt: Date.now(),
        })
      },
      onSaved: (_doc, rev) => patchNote(nid, { rev }),
    })
    sessions.set(nid, session)
    return session
  }

  function selectCollection(cid: string) {
    update((s) => ({ ...s, selectedCid: cid, selectedNid: null, view: 'collection' }))
  }

  function selectAllNotes() {
    update((s) => ({ ...s, selectedNid: null, view: 'all' }))
  }

  function selectTrash() {
    update((s) => ({ ...s, selectedNid: null, view: 'trash' }))
  }

  function clearSelectedNote() {
    const prev = get({ subscribe }).selectedNid
    if (prev) void sessions.get(prev)?.flush()
    update((s) => ({ ...s, selectedNid: null }))
  }

  async function selectNote(nid: string) {
    // Moving on from the previous note — save what's pending there now.
    const prev = get({ subscribe }).selectedNid
    if (prev && prev !== nid) void sessions.get(prev)?.flush()
    update((s) => ({ ...s, selectedNid: nid }))
    const cur = get({ subscribe })
    const note = cur.allNotes.find((n) => n.id === nid) as Note | undefined
    if (note && note.content === undefined) {
      const full = await notesApi.getNote(nid)
      if (full) {
        update((s) => {
          if (s.selectedNid !== nid) return s
          const allNotes = s.allNotes.map((n) => (n.id === nid ? { ...n, ...full } : n))
          return { ...s, allNotes }
        })
      }
    }
  }

  async function createCollection(name: string): Promise<string | null> {
    const trimmed = name.trim()
    if (!trimmed) return null
    const cid = crypto.randomUUID()
    const next: Collection = { id: cid, name: trimmed }
    update((s) => ({ ...s, collections: [...s.collections, next], selectedCid: cid, view: 'collection' }))
    try {
      const cur = get({ subscribe })
      await notesApi.saveCollections(cur.collections)
      return cid
    } catch (e) {
      console.error('Failed to create collection:', e)
      showError('Failed to create collection.')
      return null
    }
  }

  async function renameCollection(cid: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const original = get({ subscribe })
    update((s) => ({
      ...s,
      collections: s.collections.map((c) => (c.id === cid ? { ...c, name: trimmed } : c)),
    }))
    try {
      const cur = get({ subscribe })
      await notesApi.saveCollections(cur.collections)
    } catch (e) {
      console.error('Failed to rename collection:', e)
      update(() => original)
      showError('Failed to rename collection.')
    }
  }

  function deleteCollection(cid: string) {
    const original = get({ subscribe })
    const removed = original.collections.find((c) => c.id === cid)
    if (!removed) return

    update((s) => {
      const collections = s.collections.filter((c) => c.id !== cid)
      const allNotes = s.allNotes.filter((n) => n.cid !== cid)
      const selectedCid =
        s.selectedCid === cid ? collections[0]?.id ?? null : s.selectedCid
      const selectedNid = s.selectedCid === cid ? null : s.selectedNid
      return { ...s, collections, allNotes, selectedCid, selectedNid }
    })

    const opKey = `del-coll:${cid}`
    let undone = false

    const timer = setTimeout(async () => {
      pendingDestructive.delete(opKey)
      if (undone) return
      try {
        await notesApi.deleteCollection(cid)
      } catch (e) {
        console.error('Failed to delete collection:', e)
        update(() => original)
        showError('Failed to delete collection.')
      }
    }, UNDO_MS)
    pendingDestructive.set(opKey, timer)

    showToast(`Deleted "${removed.name}"`, {
      action: 'Undo',
      duration: UNDO_MS,
      onAction: () => {
        undone = true
        clearTimeout(timer)
        pendingDestructive.delete(opKey)
        update(() => original)
      },
    })
  }

  function createNote(): string | null {
    const cur = get({ subscribe })
    if (!cur.selectedCid) return null
    const nid = crypto.randomUUID()
    const newNote: Note = {
      id: nid,
      cid: cur.selectedCid,
      title: 'Untitled',
      content: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    update((s) => ({
      ...s,
      allNotes: [newNote, ...s.allNotes],
      selectedNid: nid,
    }))
    sessionFor(nid)?.touch()
    return nid
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
    const note = get({ subscribe }).allNotes.find((n) => n.id === nid)
    if (!note) return
    patchNote(nid, { isPublic })
    try {
      await savingStore.track(notesApi.saveNote({ id: nid, cid: note.cid, title: note.title, isPublic }))
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
    await sessionFor(nid)?.flush({ snapshot: true, force })
  }

  async function restoreVersion(nid: string, savedAt: number): Promise<boolean> {
    try {
      const res = await savingStore.track(
        notesApi.restoreNoteVersion(nid, savedAt),
      ) as { success: boolean; note: Note } | undefined
      if (res?.note) {
        patchNote(nid, res.note)
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
    const cur = get({ subscribe })
    const note = cur.allNotes.find((n) => n.id === nid)
    if (!note) return
    const original = JSON.parse(JSON.stringify(cur.allNotes)) as NoteMetadata[]
    inFlightOps.add(nid)
    update((s) => {
      const allNotes = s.allNotes.map((n) =>
        n.id === nid ? { ...n, deletedAt: Date.now() } : n,
      )
      const selectedNid = s.selectedNid === nid ? null : s.selectedNid
      return { ...s, allNotes, selectedNid }
    })
    notesApi
      .trashNote(nid, note.cid)
      .then(() => {
        inFlightOps.delete(nid)
        showToast('Note moved to trash', {
          action: 'Undo',
          duration: 6000,
          onAction: () => restoreNote(nid),
        })
      })
      .catch((e) => {
        console.error('Failed to trash note:', e)
        inFlightOps.delete(nid)
        update((s) => ({ ...s, allNotes: original }))
        showError('Failed to delete note.')
      })
  }

  function restoreNote(nid: string) {
    const cur = get({ subscribe })
    const original = JSON.parse(JSON.stringify(cur.allNotes)) as NoteMetadata[]
    inFlightOps.add(nid)
    update((s) => {
      const allNotes = s.allNotes.map((n) => {
        if (n.id !== nid) return n
        const { deletedAt: _drop, ...rest } = n
        return rest as NoteMetadata
      })
      return { ...s, allNotes }
    })
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

    showToast(`Deleted "${removed.title || 'Untitled'}"`, {
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
    const trashedNotes = cur.allNotes.filter((n) => !!n.deletedAt)
    if (trashedNotes.length === 0) return
    const original = JSON.parse(JSON.stringify(cur.allNotes)) as NoteMetadata[]
    const trashedCids = Array.from(new Set(trashedNotes.map((n) => n.cid)))

    update((s) => ({
      ...s,
      allNotes: s.allNotes.filter((n) => !n.deletedAt),
    }))

    const opKey = `empty-trash`
    let undone = false

    const timer = setTimeout(async () => {
      pendingDestructive.delete(opKey)
      if (undone) return
      try {
        await Promise.all(trashedCids.map((cid) => notesApi.emptyTrash(cid)))
      } catch (e) {
        console.error('Failed to empty trash:', e)
        update((s) => ({ ...s, allNotes: original }))
        showError('Failed to empty trash.')
      }
    }, UNDO_MS)
    pendingDestructive.set(opKey, timer)

    showToast(`Emptied trash (${trashedNotes.length})`, {
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

  function moveNote(nid: string, targetCid: string) {
    const cur = get({ subscribe })
    const note = cur.allNotes.find((n) => n.id === nid) as Note | undefined
    if (!note || note.cid === targetCid) return
    const original = JSON.parse(JSON.stringify(cur.allNotes)) as NoteMetadata[]

    inFlightOps.add(nid)
    const now = Date.now()
    update((s) => ({
      ...s,
      allNotes: s.allNotes.map((n) =>
        n.id === nid ? { ...n, cid: targetCid, updatedAt: now } : n,
      ),
    }))

    const moved = get({ subscribe }).allNotes.find((n) => n.id === nid) as Note | undefined
    if (!moved) {
      inFlightOps.delete(nid)
      return
    }
    // Metadata-only (no content): the server keeps the body, so a stale local
    // copy can't overwrite a newer edit from another device.
    notesApi
      .saveNote({ id: nid, cid: targetCid, title: moved.title, createdAt: moved.createdAt })
      .then(() => {
        inFlightOps.delete(nid)
        const target = cur.collections.find((c) => c.id === targetCid)
        showToast(`Moved to "${target?.name ?? 'collection'}"`, { duration: 3000 })
      })
      .catch((e) => {
        console.error('Failed to move note:', e)
        inFlightOps.delete(nid)
        update((s) => ({ ...s, allNotes: original }))
        showError('Failed to move note.')
      })
  }

  return {
    subscribe,
    load,
    refresh,
    selectCollection,
    selectAllNotes,
    selectTrash,
    selectNote,
    clearSelectedNote,
    createCollection,
    renameCollection,
    deleteCollection,
    createNote,
    moveNote,
    setTitle,
    setPublic,
    sessionFor,
    flushSaves,
    flushOnHide,
    triggerSnapshot,
    restoreVersion,
    trashNote,
    restoreNote,
    permanentlyDeleteNote,
    emptyTrash,
    hasUnsavedWork,
    applySyncEvent,
  }
}

export const notesStore = createNotesStore()
