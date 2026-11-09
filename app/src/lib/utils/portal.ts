// Reparent into document.body so an ancestor with `transform`, `filter` or
// `backdrop-filter` can't trap a `position: fixed` element.
export function portal(node: HTMLElement) {
  document.body.appendChild(node)
  return {
    destroy() {
      if (node.parentNode === document.body) document.body.removeChild(node)
    },
  }
}

export interface AnchorRect {
  top: number
  bottom: number
  left: number
  right: number
}

// Place a floating box of size w×h below the anchor (or above it when it
// doesn't fit), clamped to the viewport.
export function placeBelow(a: AnchorRect, w: number, h: number, gap = 6): { top: number; left: number } {
  let top = a.bottom + gap
  if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - gap)
  const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8))
  return { top, left }
}
