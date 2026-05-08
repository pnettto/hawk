<script lang="ts">
  import { savingStore } from '../../stores/saving'

  // Defer the "Saving…" pulse by 400ms so quick saves don't flicker.
  let visible = $state(false)
  let showTimer: ReturnType<typeof setTimeout> | null = null

  $effect(() => {
    const inFlight = $savingStore.inFlight
    if (inFlight > 0) {
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
      // Keep the error pill visible until something clears it.
      if (!$savingStore.hasError) visible = false
    }
  })

  let showError = $derived($savingStore.hasError)
</script>

{#if visible || showError}
  <div class="saving-indicator visible" class:error={showError}>
    {#if showError}
      <span class="error-text">Could not be saved</span>
    {:else}
      <div class="spinner"></div>
    {/if}
  </div>
{/if}

<style>
  .saving-indicator {
    position: fixed;
    top: 2rem;
    right: 2rem;
    font-size: 0.8rem;
    color: var(--muted);
    transition: opacity 0.3s;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    z-index: 9999;
  }
  .spinner {
    width: 6px;
    height: 6px;
    background: var(--muted);
    border-radius: 50%;
    animation: pulse 1s infinite ease-in-out;
  }
  @keyframes pulse {
    0% { transform: scale(0.8); opacity: 0.5; }
    50% { transform: scale(1.2); opacity: 1; }
    100% { transform: scale(0.8); opacity: 0.5; }
  }
  .saving-indicator.error {
    color: #ff4444;
    font-weight: bold;
  }
</style>
