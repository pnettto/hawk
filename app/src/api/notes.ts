import { api } from './client'
import type { Note, NoteMetadata, SnapshotMeta } from '../types/models'

type SaveBody = Partial<Note> & { id: string }

export const getNotesIndex = () => api.get<NoteMetadata[]>('/api/notes/index')

export const getNote = (nid: string) => api.get<Note>(`/api/notes/notes/${nid}`)

// Full day notes for days in [start, end].
export const getDayNotes = (start: string, end: string) =>
  api.get<Note[]>(`/api/notes/days?${new URLSearchParams({ start, end })}`)

export const saveNote = (note: SaveBody, opts: { snapshot?: boolean } = {}) =>
  api.post<{ success: boolean; rev: number; updatedAt: number }>(
    '/api/notes/notes',
    opts.snapshot ? { ...note, snapshot: true } : note,
  )

// Revision-checked save: the server answers 409 with its current note when
// `baseRev` is stale, instead of overwriting another device's edit.
export const saveNoteChecked = (
  note: SaveBody,
  baseRev: number,
  opts: { snapshot?: boolean; keepalive?: boolean } = {},
) =>
  api.postWithConflict<{ success?: boolean; rev?: number; updatedAt?: number; note?: Note }>(
    '/api/notes/notes',
    { ...note, baseRev, ...(opts.snapshot ? { snapshot: true } : {}) },
    { keepalive: opts.keepalive },
  )

export const listNoteVersions = (nid: string) =>
  api.get<SnapshotMeta[]>(`/api/notes/notes/${nid}/versions`)

export const getNoteVersion = (nid: string, savedAt: number) =>
  api.get<{ savedAt: number; content: { title?: string; content?: string } }>(
    `/api/notes/notes/${nid}/versions/${savedAt}`,
  )

export const restoreNoteVersion = (nid: string, savedAt: number) =>
  api.post<{ success: boolean; note: Note }>(
    `/api/notes/notes/${nid}/versions/${savedAt}/restore`,
  )

export const trashNote = (nid: string) => api.post(`/api/notes/notes/${nid}/trash`)

export const restoreNote = (nid: string) => api.post(`/api/notes/notes/${nid}/restore`)

export const permanentlyDeleteNote = (nid: string) => api.del(`/api/notes/notes/${nid}`)

export const emptyTrash = () => api.del('/api/notes/trash')
