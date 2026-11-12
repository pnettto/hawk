<script lang="ts">
  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import {
    EXTENSION_ID,
    ensureServiceWorker,
    formatClock,
    phaseMs,
    pomodoroStore,
  } from '../../stores/pomodoro'
  import { logsStore } from '../../stores/logs'
  import { preferencesStore } from '../../stores/preferences'
  import { extensionState } from '../extensions/registry'

  let state = $derived($pomodoroStore)
  let ext = $derived(extensionState($preferencesStore.extensions, EXTENSION_ID))
  // Break keeps the task around so the countdown still has a label.
  let active = $derived(ext.enabled && (state.taskId !== null || state.mode === 'break'))
  let left = $derived(state.remainingMs)
  let progress = $derived.by(() => {
    const total = phaseMs(state)
    return total ? Math.min(1, Math.max(0, 1 - left / total)) : 0
  })
  // The row is the truth for the text, so renaming a task updates the widget.
  let label = $derived(
    state.taskId && state.dateStr
      ? ($logsStore.byDate[state.dateStr]?.tasks.find((t) => t.id === state.taskId)?.text ??
          state.taskText)
      : state.taskText,
  )

  onMount(() => pomodoroStore.tick())

  // Notifications live in the service worker, so keep it registered while the
  // extension is on. The extension can arrive from the server after mount.
  $effect(() => {
    if (ext.enabled) void ensureServiceWorker()
  })

  // Turning the extension off on this device stops the timer. Only react to
  // an actual on→off change: before preferences load (or on a device that
  // never enabled it) `ext.enabled` is already false and shouldn't cancel a
  // timer that's running elsewhere.
  let wasEnabled = false
  $effect(() => {
    if (ext.enabled) {
      wasEnabled = true
      return
    }
    if (wasEnabled && $pomodoroStore.taskId) pomodoroStore.stop()
    wasEnabled = false
  })

  // Background tabs throttle the one-second ticker, so also wake up exactly
  // when the block ends: that's what makes the notification timely.
  let endsAt = $derived(state.running ? state.endsAt : null)
  $effect(() => {
    if (endsAt === null) return
    const id = setTimeout(() => pomodoroStore.tick(), Math.max(0, endsAt - Date.now()) + 100)
    return () => clearTimeout(id)
  })

  // One ticker for the whole app: it runs whether or not the Journal is open.
  $effect(() => {
    if (!state.running) return
    const id = setInterval(() => pomodoroStore.tick(), 1000)
    // Catch up immediately after the tab was asleep.
    const onVisible = () => {
      if (document.visibilityState === 'visible') pomodoroStore.tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  })
</script>

{#if active}
  <div
    class="pomodoro"
    class:break={state.mode === 'break'}
    class:paused={!state.running}
    role="group"
    aria-label={state.mode === 'focus' ? 'Focus timer' : 'Break timer'}
    in:fly={{ y: 10, duration: 180, easing: cubicOut }}
  >
    <div class="ring" style={`--p: ${progress * 100}%`}>
      <span class="clock">{formatClock(left)}</span>
    </div>
    <div class="body">
      <span class="phase">
        {state.mode === 'focus' ? 'Focus' : 'Break'}
      </span>
      <span class="task" title={label}>{label || 'Step away'}</span>
    </div>
    <div class="controls">
      <button
        type="button"
        class="icon-btn ghost"
        title={state.running ? 'Pause' : 'Resume'}
        aria-label={state.running ? 'Pause timer' : 'Resume timer'}
        onclick={() => pomodoroStore.toggle()}
      >
        {#if state.running}
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="3" height="10" rx="1" /><rect x="9" y="3" width="3" height="10" rx="1" /></svg>
        {:else}
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.2-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5z" /></svg>
        {/if}
      </button>
      <button
        type="button"
        class="icon-btn ghost"
        title={state.mode === 'focus' ? 'Skip to break' : 'Skip break'}
        aria-label={state.mode === 'focus' ? 'Skip to break' : 'Skip break'}
        onclick={() => pomodoroStore.skip()}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3.5 4l6 4-6 4z" fill="currentColor" />
          <path d="M12 4v8" />
        </svg>
      </button>
      <button
        type="button"
        class="icon-btn ghost"
        title="Stop timer"
        aria-label="Stop timer"
        onclick={() => pomodoroStore.stop()}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    </div>
  </div>
{/if}

<style>
  .pomodoro {
    position: fixed;
    right: 1.5rem;
    bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
    z-index: var(--z-popover);
    display: flex;
    align-items: center;
    gap: 0.7rem;
    max-width: min(24rem, calc(100vw - 2rem));
    padding: 0.5rem 0.6rem 0.5rem 0.55rem;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--panel);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-ui);
  }
  .pomodoro.paused { opacity: 0.8; }

  .ring {
    --p: 0%;
    position: relative;
    flex-shrink: 0;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: conic-gradient(
      var(--accent) var(--p),
      color-mix(in srgb, var(--glass) 70%, transparent) 0
    );
    transition: none;
  }
  /* Punch out the middle so the conic gradient reads as a ring. */
  .ring::before {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--panel);
  }
  .clock {
    position: relative;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    color: var(--text);
  }
  .break .ring {
    background: conic-gradient(
      color-mix(in srgb, var(--accent) 55%, var(--muted)) var(--p),
      color-mix(in srgb, var(--glass) 70%, transparent) 0
    );
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    flex: 1;
  }
  .phase {
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .break .phase { color: var(--muted); opacity: 0.75; }
  .task {
    font-size: 0.85rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 0.1rem;
  }
  .controls :global(.icon-btn.ghost) { color: var(--muted); }
  .controls :global(.icon-btn.ghost:hover) { color: var(--text); }

  @media (max-width: 600px) {
    .pomodoro {
      right: 0.75rem;
      left: 0.75rem;
      bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
      max-width: none;
    }
  }
</style>
