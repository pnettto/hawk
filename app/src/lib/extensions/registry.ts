// Registry of optional features. The Extensions page is rendered from this
// list, so adding an extension means adding an entry here plus a check for
// `extensionState(...).enabled` wherever the feature lives.
//
// Saved state lives in the shared preferences blob under `extensions`, keyed by
// extension id, and is read through `extensionState` so missing or invalid
// values fall back to the defaults below.

export type ExtensionSettingValue = string | number | boolean

interface SettingBase {
  key: string
  label: string
  help?: string
}

export interface NumberSetting extends SettingBase {
  kind: 'number'
  min: number
  max: number
  step: number
  unit?: string
}

export interface SwitchSetting extends SettingBase {
  kind: 'switch'
}

export type ExtensionSetting = NumberSetting | SwitchSetting

export interface Extension {
  id: string
  name: string
  description: string
  // Where the feature turns up, shown next to the name.
  where: string
  defaultEnabled: boolean
  settings: ExtensionSetting[]
  defaults: Record<string, ExtensionSettingValue>
}

export interface ExtensionState {
  enabled: boolean
  settings: Record<string, ExtensionSettingValue>
}

export interface SavedExtension {
  enabled?: boolean
  settings?: Record<string, unknown>
}

export type SavedExtensions = Record<string, SavedExtension>

export const EXTENSIONS: Extension[] = [
  {
    id: 'pomodoro',
    name: 'Pomodoro',
    description: 'A focus timer on every task — work in blocks, then take a short break.',
    where: 'Journal → Tasks',
    defaultEnabled: true,
    settings: [
      {
        kind: 'number',
        key: 'focusMinutes',
        label: 'Focus block',
        help: 'How long one stretch of work lasts.',
        min: 5,
        max: 90,
        step: 5,
        unit: 'min',
      },
      {
        kind: 'number',
        key: 'breakMinutes',
        label: 'Break',
        help: 'Rest between blocks.',
        min: 1,
        max: 30,
        step: 1,
        unit: 'min',
      },
      {
        kind: 'switch',
        key: 'chime',
        label: 'Chime when a block ends',
        help: 'A short tone, when the browser allows sound.',
      },
    ],
    defaults: { focusMinutes: 25, breakMinutes: 5, chime: true },
  },
]

export function getExtension(id: string): Extension | undefined {
  return EXTENSIONS.find((e) => e.id === id)
}

function clamp(value: number, setting: ExtensionSetting): number {
  if (setting.kind !== 'number') return value
  return Math.min(setting.max, Math.max(setting.min, value))
}

// Merge a saved entry over the extension's defaults. Unknown keys are dropped
// and numbers are clamped, so a hand-edited or older preferences blob can't
// put the UI into a state it can't render.
export function extensionState(
  saved: SavedExtensions | undefined,
  id: string,
): ExtensionState {
  const ext = getExtension(id)
  if (!ext) return { enabled: false, settings: {} }
  const raw = saved?.[id] ?? {}
  const settings: Record<string, ExtensionSettingValue> = { ...ext.defaults }
  for (const setting of ext.settings) {
    const value = raw.settings?.[setting.key]
    if (setting.kind === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        settings[setting.key] = clamp(value, setting)
      }
    } else if (typeof value === 'boolean') {
      settings[setting.key] = value
    }
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : ext.defaultEnabled,
    settings,
  }
}

export function extensionNumber(state: ExtensionState, key: string, fallback: number): number {
  const value = state.settings[key]
  return typeof value === 'number' ? value : fallback
}

export function extensionSwitch(state: ExtensionState, key: string, fallback: boolean): boolean {
  const value = state.settings[key]
  return typeof value === 'boolean' ? value : fallback
}
