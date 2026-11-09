<script lang="ts">
  import { portal, placeBelow, type AnchorRect } from '../utils/portal'

  // Keyboard-driven pick list under the caret: the "+" / "/" block menu and
  // "#" tag completion.
  interface Item {
    id: string
    label: string
    hint?: string
    desc?: string
  }

  interface Props {
    items: Item[]
    selected: number
    anchor: AnchorRect
    label?: string
    // Shown when nothing matches.
    empty?: string
    compact?: boolean
    onPick: (index: number) => void
    onHover: (index: number) => void
  }
  let { items, selected, anchor, label = 'Insert block', empty = '', compact = false, onPick, onHover }: Props = $props()

  let el = $state<HTMLDivElement | null>(null)
  let w = $state(0)
  let h = $state(0)
  let pos = $derived(placeBelow(anchor, w || (compact ? 200 : 280), h || 0))

  $effect(() => {
    void selected
    el?.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' })
  })
</script>

<div
  class="insert-menu"
  class:compact
  role="listbox"
  aria-label={label}
  use:portal
  bind:this={el}
  bind:offsetWidth={w}
  bind:offsetHeight={h}
  style:top="{pos.top}px"
  style:left="{pos.left}px"
>
  {#each items as item, i (item.id)}
    <button
      type="button"
      class="item"
      class:selected={i === selected}
      role="option"
      aria-selected={i === selected}
      onmousedown={(e) => e.preventDefault()}
      onmousemove={() => i !== selected && onHover(i)}
      onclick={() => onPick(i)}
    >
      <span class="label">{item.label}</span>
      {#if item.hint}<span class="hint">{item.hint}</span>{/if}
      {#if item.desc}<span class="desc">{item.desc}</span>{/if}
    </button>
  {:else}
    <div class="none">{empty}</div>
  {/each}
</div>

<style>
  .insert-menu {
    position: fixed;
    z-index: var(--z-popover);
    width: 280px;
    max-height: 340px;
    overflow-y: auto;
    padding: 6px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-ui);
    animation: popIn var(--dur-pop) var(--ease-spring);
    transform-origin: top left;
  }
  .insert-menu.compact { width: 200px; max-height: 260px; padding: 4px; }
  .compact .item { padding: 5px 8px; }
  .item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px 10px;
    align-items: baseline;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }
  .item.selected { background: var(--glass); }
  .label { font-size: 0.85rem; font-weight: 500; }
  .item.selected .label { color: var(--accent); }
  .hint {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--muted);
  }
  .desc {
    grid-column: 1 / -1;
    font-size: 0.75rem;
    line-height: 1.3;
    color: var(--muted);
  }
  .none {
    padding: 8px 10px;
    font-size: 0.8rem;
    color: var(--muted);
  }
</style>
