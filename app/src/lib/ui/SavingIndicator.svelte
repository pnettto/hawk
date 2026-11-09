<script lang="ts">
  import { fade } from 'svelte/transition'
  import { savingStore } from '../../stores/saving'

  // Lives inline in the nav. Defer the "saving" pulse by 400ms so quick saves
  // don't flicker; errors show immediately and stay until a save succeeds.
  let visible = $state(false)
  let showTimer: ReturnType<typeof setTimeout> | null = null

  $effect(() => {
    const busy = $savingStore.inFlight > 0
    if (busy) {
      if (!visible && !showTimer) {
        showTimer = setTimeout(() => {
          visible = true
          showTimer = null
        }, 400)
      }
    } else {
      if (showTimer) {
        clearTimeout(showTimer)
        showTimer = null
      }
      visible = false
    }
  })

  let hasError = $derived($savingStore.hasError)
</script>

<span class="saving-slot" aria-live="polite">
  {#if hasError}
    <span class="dot error" title="Couldn’t save — retrying" transition:fade={{ duration: 160 }}>
      <span class="sr-only">Couldn’t save — retrying</span>
    </span>
  {:else if visible}
    <span class="dot" title="Saving…" transition:fade={{ duration: 160 }}>
      <span class="sr-only">Saving…</span>
    </span>
  {/if}
</span>

<style>
  .saving-slot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--muted);
    animation: pulse 1s infinite ease-in-out;
  }
  .dot.error {
    width: 8px;
    height: 8px;
    background: var(--danger);
    animation: none;
    box-shadow: 0 0 0 3px var(--danger-bg);
  }
  @keyframes pulse {
    0% { transform: scale(0.8); opacity: 0.5; }
    50% { transform: scale(1.2); opacity: 1; }
    100% { transform: scale(0.8); opacity: 0.5; }
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
