<script lang="ts">
  import { appStore } from '../stores/app'
  import DatePicker from '../lib/daily/DatePicker.svelte'
  import DailyLog from '../lib/daily/DailyLog.svelte'
  import DayNotes from '../lib/daily/DayNotes.svelte'
  import Report from './Report.svelte'

  const today = new Date()
  const lastWeek = new Date()
  lastWeek.setDate(today.getDate() - 6)

  let reportStart = $state(lastWeek)
  let reportEnd = $state(today)
</script>

<header class="app-header">
  <div class="header-left">
    {#if $appStore.journalTab === 'report'}
      <div class="range">
        <DatePicker value={reportStart} onSelect={(d) => (reportStart = d)} hideArrows />
        <span class="range-sep" aria-hidden="true">→</span>
        <DatePicker value={reportEnd} onSelect={(d) => (reportEnd = d)} hideArrows />
      </div>
    {:else}
      <DatePicker />
    {/if}
  </div>
  <div class="journal-tabs">
    <button
      class:active={$appStore.journalTab === 'notes'}
      onclick={() => appStore.setJournalTab('notes')}>Day Notes</button
    >
    <button
      class:active={$appStore.journalTab === 'tasks'}
      onclick={() => appStore.setJournalTab('tasks')}>Tasks</button
    >
    <button
      class:active={$appStore.journalTab === 'report'}
      onclick={() => appStore.setJournalTab('report')}>Report</button
    >
  </div>
</header>

{#if $appStore.journalTab === 'tasks'}
  <DailyLog />
{:else if $appStore.journalTab === 'report'}
  <Report startDate={reportStart} endDate={reportEnd} />
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
    font-size: 0.72rem;
    padding: 0.4rem 0.75rem;
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
  .journal-tabs button.active {
    color: var(--accent);
    background: var(--glass);
  }
</style>
