import { writable } from 'svelte/store'
import { DEFAULT_THEME, isThemeId, type ThemeId } from '../lib/themes/themes'
import { getPreferences, patchPreferences } from '../api/preferences'

const STORAGE_KEY = 'hawk_theme'
const SERVER_DEBOUNCE_MS = 400

interface PreferencesState {
  theme: ThemeId
}

function readLocalTheme(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (isThemeId(v)) return v
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_THEME
}

function writeLocalTheme(id: ThemeId) {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* localStorage unavailable */
  }
}

export function applyTheme(id: ThemeId) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = id
  }
}

function createPreferencesStore() {
  // Seed from the same source the inline boot script reads, so the initial
  // store value matches what's already on the DOM.
  const initialTheme = readLocalTheme()
  applyTheme(initialTheme)

  const { subscribe, update } = writable<PreferencesState>({ theme: initialTheme })

  let serverTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleServerWrite(partial: Record<string, unknown>) {
    if (serverTimer) clearTimeout(serverTimer)
    serverTimer = setTimeout(() => {
      patchPreferences(partial).catch(() => {
        // Network/auth failures: localStorage already saved the choice, so the
        // UI stays correct. Server will catch up on the next write.
      })
    }, SERVER_DEBOUNCE_MS)
  }

  return {
    subscribe,
    setTheme(id: ThemeId) {
      writeLocalTheme(id)
      applyTheme(id)
      update((s) => ({ ...s, theme: id }))
      scheduleServerWrite({ theme: id })
    },
    async loadFromServer() {
      try {
        const remote = await getPreferences()
        if (isThemeId(remote.theme)) {
          const next = remote.theme as ThemeId
          writeLocalTheme(next)
          applyTheme(next)
          update((s) => ({ ...s, theme: next }))
        }
      } catch {
        // Offline / unauthenticated — keep whatever local has.
      }
    },
  }
}

export const preferencesStore = createPreferencesStore()
