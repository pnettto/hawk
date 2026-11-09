<script lang="ts">
  import { appStore } from '../stores/app'
  import DatePicker from '../lib/daily/DatePicker.svelte'
  import DayTasks from '../lib/daily/DayTasks.svelte'
  import DayNotes from '../lib/daily/DayNotes.svelte'
  import Overview from './Overview.svelte'

  // ←/→ change day, T jumps to today — only when not typing somewhere.
  function onKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
    if ($appStore.journalTab === 'overview') return
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

<header class="app-header">
  <div class="header-left">
    {#if $appStore.journalTab === 'overview'}
      <div class="range">
        <DatePicker
          value={$appStore.overviewStart}
          onSelect={(d) => appStore.setOverviewRange(d, $appStore.overviewEnd)}
          hideArrows
        />
        <span class="range-sep" aria-hidden="true">→</span>
        <DatePicker
          value={$appStore.overviewEnd}
          onSelect={(d) => appStore.setOverviewRange($appStore.overviewStart, d)}
          hideArrows
        />
      </div>
    {:else}
      <DatePicker />
    {/if}
  </div>
  <div class="journal-tabs" role="tablist" aria-label="Journal">
    {#each [['notes', 'Day Notes'], ['tasks', 'Tasks'], ['overview', 'Overview']] as [id, label] (id)}
      <button
        role="tab"
        aria-selected={$appStore.journalTab === id}
        class:active={$appStore.journalTab === id}
        onclick={() => appStore.setJournalTab(id as 'notes' | 'tasks' | 'overview')}>{label}</button
      >
    {/each}
  </div>
</header>

{#if $appStore.journalTab === 'tasks'}
  <DayTasks />
{:else if $appStore.journalTab === 'overview'}
  <Overview />
{:else}
  <DayNotes />
{/if}

<style>
  .app-header {
    margin-bottom: 2rem;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    border-bottom: 1px solid var(--line);
    padding-bottom: 0.5rem;
  }
  @media (max-width: 600px) {
    .app-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }
  .range {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
    margin-left: -18px;
  }
  .range-sep {
    color: var(--muted);
    opacity: 0.6;
    font-size: 0.9rem;
    padding: 0 0.25rem;
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
    border-radius: 999px;
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
</style>
