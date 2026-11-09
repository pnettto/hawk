<script lang="ts">
  import { onMount } from 'svelte'
  import { portal, placeBelow, type AnchorRect } from '../utils/portal'

  interface Props {
    kind: 'image' | 'video'
    anchor: AnchorRect
    onUrl: (url: string) => void
    onFiles: (files: File[]) => void
    onCancel: () => void
  }
  let { kind, anchor, onUrl, onFiles, onCancel }: Props = $props()

  let el = $state<HTMLDivElement | null>(null)
  let input = $state<HTMLInputElement | null>(null)
  let fileInput = $state<HTMLInputElement | null>(null)
  let url = $state('')
  let w = $state(0)
  let h = $state(0)
  let pos = $derived(placeBelow(anchor, w || 320, h || 0))

  onMount(() => {
    input?.focus()
    const outside = (e: MouseEvent) => {
      if (el && !e.composedPath().includes(el)) onCancel()
    }
    document.addEventListener('mousedown', outside, true)
    return () => document.removeEventListener('mousedown', outside, true)
  })

  function submit() {
    if (url.trim()) onUrl(url.trim())
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  function onPicked() {
    const files = Array.from(fileInput?.files ?? [])
    if (files.length) onFiles(files)
  }
</script>

<div
  class="media-prompt"
  role="dialog"
  aria-label={kind === 'image' ? 'Insert image' : 'Insert video'}
  use:portal
  bind:this={el}
  bind:offsetWidth={w}
  bind:offsetHeight={h}
  style:top="{pos.top}px"
  style:left="{pos.left}px"
>
  <div class="row">
    <input
      bind:this={input}
      bind:value={url}
      type="url"
      placeholder={kind === 'image' ? 'Paste an image link' : 'Paste a YouTube or video link'}
      onkeydown={onKeydown}
    />
    <button type="button" class="btn-primary" disabled={!url.trim()} onclick={submit}>Insert</button>
  </div>
  <div class="or"><span>or</span></div>
  <button type="button" class="btn-secondary upload" onclick={() => fileInput?.click()}>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10" />
    </svg>
    Upload {kind === 'image' ? 'an image' : 'a video'}
  </button>
  <input
    bind:this={fileInput}
    type="file"
    hidden
    multiple={kind === 'image'}
    accept={kind === 'image' ? 'image/*' : 'video/*'}
    onchange={onPicked}
  />
</div>

<style>
  .media-prompt {
    position: fixed;
    z-index: var(--z-popover);
    width: 320px;
    max-width: calc(100vw - 16px);
    padding: 10px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-ui);
    animation: popIn var(--dur-pop) var(--ease-spring);
    transform-origin: top left;
  }
  .row { display: flex; gap: 6px; }
  input[type='url'] {
    flex: 1;
    min-width: 0;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--input-bg-strong, var(--glass-dark));
    color: var(--text);
    font: inherit;
    font-size: 0.8125rem;
    outline: none;
  }
  input[type='url']:focus { border-color: var(--accent); }
  .row .btn-primary { height: 30px; padding: 0 12px; font-size: 0.8125rem; }
  .or {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
    font-size: 0.7rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .or::before,
  .or::after { content: ''; flex: 1; border-top: 1px solid var(--line); }
  .upload {
    width: 100%;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 0.8125rem;
  }
  .upload svg { width: 14px; height: 14px; }
</style>
