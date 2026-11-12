import { api } from './client'
import type { PomodoroState } from '../stores/pomodoro'

export interface PomodoroRecord {
  state: PomodoroState
  rev: number
  updatedAt: number
  ownerClientId: string | null
  ownerBrowserId: string | null
}

export const getPomodoro = () => api.get<PomodoroRecord | null>('/api/pomodoro')

// `rev` is the version this state was edited from. A 409 comes back with the
// current record, so the caller can apply the newer state instead. `claim`
// marks the session that started the current pomodoro as its notifier.
export const savePomodoro = (state: PomodoroState, rev: number, claim: boolean) =>
  api.postWithConflict<PomodoroRecord>(
    '/api/pomodoro',
    { state, rev, claim },
    { keepalive: true },
  )
