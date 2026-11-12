import { writable } from 'svelte/store'
import { DEFAULT_THEME, isThemeId, type ThemeId } from '../lib/themes/themes'
import type { ExtensionSettingValue, SavedExtensions } from '../lib/extensions/registry'
import { getPreferences, patchPreferences, type Preferences } from '../api/preferences'

const STORAGE_KEY = 'hawk_theme'
const SERVER_DEBOUNCE_MS = 400

export type DayNotesView = 'tabs' | 'list'

interface PreferencesState {
  theme: ThemeId
  dayNotesView: DayNotesView
  // Raw saved extension state; read it through `extensionState()` so defaults
  // and invalid values are handled in one place.
  extensions: SavedExtensions
}

const VIEW_KEY = 'hawk_day_notes_view'
const EXTENSIONS_KEY = 'hawk_extensions'
const isView = (v: unknown): v is DayNotesView => v === 'tabs' || v === 'list'

function readLocalExtensions(): SavedExtensions {
  try {
    const raw = localStorage.getItem(EXTENSIONS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as SavedExtensions
  } catch {
    return {}
  }
}

function writeLocalExtensions(value: SavedExtensions) {
  try {
    localStorage.setItem(EXTENSIONS_KEY, JSON.stringify(value))
  } catch {
    /* localStorage unavailable */
  }
}

function readLocalView(): DayNotesView {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    if (isView(v)) return v
  } catch {
    /* localStorage unavailable */
  }
  return 'tabs'
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

  const { subscribe, update } = writable<PreferencesState>({
    theme: initialTheme,
    dayNotesView: readLocalView(),
    extensions: readLocalExtensions(),
  })

  let serverTimer: ReturnType<typeof setTimeout> | null = null
  // Accumulate keys changed within the debounce window so a quick theme +
  // view change doesn't drop one of them.
  let pendingPartial: Record<string, unknown> = {}
  function scheduleServerWrite(partial: Record<string, unknown>) {
    pendingPartial = { ...pendingPartial, ...partial }
    if (serverTimer) clearTimeout(serverTimer)
    serverTimer = setTimeout(() => {
      const body = pendingPartial
      pendingPartial = {}
      patchPreferences(body).catch(() => {
        // Network/auth failures: localStorage already saved the choice, so the
        // UI stays correct. Server will catch up on the next write.
      })
    }, SERVER_DEBOUNCE_MS)
  }

  function updateExtensions(fn: (all: SavedExtensions) => SavedExtensions) {
    let next: SavedExtensions = {}
    update((s) => {
      next = fn(s.extensions)
      return { ...s, extensions: next }
    })
    writeLocalExtensions(next)
    scheduleServerWrite({ extensions: next })
  }

  // Coalesce remote snapshots so an older GET can't overwrite a newer event.
  let loadSeq = 0

  function applyRemote(remote: Preferences) {
    if (isThemeId(remote.theme)) {
      const next = remote.theme as ThemeId
      writeLocalTheme(next)
      applyTheme(next)
      update((s) => ({ ...s, theme: next }))
    }
    if (isView(remote.dayNotesView)) {
      const view = remote.dayNotesView
      try {
        localStorage.setItem(VIEW_KEY, view)
      } catch {
        /* ignore */
      }
      update((s) => ({ ...s, dayNotesView: view }))
    }
    const remoteExtensions = remote.extensions
    if (remoteExtensions && typeof remoteExtensions === 'object' && !Array.isArray(remoteExtensions)) {
      const extensions = remoteExtensions as SavedExtensions
      writeLocalExtensions(extensions)
      update((s) => ({ ...s, extensions }))
    }
  }

  async function loadFromServer() {
    const seq = ++loadSeq
    try {
      const remote = await getPreferences()
      // Ignore an older fetch that finished after a newer one.
      if (seq !== loadSeq) return
      applyRemote(remote)
    } catch {
      // Offline / unauthenticated — keep whatever local has.
    }
  }

  // Preference changes travel with the sync event, so the other device
  // updates without a round trip (and without racing a stale fetch).
  function applySyncEvent(evt: { payload?: unknown }) {
    const payload = evt.payload
    // An in-flight GET may predate this event, so ignore its result.
    loadSeq += 1
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      applyRemote(payload as Preferences)
      return
    }
    void loadFromServer()
  }

  return {
    subscribe,
    loadFromServer,
    applySyncEvent,
    setTheme(id: ThemeId) {
      writeLocalTheme(id)
      applyTheme(id)
      update((s) => ({ ...s, theme: id }))
      scheduleServerWrite({ theme: id })
    },
    setDayNotesView(view: DayNotesView) {
      try {
        localStorage.setItem(VIEW_KEY, view)
      } catch {
        /* ignore */
      }
      update((s) => ({ ...s, dayNotesView: view }))
      scheduleServerWrite({ dayNotesView: view })
    },
    setExtensionEnabled(id: string, enabled: boolean) {
      updateExtensions((all) => ({ ...all, [id]: { ...all[id], enabled } }))
    },
    setExtensionSetting(id: string, key: string, value: ExtensionSettingValue) {
      updateExtensions((all) => {
        const current = all[id] ?? {}
        return {
          ...all,
          [id]: { ...current, settings: { ...current.settings, [key]: value } },
        }
      })
    },
  }
}

export const preferencesStore = createPreferencesStore()
