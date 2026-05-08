import { api } from './client'
import type { Collection, Note, NoteMetadata } from '../types/models'

export const getCollections = () => api.get<Collection[]>('/api/notes/collections')

export const saveCollections = (collections: Collection[]) =>
  api.post('/api/notes/collections', collections)

export const deleteCollection = (cid: string) =>
  api.del(`/api/notes/collections/${cid}`)

export const getCollectionNotes = (cid: string) =>
  api.get<NoteMetadata[]>(`/api/notes/collections/${cid}/notes`)

export const getNotesIndex = () => api.get<NoteMetadata[]>('/api/notes/index')

export const getNote = (nid: string) => api.get<Note>(`/api/notes/notes/${nid}`)

export const saveNote = (note: Partial<Note> & { id: string; cid: string }) =>
  api.post('/api/notes/notes', note)

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
