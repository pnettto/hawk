import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { getPreferences } from '../api/preferences'

vi.mock('../api/preferences', () => ({
  getPreferences: vi.fn(async () => ({})),
  patchPreferences: vi.fn(async () => ({})),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
})

describe('retired day-note layout preference', () => {
  it('does not restore the old local list layout', async () => {
    localStorage.setItem('hawk_day_notes_view', 'list')
    const { preferencesStore } = await import('./preferences')
    expect(get(preferencesStore)).not.toHaveProperty('dayNotesView')
    expect(preferencesStore).not.toHaveProperty('setDayNotesView')
  })

  it('ignores the old server layout while still loading extension preferences', async () => {
    vi.mocked(getPreferences).mockResolvedValueOnce({
      dayNotesView: 'list',
      extensions: { pomodoro: { enabled: true } },
    })
    const { preferencesStore } = await import('./preferences')
    await preferencesStore.loadFromServer()
    expect(get(preferencesStore)).not.toHaveProperty('dayNotesView')
    expect(get(preferencesStore).extensions.pomodoro).toEqual({ enabled: true })
  })

  it('ignores legacy layout values arriving through cross-device sync', async () => {
    const { preferencesStore } = await import('./preferences')
    preferencesStore.applySyncEvent({ payload: { dayNotesView: 'list' } })
    expect(get(preferencesStore)).not.toHaveProperty('dayNotesView')
    expect(localStorage.getItem('hawk_day_notes_view')).toBeNull()
  })
})
