import { describe, expect, it } from 'vitest'
import { EXTENSIONS, extensionState } from './registry'

describe('extensionState', () => {
  it('falls back to the registry defaults', () => {
    const state = extensionState(undefined, 'pomodoro')
    expect(state.enabled).toBe(true)
    expect(state.settings).toEqual({ focusMinutes: 25, breakMinutes: 5, chime: true })
  })

  it('reads saved values over the defaults', () => {
    const state = extensionState(
      { pomodoro: { enabled: false, settings: { focusMinutes: 50, chime: false } } },
      'pomodoro',
    )
    expect(state.enabled).toBe(false)
    expect(state.settings).toEqual({ focusMinutes: 50, breakMinutes: 5, chime: false })
  })

  it('clamps numbers to the setting range', () => {
    const low = extensionState({ pomodoro: { settings: { focusMinutes: 1 } } }, 'pomodoro')
    expect(low.settings.focusMinutes).toBe(5)
    const high = extensionState({ pomodoro: { settings: { breakMinutes: 999 } } }, 'pomodoro')
    expect(high.settings.breakMinutes).toBe(30)
  })

  it('ignores values of the wrong type and unknown keys', () => {
    const state = extensionState(
      {
        pomodoro: {
          enabled: 'yes',
          settings: { focusMinutes: '45', breakMinutes: true, chime: 'loud', nope: 1 },
        },
      } as never,
      'pomodoro',
    )
    expect(state.enabled).toBe(true)
    expect(state.settings).toEqual({ focusMinutes: 25, breakMinutes: 5, chime: true })
    expect(state.settings.nope).toBeUndefined()
  })

  it('returns a disabled state for an unknown extension', () => {
    expect(extensionState({}, 'nope')).toEqual({ enabled: false, settings: {} })
  })
})

describe('registry', () => {
  it('gives every extension defaults for each of its settings', () => {
    for (const ext of EXTENSIONS) {
      for (const setting of ext.settings) {
        expect(ext.defaults[setting.key]).toBeDefined()
      }
    }
  })

  it('uses unique ids', () => {
    const ids = EXTENSIONS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
