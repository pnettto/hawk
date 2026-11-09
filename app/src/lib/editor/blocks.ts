// The block types offered by the "+" button and the "/" menu.

export type BlockId = 'h3' | 'p' | 'lead' | 'ul' | 'ol' | 'todo' | 'table' | 'image' | 'video'

export interface BlockItem {
  id: BlockId
  label: string
  hint?: string
  desc?: string
  // Extra search terms for the "/" filter.
  k?: string
}

export const BLOCKS: BlockItem[] = [
  { id: 'h3', label: 'Subheading', hint: '###', k: 'heading title h3' },
  { id: 'p', label: 'Paragraph', k: 'text body' },
  { id: 'lead', label: 'Lead paragraph', desc: 'Larger opening text', k: 'intro' },
  { id: 'ul', label: 'Bulleted list', hint: '-', k: 'bullet list' },
  { id: 'ol', label: 'Numbered list', hint: '1.', k: 'number ordered list' },
  { id: 'todo', label: 'Checklist', hint: '[ ]', k: 'todo task check checkbox' },
  { id: 'table', label: 'Table', k: 'grid rows columns' },
  { id: 'image', label: 'Image', desc: 'Upload a picture or paste a link', k: 'picture photo img' },
  { id: 'video', label: 'Video', desc: 'Upload a clip or paste a YouTube link', k: 'youtube movie clip mp4' },
]

export function filterBlocks(query: string): BlockItem[] {
  const q = query.toLowerCase().trim()
  if (!q) return BLOCKS
  return BLOCKS.filter((b) => `${b.label} ${b.k ?? ''} ${b.id}`.toLowerCase().includes(q))
}

// "/query" typed into an otherwise empty paragraph opens the menu.
export function slashQuery(text: string): string | null {
  const m = /^\/([^\n/]{0,24})$/.exec(text)
  return m ? m[1] : null
}

// Bare domains get https://, bare emails get mailto:.
export function normalizeUrl(raw: string): string {
  const url = raw.trim()
  if (!url) return ''
  if (/^(https?:|mailto:|#|\/)/i.test(url)) return url
  return (/^[^\s@]+@[^\s@]+$/.test(url) ? 'mailto:' : 'https://') + url
}

export function isYoutubeUrl(url: string): boolean {
  return /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?|shorts\/|embed\/)|youtu\.be\/)/i.test(url)
}
