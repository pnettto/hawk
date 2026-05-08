<script lang="ts">
  import { toastStore } from '../../stores/toast'

  function handleAction(id: number, onAction?: () => void) {
    onAction?.()
    toastStore.dismiss(id)
  }
</script>

<div class="hawk-toast-host" aria-live="polite">
  {#each $toastStore as toast (toast.id)}
    <div class="hawk-toast visible" class:error={toast.type === 'error'} role="status">
      <span>{toast.message}</span>
      {#if toast.action}
        <button
          type="button"
          class="hawk-toast-action"
          on:click={() => handleAction(toast.id, toast.onAction)}
        >
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
    bottom: 1.5rem;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    z-index: 10000;
    pointer-events: none;
  }
  .hawk-toast {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.9rem;
    background: var(--panel, #272b31);
    color: var(--text, #dfe1e5);
    border: 1px solid var(--line, #2f3339);
    border-radius: 6px;
    font-family: 'code-saver', ui-monospace, monospace;
    font-size: 0.85rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    opacity: 0;
    transform: translateY(8px);
    transition:
      opacity 180ms var(--ease-out, cubic-bezier(0.2, 0, 0, 1)),
      transform 180ms var(--ease-out, cubic-bezier(0.2, 0, 0, 1));
  }
  .hawk-toast.visible {
    opacity: 1;
    transform: translateY(0);
  }
  .hawk-toast-action {
    background: none;
    border: none;
    color: var(--accent, #e6b84d);
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
  }
  .hawk-toast-action:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .hawk-toast.error {
    border-color: #ff6b6b;
  }
  .hawk-toast.error::before {
    content: '!';
    color: #ff6b6b;
    font-weight: bold;
  }
</style>
