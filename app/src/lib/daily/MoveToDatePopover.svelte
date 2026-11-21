<script lang="ts">
  import { untrack } from 'svelte'
  import CalendarGrid from '../ui/CalendarGrid.svelte'
  import { formatDate } from '../../utils/date'

  interface Props {
    // The day the tasks are on now; shown but not pickable.
    from: string
    anchor: HTMLElement | null
    onPick: (dateStr: string) => void
    onClose: () => void
    label?: string
    // Above modal overlays (the search dialog) instead of the page.
    raised?: boolean
  }
  let { from, anchor, onPick, onClose, label = 'Move to', raised = false }: Props = $props()

  let el = $state<HTMLDivElement | null>(null)
  let pos = $state<{ top: number; left: number } | null>(null)
  let viewDate = $state(untrack(() => new Date(from + 'T12:00:00')))

  const addDays = (d: Date, n: number) => {
    const out = new Date(d)
    out.setDate(out.getDate() + n)
    return out
  }
  // Shortcuts count from today, not from the day being viewed.
  const today = new Date()
  const untilMonday = ((8 - today.getDay()) % 7) || 7
  const shortcuts = [
    { label: 'Today', date: formatDate(today) },
    { label: 'Tomorrow', date: formatDate(addDays(today, 1)) },
    { label: 'Next Monday', date: formatDate(addDays(today, untilMonday)) },
  ]
  let visibleShortcuts = $derived(shortcuts.filter((s) => s.date !== from))

  // Below the anchor, right edges aligned, flipping above when there's no
  // room — same rule as ActionMenu. Phones get it centred (see CSS).
  function place() {
    if (!anchor || !el) return
    const a = anchor.getBoundingClientRect()
    const w = el.offsetWidth
    const h = el.offsetHeight
    const m = 8
    let left = a.right - w
    if (left < m) left = Math.min(a.left, window.innerWidth - w - m)
    left = Math.max(m, left)
    let top = a.bottom + 4
    if (top + h + m > window.innerHeight) {
      const above = a.top - h - 4
      top = above >= m ? above : Math.max(m, window.innerHeight - h - m)
    }
    pos = { top, left }
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }

  function close() {
    onClose()
    anchor?.focus({ preventScroll: true })
  }

  function pick(dateStr: string) {
    if (dateStr === from) return
    onPick(dateStr)
    onClose()
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  $effect(() => {
    if (el) {
      place()
      el.querySelector<HTMLButtonElement>('.shortcut, .cal-day:not([aria-disabled])')?.focus({ preventScroll: true })
    }
    const onDoc = (e: PointerEvent) => {
      const inside = e.composedPath().some((n) => n === el || n === anchor)
      if (!inside) onClose()
    }
    document.addEventListener('pointerdown', onDoc, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', onDoc, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  })
</script>

<div
  class="move-popover"
  role="dialog"
  aria-label={label}
  tabindex="-1"
  bind:this={el}
  use:portal
  onkeydown={onKeydown}
  style:top={pos ? `${pos.top}px` : '-9999px'}
  style:left={pos ? `${pos.left}px` : '-9999px'}
  style:z-index={raised ? 'calc(var(--z-overlay) + 1)' : undefined}
>
  <div class="shortcuts">
    {#each visibleShortcuts as s (s.label)}
      <button type="button" class="shortcut" onclick={() => pick(s.date)}>{s.label}</button>
    {/each}
  </div>
  <CalendarGrid bind:viewDate isDisabled={(d) => d === from} onSelect={(d) => pick(formatDate(d))} />
</div>

<style>
  .move-popover {
    position: fixed;
    z-index: var(--z-popover);
    width: min(300px, calc(100vw - 16px));
    box-sizing: border-box;
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--panel);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-ui);
    animation: popIn var(--dur-pop) var(--ease-spring);
  }
  @keyframes popIn {
    from { opacity: 0; transform: scale(0.96) translateY(-2px); }
    to { opacity: 1; transform: none; }
  }
  .shortcuts {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 4px;
    margin-bottom: 0.6rem;
  }
  .shortcut {
    min-height: 32px;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .shortcut:hover { background: var(--glass-dark); border-color: var(--accent); }
  .shortcut:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  @media (pointer: coarse) {
    .shortcut { min-height: 44px; }
  }
  @media (max-width: 600px) {
    .move-popover {
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%);
      animation: none;
    }
  }
</style>
