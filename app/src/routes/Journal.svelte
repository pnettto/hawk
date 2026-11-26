<script lang="ts">
  import { appStore } from '../stores/app'
  import DatePicker from '../lib/daily/DatePicker.svelte'
  import DayTasks from '../lib/daily/DayTasks.svelte'
  import DayNotes from '../lib/daily/DayNotes.svelte'

  // ←/→ change day, T jumps to today — only when not typing somewhere.
  function onKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
    const t = e.target as HTMLElement | null
    if (t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
    const shift = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (shift) {
      e.preventDefault()
      const d = new Date($appStore.selectedDate)
      d.setDate(d.getDate() + shift)
      appStore.setSelectedDate(d)
    } else if (e.key === 't' || e.key === 'T') {
      appStore.setSelectedDate(new Date())
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="journal-workspace">
  <header class="app-header">
    <div class="header-left">
      <DatePicker />
    </div>
    <div class="journal-tabs" role="tablist" aria-label="Journal">
      {#each [['tasks', 'Tasks'], ['notes', 'Day Notes']] as [id, label] (id)}
        <button
          role="tab"
          aria-selected={$appStore.journalTab === id}
          class:active={$appStore.journalTab === id}
          onclick={() => appStore.setJournalTab(id as 'notes' | 'tasks')}>{label}</button
        >
      {/each}
    </div>
  </header>

  <div class="journal-body">
    {#if $appStore.journalTab === 'tasks'}
      <DayTasks />
    {:else}
      <DayNotes />
    {/if}
  </div>
</div>

<style>
  .journal-workspace {
    min-width: 0;
    border-radius: var(--r-md);
    background: var(--bg);
  }
  .app-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: var(--workspace-header-height);
    padding: 0.75rem 1rem;
  }
  .journal-body {
    min-width: 0;
    min-height: 24rem;
    padding: 1.5rem;
  }
  @media (max-width: 900px) {
    .app-header {
      gap: 0.5rem;
      padding: 0.5rem;
    }
    .journal-body {
      padding: 0.75rem 0.5rem;
    }
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }
  .journal-tabs {
    display: flex;
    gap: 0.25rem;
    font-family: var(--font-ui, inherit);
  }
  .journal-tabs button {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.6875rem;
    height: var(--h-sm);
    padding: 0 0.8rem;
    border-radius: var(--r-sm);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .journal-tabs button:hover {
    color: var(--text);
    background: var(--glass-dark);
  }
  @media (pointer: coarse) {
    .journal-tabs button { height: 36px; }
  }
  .journal-tabs button.active {
    color: var(--accent);
    background: var(--glass);
  }
  @media (max-width: 600px) {
    .app-header {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem 0.5rem;
      min-height: 0;
      padding: 0.25rem 0.25rem 0.5rem;
    }
    .header-left {
      flex: 1 1 auto;
      min-width: 0;
      gap: 0.25rem;
    }
    .journal-tabs {
      flex: 0 1 auto;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .journal-tabs::-webkit-scrollbar { display: none; }
    .journal-tabs button { flex-shrink: 0; }
    .journal-body {
      padding: 0.5rem 0.25rem;
    }
  }
</style>
