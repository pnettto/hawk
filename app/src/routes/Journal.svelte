<script lang="ts">
  import { appStore } from '../stores/app'
  import DatePicker from '../lib/daily/DatePicker.svelte'
  import DailyLog from '../lib/daily/DailyLog.svelte'
  import DayNotes from '../lib/daily/DayNotes.svelte'
</script>

<header class="app-header">
  <div class="header-left">
    <DatePicker />
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
  </div>
</header>

{#if $appStore.journalTab === 'tasks'}
  <DailyLog />
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
  .journal-tabs {
    display: flex;
    gap: 1.5rem;
  }
  .journal-tabs button {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8rem;
    padding: 0;
    text-transform: uppercase;
    letter-spacing: 0.05rem;
  }
  .journal-tabs button.active { color: var(--accent); }
</style>
