import { api } from './client'
import type { NoteHit, TaskHit } from '../lib/search/match'

export type SearchKind = 'all' | 'notes' | 'tasks'

export interface SearchResults {
  notes: NoteHit[]
  tasks: TaskHit[]
  truncated: boolean
}

export const search = (q: string, kind: SearchKind, signal?: AbortSignal) =>
  api.get<SearchResults>(`/api/search?${new URLSearchParams({ q, kind })}`, signal)
