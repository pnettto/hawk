// Card accents for pinned notes on the Notepad cover. Each colour is mixed
// with the active theme's accent, so the palette shifts with the theme
// instead of sitting apart from it. Mirrored by ACCENTS in
// server/routeHandlers/notes.ts.
export const NOTE_ACCENTS = [
  { id: 'sand', label: 'Sand', color: 'color-mix(in srgb, var(--accent) 35%, #c9a24a)' },
  { id: 'sage', label: 'Sage', color: 'color-mix(in srgb, var(--accent) 35%, #7d9a6e)' },
  { id: 'clay', label: 'Clay', color: 'color-mix(in srgb, var(--accent) 35%, #bf7a65)' },
  { id: 'slate', label: 'Slate', color: 'color-mix(in srgb, var(--accent) 35%, #6f8ea8)' },
  { id: 'mauve', label: 'Mauve', color: 'color-mix(in srgb, var(--accent) 35%, #98829a)' },
] as const

export type NoteAccent = (typeof NOTE_ACCENTS)[number]['id']

export const NOTE_ACCENT_IDS = NOTE_ACCENTS.map((a) => a.id) as readonly string[]

export function accentColor(id: string | undefined): string | null {
  return NOTE_ACCENTS.find((a) => a.id === id)?.color ?? null
}
