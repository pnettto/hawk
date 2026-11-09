// Tags live in note text as #words. Kept in sync with server/utils/tags.ts.
//
// A tag runs over letters, digits, "_", "-" and "/", and has at least one
// letter (so "#1" isn't a tag). It must follow the start of a line,
// whitespace or "(" — so URL fragments ("page#section") and markdown headings
// ("# Title") don't count. Code is skipped. The markdown serializer may
// escape a line-leading "#" as "\#".

const TAG_RE = /(^|[\s(])\\?#([\p{L}\p{N}][\p{L}\p{N}_\-/]*)/gu

// A line holding nothing but tags — left out of list previews.
export const TAG_LINE_RE = /^[ \t]*(?:\\?#[\p{L}\p{N}][\p{L}\p{N}_\-/]*[ \t]*)+$/gmu

// The tag being typed right before the caret: "#wo" -> "wo", "#" -> "".
export const TAG_TYPING_RE = /(?:^|[\s(])#([\p{L}\p{N}_\-/]*)$/u

export function parseTags(markdown: string | undefined): string[] {
  if (!markdown) return []
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
  const out = new Set<string>()
  for (const m of text.matchAll(TAG_RE)) {
    const tag = m[2].replace(/[-/]+$/, '').toLowerCase()
    if (/\p{L}/u.test(tag)) out.add(tag)
  }
  return [...out].sort()
}
