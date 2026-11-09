<script lang="ts">
  import { tick } from 'svelte'

  interface Props {
    // "HH:MM" or undefined.
    value?: string
    onChange: (value: string | undefined) => void
    // Extra class for the trigger (callers style the chip).
    class?: string
    // Accessible name when no time is set.
    label?: string
  }
  let { value, onChange, class: cls = '', label = 'Add time' }: Props = $props()

  const pad = (n: number) => String(n).padStart(2, '0')
  const GRID: string[] = []
  for (let h = 0; h < 24; h++) for (const m of [0, 30]) GRID.push(`${pad(h)}:${pad(m)}`)

  // Half-hour grid, plus the current value if it's off-grid (e.g. "9.15
  // standup" from quick entry) so it still shows as selected.
  let slots = $derived(
    value && !GRID.includes(value) ? [...GRID, value].sort() : GRID,
  )

  let open = $state(false)
  let triggerEl = $state<HTMLButtonElement | null>(null)
  let popEl = $state<HTMLDivElement | null>(null)
  let gridEl = $state<HTMLDivElement | null>(null)
  let pos = $state<{ top: number; left: number } | null>(null)

  function nextSlotFromNow(): string {
    const d = new Date()
    const mins = d.getHours() * 60 + d.getMinutes()
    const slot = Math.min(47, Math.ceil(mins / 30))
    return GRID[slot]
  }

  function place() {
    if (!triggerEl || !popEl) return
    const a = triggerEl.getBoundingClientRect()
    const w = popEl.offsetWidth
    const h = popEl.offsetHeight
    const m = 8
    let left = a.right - w
    if (left < m) left = Math.min(a.left, window.innerWidth - w - m)
    left = Math.max(m, left)
    let top = a.bottom + 6
    if (top + h + m > window.innerHeight && a.top - h - 6 >= m) top = a.top - h - 6
    pos = { top, left }
  }

  async function show() {
    open = true
    pos = null
    await tick()
    place()
    // Bring the selected (or next upcoming) slot into view near the top.
    const target = value ?? nextSlotFromNow()
    const btn = gridEl?.querySelector<HTMLButtonElement>(`[data-slot="${target}"]`)
    if (btn && gridEl) {
      gridEl.scrollTop = btn.offsetTop - gridEl.offsetTop - 36
      btn.focus({ preventScroll: true })
    }
  }

  function hide(refocus = true) {
    if (!open) return
    open = false
    if (refocus) triggerEl?.focus()
  }

  function pick(v: string | undefined) {
    if (v !== value) onChange(v)
    hide()
  }

  function onGridKey(e: KeyboardEvent) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[e.key]
    if (!step) return
    e.preventDefault()
    const buttons = Array.from(gridEl?.querySelectorAll<HTMLButtonElement>('[data-slot]') ?? [])
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, (i < 0 ? 0 : i) + step))]
    next?.focus()
    next?.scrollIntoView({ block: 'nearest' })
  }

  $effect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const inside = e.composedPath().some((n) => n === popEl || n === triggerEl)
      if (!inside) hide(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        hide()
      }
    }
    const onFocus = (e: FocusEvent) => {
      const t = e.target as Node
      if (popEl && !popEl.contains(t) && t !== triggerEl) hide(false)
    }
    document.addEventListener('mousedown', onDoc, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocus)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', onDoc, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocus)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  })

  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }

  const isNight = (t: string) => Number(t.slice(0, 2)) < 6
</script>

<button
  type="button"
  class="tp-trigger {cls}"
  class:set={!!value}
  class:open
  bind:this={triggerEl}
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-label={value ? `Time ${value}, change` : label}
  title={value ? 'Change time' : label}
  onclick={() => (open ? hide() : show())}
>
  {#if value}
    {value}
  {:else}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </svg>
  {/if}
</button>

{#if open}
  <div
    class="tp-pop"
    use:portal
    bind:this={popEl}
    role="dialog"
    aria-label="Choose a time"
    style:top={pos ? `${pos.top}px` : '-9999px'}
    style:left={pos ? `${pos.left}px` : '-9999px'}
  >
    <div class="tp-head">
      <span class="tp-title">Time</span>
      {#if value}
        <button type="button" class="tp-clear" onclick={() => pick(undefined)}>Clear</button>
      {/if}
    </div>
    <div class="tp-grid" bind:this={gridEl} onkeydown={onGridKey} role="listbox" tabindex="-1" aria-label="Times">
      {#each slots as t (t)}
        <button
          type="button"
          role="option"
          data-slot={t}
          class="tp-slot"
          class:selected={t === value}
          class:hour={t.endsWith(':00')}
          class:night={isNight(t)}
          aria-selected={t === value}
          onclick={() => pick(t)}
        >
          {t}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .tp-trigger {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    height: 1.75rem;
    padding: 0 0.5rem;
    border: 0;
    border-radius: var(--r-pill);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .tp-trigger svg { width: 14px; height: 14px; display: block; }
  .tp-trigger.set {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .tp-trigger:hover,
  .tp-trigger.open { color: var(--text); background: var(--glass); }
  .tp-trigger.set.open { color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }

  .tp-pop {
    position: fixed;
    z-index: var(--z-popover);
    width: 252px;
    padding: 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--panel);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-ui);
    animation: popIn var(--dur-pop) var(--ease-spring);
  }
  .tp-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 26px;
    padding: 0 0.25rem 0.4rem;
  }
  .tp-title {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .tp-clear {
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .tp-clear:hover { color: var(--danger); background: var(--danger-bg); }
  .tp-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 3px;
    max-height: 228px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    outline: none;
  }
  .tp-slot {
    height: 32px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .tp-slot.hour { color: var(--text); }
  .tp-slot.night { opacity: 0.55; }
  .tp-slot:hover,
  .tp-slot:focus-visible { background: var(--glass); color: var(--text); opacity: 1; outline: none; }
  .tp-slot.selected {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    opacity: 1;
  }
  @media (pointer: coarse) {
    .tp-slot { height: 40px; }
    .tp-grid { max-height: 280px; }
  }
</style>
