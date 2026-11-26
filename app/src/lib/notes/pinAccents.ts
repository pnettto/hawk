// Card accents for pinned notes on the Notepad cover. Confident but still
// grounded: a colour for the card edge, a light tint behind it. The hues lean
// on the theme accents already used across Hawk (amber, blue, green, rose,
// violet). Mirrored by ACCENTS in server/routeHandlers/notes.ts.
export const NOTE_ACCENTS = [
  { id: 'sand', label: 'Sand', color: '#e0a83f' },
  { id: 'sage', label: 'Sage', color: '#7cb37b' },
  { id: 'clay', label: 'Clay', color: '#d97a63' },
  { id: 'slate', label: 'Slate', color: '#639bd6' },
  { id: 'mauve', label: 'Mauve', color: '#a885d6' },
] as const

export type NoteAccent = (typeof NOTE_ACCENTS)[number]['id']

export const NOTE_ACCENT_IDS = NOTE_ACCENTS.map((a) => a.id) as readonly string[]

export function accentColor(id: string | undefined): string | null {
  return NOTE_ACCENTS.find((a) => a.id === id)?.color ?? null
}
