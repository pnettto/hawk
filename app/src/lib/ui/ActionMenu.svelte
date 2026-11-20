<script lang="ts">
  import type { ActionMenuItem } from './menuItem'

  interface Props {
    // The trigger the panel hangs off. Clicking it again toggles the menu, so
    // it is excluded from the outside-click check.
    anchor: HTMLElement | null
    items: ActionMenuItem[]
    onClose: () => void
    label?: string
  }
  let { anchor, items, onClose, label = 'Actions' }: Props = $props()

  let el = $state<HTMLDivElement | null>(null)
  let pos = $state<{ top: number; left: number } | null>(null)

  // Below the trigger, right edges aligned, flipping above when there's no
  // room — same rule as the time picker and history popover.
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

  function closeAndRestoreFocus() {
    onClose()
    anchor?.focus({ preventScroll: true })
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeAndRestoreFocus()
      return
    }
    if (e.key === 'Tab') {
      // Resume the page's tab order from the trigger, not the portalled panel.
      closeAndRestoreFocus()
      return
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key]
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const buttons = Array.from(el?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + step! + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  $effect(() => {
    if (el) {
      place()
      // Opening the menu always puts keyboard navigation on its first item.
      el.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true })
    }
    const onDoc = (e: PointerEvent) => {
      const inside = e.composedPath().some((n) => n === el || n === anchor)
      if (!inside) onClose()
    }
    const onFocus = (e: FocusEvent) => {
      const t = e.target as Node
      if (el && !el.contains(t) && t !== anchor) onClose()
    }
    document.addEventListener('pointerdown', onDoc, true)
    document.addEventListener('focusin', onFocus)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', onDoc, true)
      document.removeEventListener('focusin', onFocus)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  })
</script>

<div
  class="action-menu"
  role="menu"
  aria-label={label}
  tabindex="-1"
  bind:this={el}
  use:portal
  onkeydown={onKeydown}
  style:top={pos ? `${pos.top}px` : '-9999px'}
  style:left={pos ? `${pos.left}px` : '-9999px'}
>
  {#each items as item, i (item.label)}
    {#if item.danger && i > 0 && !items[i - 1].danger}
      <div class="separator" role="separator"></div>
    {/if}
    <button
      type="button"
      role="menuitem"
      class:danger={item.danger}
      onclick={() => {
        // Restore before the action runs so a dialog/editor can claim focus.
        closeAndRestoreFocus()
        item.onSelect()
      }}
    >
      {#if item.icon}
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          {#each typeof item.icon === 'string' ? [item.icon] : item.icon as d (d)}
            <path {d} />
          {/each}
        </svg>
      {/if}
      <span>{item.label}</span>
    </button>
  {/each}
</div>

<style>
  .action-menu {
    position: fixed;
    z-index: var(--z-popover);
    min-width: min(11.5rem, calc(100vw - 16px));
    max-width: min(16rem, calc(100vw - 16px));
    max-height: calc(100dvh - 16px);
    overflow-y: auto;
    box-sizing: border-box;
    padding: 0.3rem;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--panel);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-ui);
    animation: menuPop var(--dur-pop) var(--ease-spring);
  }
  @keyframes menuPop {
    from { opacity: 0; transform: scale(0.96) translateY(-2px); }
    to { opacity: 1; transform: none; }
  }
  .action-menu button {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    min-height: 36px;
    padding: 0.45rem 0.55rem;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
    overflow-wrap: anywhere;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .action-menu button:hover,
  .action-menu button:focus-visible {
    background: var(--glass-dark);
    outline: none;
  }
  .action-menu button svg {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--muted);
  }
  .separator { height: 1px; margin: 0.3rem 0.25rem; background: var(--line); }
  @media (pointer: coarse) {
    .action-menu button { min-height: 44px; }
  }
  .action-menu button.danger { color: var(--danger); }
  .action-menu button.danger svg { color: currentColor; }
  .action-menu button.danger:hover,
  .action-menu button.danger:focus-visible { background: var(--danger-bg); }
</style>
