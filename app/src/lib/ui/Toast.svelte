<script lang="ts">
  import { safeFlip } from '../../utils/safeFlip'
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { toastStore } from '../../stores/toast'

  function handleAction(id: number, onAction?: () => void) {
    onAction?.()
    toastStore.dismiss(id)
  }
</script>

<div class="hawk-toast-host">
  {#each $toastStore as toast (toast.id)}
    <div
      class="hawk-toast"
      class:error={toast.type === 'error'}
      role={toast.type === 'error' ? 'alert' : 'status'}
      in:fly={{ y: 8, duration: 180, easing: cubicOut }}
      out:fade={{ duration: 120 }}
      animate:safeFlip={{ duration: 180 }}
    >
      {#if toast.type === 'error'}
        <svg class="err-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
          <circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 11h.01" />
        </svg>
      {/if}
      <span class="msg">{toast.message}</span>
      {#if toast.action}
        <button type="button" class="hawk-toast-action" onclick={() => handleAction(toast.id, toast.onAction)}>
          {toast.action}
        </button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .hawk-toast-host {
    position: fixed;
    left: 50%;
    bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    z-index: var(--z-toast);
    pointer-events: none;
    width: max-content;
    max-width: calc(100vw - 2rem);
  }
  .hawk-toast {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 40px;
    padding: 0.45rem 0.5rem 0.45rem 0.9rem;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-ui);
    font-size: 0.875rem;
  }
  .msg { padding-right: 0.4rem; }
  .hawk-toast-action {
    background: none;
    border: none;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    padding: 0.3rem 0.6rem;
    border-radius: var(--r-sm);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .hawk-toast-action:hover { background: var(--glass-dark); }
  .hawk-toast.error { border-color: color-mix(in srgb, var(--danger) 60%, var(--line)); }
  .err-icon { width: 15px; height: 15px; color: var(--danger); flex-shrink: 0; }
</style>
