<script lang="ts">
  import { portal } from '../utils/portal'
  import { closeMapPrompt, mapPromptStore } from './mapPrompt'
  import { MAP_EXAMPLE, MapDataError, parseMapSource } from './map'

  let request = $derived($mapPromptStore)
  let value = $state('')
  let error = $state('')
  let textarea = $state<HTMLTextAreaElement | null>(null)
  let dialogEl = $state<HTMLDivElement | null>(null)

  $effect(() => {
    const r = $mapPromptStore
    if (!r) return
    const opener = document.activeElement as HTMLElement | null
    value = r.source
    error = ''
    queueMicrotask(() => textarea?.focus())
    return () => opener?.focus?.()
  })

  function cancel() {
    const r = $mapPromptStore
    if (!r) return
    r.onCancel?.()
    closeMapPrompt()
  }

  function save() {
    const r = $mapPromptStore
    if (!r) return
    try {
      parseMapSource(value)
    } catch (e) {
      error = e instanceof MapDataError ? e.message : 'That map data isn’t valid.'
      return
    }
    r.onSave(value)
    closeMapPrompt()
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      save()
    } else if (e.key === 'Tab' && dialogEl) {
      const items = Array.from(dialogEl.querySelectorAll<HTMLElement>('textarea, button'))
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
</script>

{#if request}
  <div class="map-prompt-layer" use:portal>
    <button type="button" class="scrim" aria-label="Cancel" tabindex="-1" onclick={cancel}></button>
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="map-prompt-title"
      tabindex="-1"
      bind:this={dialogEl}
      onkeydown={onKeydown}
    >
      <h2 id="map-prompt-title">{request.title}</h2>
      <p class="hint">Paste a GeoJSON FeatureCollection. Coordinates are [longitude, latitude].</p>
      <textarea
        bind:this={textarea}
        bind:value
        aria-label="Map GeoJSON"
        placeholder={MAP_EXAMPLE}
        rows="14"
        spellcheck="false"
        oninput={() => (error = '')}
      ></textarea>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="actions">
        <button type="button" class="btn-secondary" onclick={cancel}>Cancel</button>
        <button type="button" class="btn-primary" onclick={save}>{request.submitLabel}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .map-prompt-layer {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-overlay) + 10);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .scrim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: var(--scrim);
    backdrop-filter: blur(4px);
    cursor: default;
  }
  .dialog {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(640px, 100%);
    max-height: calc(100vh - 2rem);
    padding: 1.25rem 1.25rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--panel);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-ui);
  }
  h2 {
    margin: 0 0 0.4rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
  }
  .hint {
    margin: 0 0 0.75rem;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--muted);
  }
  textarea {
    flex: 1;
    min-height: 220px;
    width: 100%;
    resize: vertical;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--input-bg-strong, var(--glass-dark));
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.5;
    outline: none;
    tab-size: 2;
  }
  textarea:focus { border-color: var(--accent); }
  .error {
    margin: 0.6rem 0 0;
    font-size: 0.8rem;
    color: var(--danger);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }
</style>
