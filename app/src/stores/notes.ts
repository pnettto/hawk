import { writable, get } from 'svelte/store'
import * as notesApi from '../api/notes'
import { showError, showToast } from './toast'
import { savingStore } from './saving'
import type { Collection, Note, NoteMetadata } from '../types/models'

export type NotesView = 'collection' | 'all' | 'trash'

interface NotesState {
  collections: Collection[]
  // Metadata-only index of every note in every collection. The selected note's
  // entry may also carry full content (merged in by selectNote/saveNote).
  allNotes: NoteMetadata[]
  selectedCid: string | null
  selectedNid: string | null
  view: NotesView
}

// Tracks notes mid-mutation so a server refresh can't resurrect them between
// the optimistic update and the request finishing.
const inFlightOps = new Set<string>()

// Per-note pending save snapshots. Keyed by id so switching notes within the
// debounce window can't drop an earlier note's pending save.
const pendingSaves = new Map<string, Note>()
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveInFlight: Promise<void> | null = null

// Single key for the whole notes module — there's only one debounce timer.
const NOTES_PENDING_KEY = 'notes-store'

function createNotesStore() {
  const { subscribe, update } = writable<NotesState>({
    collections: [],
    allNotes: [],
    selectedCid: null,
    selectedNid: null,
    view: 'collection',
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
        const allNotes = Array.isArray(fullIndex) ? fullIndex : []
        const selectedCid =
          s.selectedCid && collections.find((c) => c.id === s.selectedCid)
            ? s.selectedCid
            : collections[0]?.id ?? null
        return { ...s, collections, allNotes, selectedCid }
      })
    } catch (e) {
      console.error('[notes] load failed', e)
    }
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
        const localMap = new Map(s.allNotes.map((n) => [n.id, n]))
        for (const sn of serverIndex) {
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
        const selectedCid =
          s.selectedCid && collections.find((c) => c.id === s.selectedCid)
            ? s.selectedCid
            : collections[0]?.id ?? null
        return {
          ...s,
          collections,
          allNotes: Array.from(localMap.values()),
          selectedCid,
        }
      })

      // Also re-fetch the open note's full content (titles/dates may have changed).
      const cur = get({ subscribe })
      if (cur.selectedNid) {
        const fullNote = await notesApi.getNote(cur.selectedNid)
        if (fullNote) {
          update((s) => {
            const allNotes = s.allNotes.map((n) =>
              n.id === fullNote.id ? { ...n, ...fullNote } : n,
            )
            return { ...s, allNotes }
          })
        }
      }
    } catch (e) {
      console.error('[notes] refresh failed', e)
    }
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
    update((s) => ({ ...s, selectedNid: null }))
  }

  async function selectNote(nid: string) {
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
    queueSave(newNote)
    return nid
  }

  function applyEdit(nid: string, patch: Partial<Note>) {
    update((s) => {
      const allNotes = s.allNotes.map((n) =>
        n.id === nid ? { ...n, ...patch, updatedAt: Date.now() } : n,
      )
      return { ...s, allNotes }
    })
    const note = get({ subscribe }).allNotes.find((n) => n.id === nid) as
      | Note
      | undefined
    if (note) queueSave(note)
  }

  function queueSave(note: Note) {
    pendingSaves.set(note.id, { ...note })
    savingStore.markPending(NOTES_PENDING_KEY)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      flushSaves()
    }, 500)
  }

  function hasUnsavedWork() {
    return pendingSaves.size > 0 || !!saveInFlight
  }

  async function flushSaves(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (pendingSaves.size === 0) {
      savingStore.clearPending(NOTES_PENDING_KEY)
      return
    }
    savingStore.clearPending(NOTES_PENDING_KEY)
    const toSave = Array.from(pendingSaves.values())
    pendingSaves.clear()
    saveInFlight = savingStore.track(
      (async () => {
        try {
          for (const note of toSave) {
            await notesApi.saveNote(note)
          }
        } catch (e) {
          console.error('Save failed', e)
          showError('Failed to save note.')
          throw e
        } finally {
          saveInFlight = null
        }
      })(),
    )
    await saveInFlight.catch(() => {})
  }

  async function saveNoteImmediate(nid: string) {
    const cur = get({ subscribe })
    const note = cur.allNotes.find((n) => n.id === nid) as Note | undefined
    if (!note) return
    pendingSaves.delete(nid)
    await savingStore
      .track(notesApi.saveNote(note))
      .catch((e) => {
        console.error('Failed to save note', e)
        showError('Failed to save note.')
      })
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
    notesApi
      .saveNote(moved)
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
    applyEdit,
    flushSaves,
    saveNoteImmediate,
    trashNote,
    restoreNote,
    permanentlyDeleteNote,
    emptyTrash,
    hasUnsavedWork,
  }
}

export const notesStore = createNotesStore()
