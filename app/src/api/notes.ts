import { api } from './client'
import type {
  Collection,
  Note,
  NoteMetadata,
  SnapshotMeta,
} from '../types/models'

export const getCollections = () => api.get<Collection[]>('/api/notes/collections')

export const saveCollections = (collections: Collection[]) =>
  api.post('/api/notes/collections', collections)

export const deleteCollection = (cid: string) =>
  api.del(`/api/notes/collections/${cid}`)

export const getCollectionNotes = (cid: string) =>
  api.get<NoteMetadata[]>(`/api/notes/collections/${cid}/notes`)

export const getNotesIndex = () => api.get<NoteMetadata[]>('/api/notes/index')

export const getNote = (nid: string) => api.get<Note>(`/api/notes/notes/${nid}`)

export const saveNote = (
  note: Partial<Note> & { id: string; cid: string },
  opts: { snapshot?: boolean } = {},
) =>
  api.post(
    '/api/notes/notes',
    opts.snapshot ? { ...note, snapshot: true } : note,
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

export const trashNote = (nid: string, cid: string) =>
  api.post(`/api/notes/notes/${nid}/trash`, { cid })

export const restoreNote = (nid: string) =>
  api.post(`/api/notes/notes/${nid}/restore`)

export const permanentlyDeleteNote = (nid: string) =>
  api.del(`/api/notes/notes/${nid}`)

export const getTrash = (cid: string) =>
  api.get<NoteMetadata[]>(`/api/notes/collections/${cid}/trash`)

export const emptyTrash = (cid: string) =>
  api.del(`/api/notes/collections/${cid}/trash`)
