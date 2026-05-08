<script lang="ts">
  import type { ThemeMeta } from './themes'
  import { preferencesStore } from '../../stores/preferences'

  interface Props {
    theme: ThemeMeta
  }
  let { theme }: Props = $props()

  let active = $derived($preferencesStore.theme === theme.id)

  // Inline style overrides on the preview, so each card paints its own palette
  // regardless of the page's currently-active theme.
  let previewStyle = $derived(
    `--p-bg:${theme.swatch.bg};` +
    `--p-panel:${theme.swatch.panel};` +
    `--p-text:${theme.swatch.text};` +
    `--p-accent:${theme.swatch.accent};`
  )
</script>

<button
  class="card"
  class:active
  type="button"
  aria-pressed={active}
  onclick={() => preferencesStore.setTheme(theme.id)}
  style={previewStyle}
>
  <div class="preview">
    <div class="title-row">
      <span class="dot" aria-hidden="true"></span>
      <span class="bar bar-title"></span>
    </div>
    <div class="body-row">
      <span class="bar bar-line"></span>
      <span class="bar bar-line short"></span>
      <span class="bar bar-line"></span>
    </div>
    <div class="aa">Aa</div>
  </div>
  <div class="meta">
    <span class="name">{theme.name}</span>
    <span class="mode">{theme.mode}</span>
    {#if active}
      <svg class="check" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    {/if}
  </div>
</button>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.5rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    cursor: pointer;
    color: var(--text);
    font: inherit;
    text-align: left;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }
  .card:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .card.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .preview {
    position: relative;
    background: var(--p-bg);
    border-radius: 8px;
    padding: 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    aspect-ratio: 16 / 9;
    overflow: hidden;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--p-accent);
  }
  .bar {
    background: var(--p-panel);
    border-radius: 3px;
    height: 6px;
  }
  .bar-title { flex: 1; }
  .body-row {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .bar-line {
    background: var(--p-text);
    opacity: 0.55;
    height: 4px;
    width: 100%;
  }
  .bar-line.short { width: 60%; }
  .aa {
    position: absolute;
    right: 0.7rem;
    bottom: 0.45rem;
    color: var(--p-accent);
    font-family: var(--font-ui, inherit);
    font-weight: 600;
    font-size: 1.1rem;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.2rem 0.15rem;
  }
  .name {
    font-size: 0.85rem;
    color: var(--text);
  }
  .mode {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
    padding: 2px 6px;
    border: 1px solid var(--line);
    border-radius: 999px;
  }
  .check {
    margin-left: auto;
    width: 14px;
    height: 14px;
    color: var(--accent);
  }
</style>
