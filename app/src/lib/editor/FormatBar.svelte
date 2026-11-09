<script lang="ts">
  import { portal, type AnchorRect } from '../utils/portal'

  interface Props {
    anchor: AnchorRect
    active: { bold: boolean; italic: boolean; link: boolean; h3: boolean }
    // Non-null while the link field is open; the current href, if any.
    linkHref: string | null
    onBold: () => void
    onItalic: () => void
    onHeading: () => void
    onLink: () => void
    onLinkApply: (url: string) => void
    onLinkRemove: () => void
    onLinkCancel: () => void
  }
  let { anchor, active, linkHref, onBold, onItalic, onHeading, onLink, onLinkApply, onLinkRemove, onLinkCancel }: Props =
    $props()

  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

  let w = $state(0)
  let h = $state(0)
  let url = $state('')
  let input = $state<HTMLInputElement | null>(null)

  // Above the selection, centred; below it on touch screens (the native
  // selection menu sits above) or when there's no room.
  let pos = $derived.by(() => {
    let top = coarse ? anchor.bottom + 12 : anchor.top - h - 10
    if (top < 8) top = anchor.bottom + 10
    const mid = (anchor.left + anchor.right) / 2
    const left = Math.max(8, Math.min(mid - w / 2, window.innerWidth - w - 8))
    return { top, left }
  })

  $effect(() => {
    if (linkHref === null) return
    url = linkHref
    queueMicrotask(() => input?.focus())
  })

  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      onLinkApply(url)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onLinkCancel()
    }
  }

  const keep = (e: MouseEvent) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
  }
</script>

<div
  class="fmtbar"
  role="toolbar"
  aria-label="Formatting"
  tabindex="-1"
  use:portal
  bind:offsetWidth={w}
  bind:offsetHeight={h}
  style:top="{pos.top}px"
  style:left="{pos.left}px"
  onmousedown={keep}
>
  {#if linkHref !== null}
    <input bind:this={input} bind:value={url} type="url" placeholder="Paste or type a link" onkeydown={onKeydown} />
    <button type="button" onclick={() => onLinkApply(url)}>Apply</button>
    {#if linkHref}<button type="button" onclick={onLinkRemove}>Remove</button>{/if}
  {:else}
    <button type="button" class="b" class:on={active.bold} title="Bold (⌘B)" aria-label="Bold" aria-pressed={active.bold} onclick={onBold}>B</button>
    <button type="button" class="i" class:on={active.italic} title="Italic (⌘I)" aria-label="Italic" aria-pressed={active.italic} onclick={onItalic}>I</button>
    <button type="button" class:on={active.link} title="Link (⌘K)" aria-pressed={active.link} onclick={onLink}>Link</button>
    <span class="sep" aria-hidden="true"></span>
    <button type="button" class:on={active.h3} title="Subheading" aria-label="Subheading" aria-pressed={active.h3} onclick={onHeading}>H</button>
  {/if}
</div>

<style>
  .fmtbar {
    position: fixed;
    z-index: var(--z-popover);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-ui);
    animation: popIn var(--dur-pop) var(--ease-spring);
  }
  button {
    min-width: 28px;
    height: 28px;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font-family: inherit;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  button:hover { background: var(--glass-dark); }
  button.on { background: var(--glass); color: var(--accent); }
  .b { font-weight: 800; }
  .i { font-style: italic; font-family: var(--font-content); }
  .sep { width: 1px; align-self: stretch; margin: 4px 3px; background: var(--line); }
  input {
    width: 220px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--input-bg-strong, var(--glass-dark));
    color: var(--text);
    font: inherit;
    font-size: 0.8125rem;
    outline: none;
  }
  input:focus { border-color: var(--accent); }
</style>
