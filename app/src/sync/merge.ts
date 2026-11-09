import { diff3Merge } from 'node-diff3'

// Words, runs of whitespace, and single punctuation marks. Word granularity
// means two devices editing different words of the same paragraph merge
// cleanly (markdown paragraphs are single lines, so line-level diff3 would
// conflict on almost every concurrent edit).
const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu

export function tokenize(s: string): string[] {
  return s.match(TOKEN) ?? []
}

// Three-way merge of `local` and `remote`, both edited from `base`.
// Non-overlapping edits from both sides are kept; identical edits made on
// both sides are applied once; a true conflict keeps the local side (what the
// user is looking at) — the remote side is still in version history.
export function merge3(base: string, local: string, remote: string): string {
  if (local === base) return remote
  if (remote === base || remote === local) return local
  const regions = diff3Merge(tokenize(local), tokenize(base), tokenize(remote), {
    excludeFalseConflicts: true,
  })
  let out = ''
  for (const r of regions) {
    if (r.ok) out += r.ok.join('')
    else if (r.conflict) out += r.conflict.a.join('')
  }
  return out
}
