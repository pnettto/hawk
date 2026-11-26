// Card accents for pinned notes on the Notepad cover. Muted on purpose: they
// tint the card edge and background, never shout. Mirrored by ACCENTS in
// server/routeHandlers/notes.ts.
export const NOTE_ACCENTS = [
  { id: 'sand', label: 'Sand', color: '#c3a97b' },
  { id: 'sage', label: 'Sage', color: '#93a98f' },
  { id: 'clay', label: 'Clay', color: '#c08e7d' },
  { id: 'slate', label: 'Slate', color: '#8a9bb0' },
  { id: 'mauve', label: 'Mauve', color: '#a896ae' },
] as const

export type NoteAccent = (typeof NOTE_ACCENTS)[number]['id']

export const NOTE_ACCENT_IDS = NOTE_ACCENTS.map((a) => a.id) as readonly string[]

export function accentColor(id: string | undefined): string | null {
  return NOTE_ACCENTS.find((a) => a.id === id)?.color ?? null
}
