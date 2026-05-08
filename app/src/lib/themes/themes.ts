// Theme catalog. The hex values mirror the corresponding blocks in
// app/public/css/themes.css so the preview swatches don't have to read
// computed styles at runtime. If you change a theme's CSS, update the swatch
// here too.

export type ThemeId =
  | 'hawk'
  | 'tokyo-night'
  | 'dracula'
  | 'nord'
  | 'gruvbox-dark'
  | 'paper'
  | 'solarized-light'
  | 'latte'
  | 'rose-pine-dawn'
  | 'github-light'

export type ThemeMode = 'dark' | 'light'

export interface ThemeMeta {
  id: ThemeId
  name: string
  mode: ThemeMode
  swatch: { bg: string; panel: string; text: string; accent: string }
}

export const DEFAULT_THEME: ThemeId = 'hawk'

export const THEMES: ThemeMeta[] = [
  { id: 'hawk', name: 'Hawk', mode: 'dark',
    swatch: { bg: '#232830', panel: '#2f343d', text: '#ecedf0', accent: '#e6b84d' } },
  { id: 'tokyo-night', name: 'Tokyo Night', mode: 'dark',
    swatch: { bg: '#1a1b26', panel: '#24283b', text: '#c0caf5', accent: '#7aa2f7' } },
  { id: 'dracula', name: 'Dracula', mode: 'dark',
    swatch: { bg: '#282a36', panel: '#353746', text: '#f8f8f2', accent: '#ff79c6' } },
  { id: 'nord', name: 'Nord', mode: 'dark',
    swatch: { bg: '#2e3440', panel: '#3b4252', text: '#eceff4', accent: '#88c0d0' } },
  { id: 'gruvbox-dark', name: 'Gruvbox', mode: 'dark',
    swatch: { bg: '#282828', panel: '#3c3836', text: '#ebdbb2', accent: '#fabd2f' } },
  { id: 'paper', name: 'Paper', mode: 'light',
    swatch: { bg: '#ece7d9', panel: '#f4f0e6', text: '#15140f', accent: '#b03a2e' } },
  { id: 'solarized-light', name: 'Solarized', mode: 'light',
    swatch: { bg: '#f1e8cf', panel: '#e6dcbd', text: '#002b36', accent: '#167873' } },
  { id: 'latte', name: 'Latte', mode: 'light',
    swatch: { bg: '#dce0e8', panel: '#ccd0da', text: '#383b54', accent: '#d20f6f' } },
  { id: 'rose-pine-dawn', name: 'Rosé Pine Dawn', mode: 'light',
    swatch: { bg: '#ede0d4', panel: '#e3d3c2', text: '#2f2a4a', accent: '#b4637a' } },
  { id: 'github-light', name: 'GitHub Light', mode: 'light',
    swatch: { bg: '#eaeef2', panel: '#d8dee4', text: '#14181f', accent: '#0550ae' } },
]

const THEME_IDS = new Set<ThemeId>(THEMES.map((t) => t.id))

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.has(value as ThemeId)
}
