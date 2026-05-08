import { api } from './client'

export type Preferences = Record<string, unknown>

export const getPreferences = () => api.get<Preferences>('/api/preferences')

// Server merges the partial into existing prefs and returns the new full blob.
export const patchPreferences = (partial: Preferences) =>
  api.post<Preferences>('/api/preferences', partial)
