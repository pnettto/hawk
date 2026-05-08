<script lang="ts">
  import { onDestroy } from 'svelte'
  import { appStore } from '../../stores/app'
  import { logsStore } from '../../stores/logs'
  import { savingStore } from '../../stores/saving'
  import { formatDate } from '../../utils/date'
  import { debounce } from '../../utils/debounce'
  import { bindSnapshotTriggers } from '../../utils/snapshotTriggers'
  import RichEditor from '../editor/RichEditor.svelte'
  import HistoryPopover from '../ui/HistoryPopover.svelte'
  import type { DayLog } from '../../types/models'

  const PENDING_KEY = `day-notes-${crypto.randomUUID()}`

  let dateStr = $derived(formatDate($appStore.selectedDate))
  let day = $derived(($logsStore.byDate[dateStr] ?? {}) as DayLog)
  let value = $state('')
  let showHistory = $state(false)
  let rootEl = $state<HTMLElement | null>(null)
  let historyAnchorEl = $state<HTMLButtonElement | null>(null)
  let teardownTriggers: (() => void) | null = null

  function toggleHistory() {
    showHistory = !showHistory
  }

  async function prepareHistory() {
    save.cancel()
    savingStore.clearPending(PENDING_KEY)
    const cur = ($logsStore.byDate[dateStr] ?? {}) as DayLog
    const next: DayLog = { ...cur, notesMarkdown: value }
    logsStore.updateLog(dateStr, next)
    await logsStore.snapshotAndSave(dateStr, next, 'notes')
  }

  // Re-seed editor content whenever the date changes.
  let lastSeenDate = ''
  $effect(() => {
    if (lastSeenDate !== dateStr) {
      lastSeenDate = dateStr
      value = (day.notesMarkdown as string) ?? ''
    }
  })

  const save = debounce(async () => {
    savingStore.clearPending(PENDING_KEY)
    const cur = ($logsStore.byDate[dateStr] ?? {}) as DayLog
    const next: DayLog = { ...cur, notesMarkdown: value }
    try {
      await logsStore.saveDay(dateStr, next)
    } catch (e) {
      console.error('Failed to save day notes:', e)
    }
  }, 500)

  function onChange(md: string) {
    value = md
    savingStore.markPending(PENDING_KEY)
    save()
  }

  $effect(() => {
    teardownTriggers?.()
    teardownTriggers = null
    if (!rootEl) return
    const ds = dateStr
    teardownTriggers = bindSnapshotTriggers(rootEl, async () => {
      // Cancel the debounce, send the latest value with snapshot=true in one
      // call so the server can diff against the previous live blob.
      save.cancel()
      savingStore.clearPending(PENDING_KEY)
      const cur = ($logsStore.byDate[ds] ?? {}) as DayLog
      const next: DayLog = { ...cur, notesMarkdown: value }
      logsStore.updateLog(ds, next)
      await logsStore.snapshotAndSave(ds, next, 'notes')
    })
  })

  onDestroy(() => {
    save.flush()
    savingStore.clearPending(PENDING_KEY)
    teardownTriggers?.()
    teardownTriggers = null
  })
</script>

<section class="notes" bind:this={rootEl}>
  <button
    type="button"
    class="history-toggle"
    aria-label="Version history"
    title="Version history"
    bind:this={historyAnchorEl}
    onclick={toggleHistory}
  >
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  </button>
  {#if showHistory}
    <HistoryPopover
      kind="day-notes"
      entityId={dateStr}
      anchor={historyAnchorEl}
      prepare={prepareHistory}
      onClose={() => (showHistory = false)}
    />
  {/if}
  {#key dateStr}
    <RichEditor {value} {onChange} placeholder="Notes for the day..." />
  {/key}
</section>

<style>
  .notes {
    margin-top: 1rem;
    position: relative;
  }
  .history-toggle {
    position: absolute;
    top: 0;
    right: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--muted);
    opacity: 0.6;
    cursor: pointer;
    transition: opacity var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
    z-index: 5;
  }
  .notes:hover .history-toggle { opacity: 0.85; }
  .history-toggle:hover {
    opacity: 1;
    color: var(--text);
    border-color: var(--accent);
    background: rgba(255, 255, 255, 0.08);
  }
  .history-toggle:disabled { opacity: 0.4; cursor: default; }
</style>
