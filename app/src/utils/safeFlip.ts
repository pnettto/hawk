import { flip } from 'svelte/animate'

type FlipArgs = Parameters<typeof flip>

// svelte/animate's flip, but a no-op for elements that aren't laid out (e.g.
// a list hidden with display:none on mobile) — flip would otherwise divide
// by a zero size and emit NaN/Infinity keyframes.
export function safeFlip(node: FlipArgs[0], rects: FlipArgs[1], params?: FlipArgs[2]) {
  const { from, to } = rects
  if (!from.width || !from.height || !to.width || !to.height) return { duration: 0 }
  return flip(node, rects, params)
}
