<script lang="ts">
  import { onDestroy } from 'svelte'
  import { appStore } from '../../stores/app'
  import { logsStore } from '../../stores/logs'
  import { savingStore } from '../../stores/saving'
  import { formatDate } from '../../utils/date'
  import { debounce } from '../../utils/debounce'
  import RichEditor from '../editor/RichEditor.svelte'
  import type { DayLog } from '../../types/models'

  const PENDING_KEY = `day-notes-${crypto.randomUUID()}`

  let dateStr = $derived(formatDate($appStore.selectedDate))
  let day = $derived(($logsStore.byDate[dateStr] ?? {}) as DayLog)
  let value = $state('')

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

  onDestroy(() => {
    save.flush()
    savingStore.clearPending(PENDING_KEY)
  })
</script>

<section class="notes">
  {#key dateStr}
    <RichEditor {value} {onChange} placeholder="Notes for the day..." />
  {/key}
</section>

<style>
  .notes {
    margin-top: 1rem;
  }
</style>
