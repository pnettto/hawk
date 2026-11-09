<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { confirmStore } from '../../stores/confirm'

  let confirmBtn = $state<HTMLButtonElement | null>(null)
  let dialogEl = $state<HTMLDivElement | null>(null)

  function close(ok: boolean) {
    $confirmStore?.resolve(ok)
    confirmStore.set(null)
  }

  // Focus the confirm button on open, return focus to the opener on close.
  $effect(() => {
    if (!$confirmStore) return
    const opener = document.activeElement as HTMLElement | null
    queueMicrotask(() => confirmBtn?.focus())
    return () => opener?.focus?.()
  })

  function onKey(e: KeyboardEvent) {
    if (!$confirmStore) return
    if (e.key === 'Escape') {
      e.preventDefault()
      close(false)
    } else if (e.key === 'Tab' && dialogEl) {
      const items = dialogEl.querySelectorAll<HTMLElement>('button')
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

<svelte:window onkeydown={onKey} />

{#if $confirmStore}
  <div class="confirm-layer" transition:fade={{ duration: 140 }}>
    <button type="button" class="scrim" aria-label="Cancel" tabindex="-1" onclick={() => close(false)}></button>
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby={$confirmStore.message ? 'confirm-message' : undefined}
      bind:this={dialogEl}
      transition:scale={{ start: 0.96, duration: 180, easing: cubicOut }}
    >
      <h2 id="confirm-title">{$confirmStore.title}</h2>
      {#if $confirmStore.message}
        <p id="confirm-message">{$confirmStore.message}</p>
      {/if}
      <div class="actions">
        <button type="button" class="btn-secondary" onclick={() => close(false)}>Cancel</button>
        <button
          type="button"
          class="btn-primary"
          class:danger={$confirmStore.danger}
          bind:this={confirmBtn}
          onclick={() => close(true)}
        >
          {$confirmStore.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-layer {
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
    width: min(380px, 100%);
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
  p {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.25rem;
  }
  .btn-primary.danger {
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
  }
</style>
