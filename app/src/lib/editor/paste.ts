// Heuristics for deciding how to treat pasted plain text.

const MD_PATTERNS = [
  /^#{1,6}\s+\S/m, // heading
  /^\s*[-*+]\s+\S/m, // bullet
  /^\s*\d+[.)]\s+\S/m, // ordered item
  /^\s*>\s?\S/m, // quote
  /^```/m, // fence
  /\*\*[^*\n]+\*\*/, // bold
  /(^|[^\w*])_[^_\n]+_(?!\w)/, // italic
  /\[[^\]\n]+\]\([^)\s]+\)/, // link
  /`[^`\n]+`/, // inline code
  /^\s*[-*_]{3,}\s*$/m, // rule
]

export function looksLikeMarkdown(text: string): boolean {
  return MD_PATTERNS.some((re) => re.test(text))
}

const BLOCK_START = /^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|>|```|\||[-*_]{3,}\s*$)/

// In markdown a single newline inside a paragraph is a soft break that
// renders as a space — but people pasting text expect their lines to stay
// lines. Turn single newlines between plain lines into paragraph breaks,
// leaving fenced code, lists and other block syntax alone.
export function splitSoftBreaks(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    out.push(line)
    if (/^\s*```/.test(line)) inFence = !inFence
    if (inFence) continue
    const next = lines[i + 1]
    if (next === undefined) continue
    const plain = (l: string) => l.trim() !== '' && !BLOCK_START.test(l) && !/^\s/.test(l)
    if (plain(line) && plain(next) && !/(\s{2}|\\)$/.test(line)) out.push('')
  }
  return out.join('\n')
}
