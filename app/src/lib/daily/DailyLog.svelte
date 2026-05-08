<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { appStore } from '../../stores/app'
  import { logsStore } from '../../stores/logs'
  import { savingStore } from '../../stores/saving'
  import { showToast } from '../../stores/toast'
  import { formatDate } from '../../utils/date'
  import { debounce } from '../../utils/debounce'
  import { bindSnapshotTriggers } from '../../utils/snapshotTriggers'
  import HistoryPopover from '../ui/HistoryPopover.svelte'
  import {
    HOURS_END as DEFAULT_END,
    HOURS_START as DEFAULT_START,
  } from '../../utils/constants'
  import type { DayLog, HourEntry } from '../../types/models'

  let hoursStart = $state(DEFAULT_START)
  let hoursEnd = $state(DEFAULT_END)
  let movingFrom = $state<string | null>(null)
  let openComments = $state(new Set<string>())
  let showHistory = $state(false)
  let hoursEl = $state<HTMLDivElement | null>(null)
  let historyAnchorEl = $state<HTMLButtonElement | null>(null)
  let teardownTriggers: (() => void) | null = null

  const isVisuallyEmpty = (html: string) => {
    if (!html) return true
    return (
      html
        .replace(/<(div|p)><br><\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '')
        .replace(/&nbsp;/g, '')
        .trim() === ''
    )
  }

  let dateStr = $derived(formatDate($appStore.selectedDate))
  let dayLogs = $derived(($logsStore.byDate[dateStr] ?? {}) as DayLog)
  let now = new Date()
  let isToday = $derived(formatDate(new Date()) === dateStr)

  type Slot = {
    hourStr: string
    hour: number
    timeText: string
    state: HourEntry
    isCurrent: boolean
  }

  let slots: Slot[] = $derived.by(() => {
    const out: Slot[] = []
    for (let h = hoursStart; h <= hoursEnd; h++) {
      for (const m of [0, 30]) {
        const hourStr = `${h}${m !== 0 ? '-30' : ''}`
        const fromLog = dayLogs[hourStr]
        const state: HourEntry =
          fromLog && typeof fromLog === 'object' && 'checked' in fromLog
            ? (fromLog as HourEntry)
            : { checked: false, text: '', comment: '' }
        const isCurrent =
          isToday &&
          now.getHours() === h &&
          (m === 0 ? now.getMinutes() < 30 : now.getMinutes() >= 30)
        out.push({
          hourStr,
          hour: h,
          timeText: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
          state,
          isCurrent,
        })
      }
    }
    return out
  })

  // Per-row mutable copy so `bind:` works and the debounced save can read latest typing.
  // Use $effect.pre so this runs *before* the DOM update — otherwise the checkbox
  // bind:checked={editing[hourStr].checked} reads `undefined.checked` on first paint.
  //
  // Reseed rules: a slot is "dirty" if the user typed in it since the last save.
  // - Date changed → full reseed from server, dirty cleared
  // - Same date, dirty hour → preserve local edit
  // - Same date, clean hour → take server data (initial KV load, focus refresh, etc.)
  let editing = $state<Record<string, HourEntry>>({})
  let lastSeededDate = ''
  // Plain Set, not $state — purely a tracking sidecar, never read in templates.
  const dirtyHours = new Set<string>()
  $effect.pre(() => {
    const slotsList = slots
    const ds = dateStr
    // Reassigning `editing` inside untrack so the write doesn't retrigger the effect.
    untrack(() => {
      const next: Record<string, HourEntry> = {}
      const fresh = lastSeededDate !== ds
      for (const s of slotsList) {
        const local = editing[s.hourStr]
        next[s.hourStr] = !fresh && local && dirtyHours.has(s.hourStr)
          ? local
          : { ...s.state }
      }
      if (fresh) {
        lastSeededDate = ds
        dirtyHours.clear()
      }
      editing = next
    })
  })

  // Stable per-instance key so the saving store can track this component's
  // pending debounce independently of any other DailyLog mount.
  const PENDING_KEY = `daily-log-${crypto.randomUUID()}`

  const save = debounce(async () => {
    // Debounce just fired — about to start the actual save. Pending → in-flight
    // is owned by savingStore.track() called inside logsStore.saveDay.
    savingStore.clearPending(PENDING_KEY)
    const next: DayLog = { ...dayLogs }
    for (const s of slots) {
      const e = editing[s.hourStr]
      if (!e) continue
      next[s.hourStr] = { checked: e.checked, text: e.text, comment: e.comment }
    }
    // Drop empty hour keys
    for (const key of Object.keys(next)) {
      if (/^\d{1,2}(?:-\d{1,2})?$/.test(key)) {
        const v = next[key] as HourEntry
        if (!v.checked && !v.text && isVisuallyEmpty(v.comment)) delete next[key]
      }
    }
    // Clear dirty before the optimistic byDate update kicks the reseed effect:
    // by then server == local, so taking fresh data is correct.
    dirtyHours.clear()
    try {
      await logsStore.saveDay(dateStr, next)
    } catch (e) {
      console.error('Save failed', e)
    }
  }, 1000)

  function toggleHistory() {
    showHistory = !showHistory
  }

  // Run inside the popover before listing — flushes any pending typing and
  // captures a checkpoint so the popover always opens against fresh state.
  async function prepareHistory() {
    save.cancel()
    savingStore.clearPending(PENDING_KEY)
    dirtyHours.clear()
    const next = buildLatestDayLog()
    logsStore.updateLog(dateStr, next)
    await logsStore.snapshotAndSave(dateStr, next, 'tasks')
  }

  // Build the latest DayLog from the in-memory `editing` map (same shape as
  // the debounced save), without going through the debouncer. Used by the
  // snapshot trigger so the snapshot reflects the user's last keystrokes.
  function buildLatestDayLog(): DayLog {
    const next: DayLog = { ...dayLogs }
    for (const s of slots) {
      const e = editing[s.hourStr]
      if (!e) continue
      next[s.hourStr] = { checked: e.checked, text: e.text, comment: e.comment }
    }
    for (const key of Object.keys(next)) {
      if (/^\d{1,2}(?:-\d{1,2})?$/.test(key)) {
        const v = next[key] as HourEntry
        if (!v.checked && !v.text && isVisuallyEmpty(v.comment)) delete next[key]
      }
    }
    return next
  }

  $effect(() => {
    teardownTriggers?.()
    teardownTriggers = null
    const ds = dateStr
    const el = hoursEl
    if (!el) return
    teardownTriggers = bindSnapshotTriggers(el, async () => {
      save.cancel()
      savingStore.clearPending(PENDING_KEY)
      dirtyHours.clear()
      const next = buildLatestDayLog()
      logsStore.updateLog(ds, next)
      await logsStore.snapshotAndSave(ds, next, 'tasks')
    })
  })

  onDestroy(() => {
    save.flush()
    savingStore.clearPending(PENDING_KEY)
    teardownTriggers?.()
    teardownTriggers = null
  })

  function onInput(hourStr: string) {
    dirtyHours.add(hourStr)
    savingStore.markPending(PENDING_KEY)
    save()
  }

  function onToggleComment(hourStr: string) {
    const next = new Set(openComments)
    if (next.has(hourStr)) next.delete(hourStr)
    else next.add(hourStr)
    openComments = next
  }

  async function onClearHour(hourStr: string) {
    const prev = dayLogs[hourStr] as HourEntry | undefined
    if (!prev) return
    const next: DayLog = { ...dayLogs }
    delete next[hourStr]
    await logsStore.saveDay(dateStr, next)
    showToast('Hour cleared', {
      action: 'Undo',
      duration: 6000,
      onAction: async () => {
        const cur = ($logsStore.byDate[dateStr] ?? {}) as DayLog
        await logsStore.saveDay(dateStr, { ...cur, [hourStr]: prev })
      },
    })
  }

  async function onTimeClick(slot: Slot) {
    if (movingFrom) {
      if (movingFrom === slot.hourStr) {
        movingFrom = null
      } else {
        const e = editing[slot.hourStr]
        const isEmpty = !e?.text && isVisuallyEmpty(e?.comment ?? '')
        if (isEmpty) {
          const fromVal = (dayLogs[movingFrom] ?? editing[movingFrom]) as
            | HourEntry
            | undefined
          if (fromVal) {
            const next: DayLog = { ...dayLogs }
            next[slot.hourStr] = fromVal
            delete next[movingFrom]
            await logsStore.saveDay(dateStr, next)
          }
          movingFrom = null
        } else {
          movingFrom = slot.hourStr
        }
      }
    } else {
      const e = editing[slot.hourStr]
      if (e?.text || !isVisuallyEmpty(e?.comment ?? '')) movingFrom = slot.hourStr
    }
  }

  function goUp() {
    if (hoursStart === 1) return
    hoursStart -= 1
    hoursEnd -= 1
  }
  function goDown() {
    if (hoursEnd === 23) return
    hoursStart += 1
    hoursEnd += 1
  }

  let canGoUp = $derived(hoursStart > 1)
  let canGoDown = $derived(hoursEnd < 23)
</script>

<div class="hours-edge top">
  <div class="hours-actions">
    <div class="hours-history">
      <button
        class="edge-btn history-toggle"
        title="Version history"
        aria-label="Version history"
        bind:this={historyAnchorEl}
        onclick={toggleHistory}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
      {#if showHistory}
        <HistoryPopover
          kind="day-tasks"
          entityId={dateStr}
          anchor={historyAnchorEl}
          prepare={prepareHistory}
          onClose={() => (showHistory = false)}
        />
      {/if}
    </div>
    <button
      class="edge-btn hours-nudge"
      title="Show earlier hour"
      aria-label="Show earlier hour"
      disabled={!canGoUp}
      onclick={goUp}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3.5 10l4.5-4.5 4.5 4.5"/>
      </svg>
    </button>
    <button
      class="edge-btn hours-nudge"
      title="Show later hour"
      aria-label="Show later hour"
      disabled={!canGoDown}
      onclick={goDown}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3.5 6l4.5 4.5 4.5-4.5"/>
      </svg>
    </button>
  </div>
</div>

<div class="hours" bind:this={hoursEl}>
  {#each slots as slot (slot.hourStr)}
    {@const e = editing[slot.hourStr] ?? slot.state}
    {@const notEmpty = !!e.text || !isVisuallyEmpty(e.comment)}
    {@const isComment = !isVisuallyEmpty(e.comment)}
    {@const isMovingSrc = movingFrom === slot.hourStr}
    {@const isMovingTgt = !!movingFrom && movingFrom !== slot.hourStr && !e.text && isVisuallyEmpty(e.comment)}
    <div
      class="hour-row"
      class:highlighted={slot.isCurrent}
      class:not-empty={notEmpty}
      class:is-comment={isComment}
      class:moving-source={isMovingSrc}
      class:moving-target={isMovingTgt}
    >
      <button
        type="button"
        class="hour-time"
        onclick={() => onTimeClick(slot)}
      >
        {slot.timeText}
      </button>
      <div class="hour-controls">
        <button
          class="hour-comment-switch"
          title="Toggle note"
          aria-label="Toggle note"
          aria-pressed={openComments.has(slot.hourStr)}
          onclick={() => onToggleComment(slot.hourStr)}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 2.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 3v-3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/>
          </svg>
        </button>
        <div class="hour-checkbox-wrap">
          <input
            type="checkbox"
            class="hour-checkbox"
            bind:checked={editing[slot.hourStr].checked}
            onchange={() => onInput(slot.hourStr)}
          />
        </div>
        <div class="hour-text-content">
          <input
            class="hour-input"
            bind:value={editing[slot.hourStr].text}
            oninput={() => onInput(slot.hourStr)}
          />
          <div
            class="hour-comment"
            class:hidden={!openComments.has(slot.hourStr)}
            contenteditable="true"
            bind:innerHTML={editing[slot.hourStr].comment}
            oninput={() => onInput(slot.hourStr)}
          ></div>
        </div>
        <button
          class="hour-comment-clear"
          title="Clear hour"
          aria-label="Clear hour"
          onclick={() => onClearHour(slot.hourStr)}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8"/>
          </svg>
        </button>
      </div>
    </div>
  {/each}
</div>


<style>
  .hours {
    display: flex;
    flex-direction: column;
    margin-bottom: 2rem;
    gap: 2px;
  }
  .hour-row {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 0.25rem;
    padding: 0.4rem 0.5rem;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  @media (max-width: 480px) {
    .hour-row {
      grid-template-columns: auto minmax(0, 1fr);
      padding: 0.4rem 0.2rem;
      gap: 0.1rem;
    }
  }
  .hour-row.not-empty,
  .hour-row:hover,
  .hour-row:focus-within {
    background-color: var(--glass-dark);
    border-radius: 0.25rem;
  }
  .hour-time {
    background: none;
    border: 0;
    font-family: inherit;
    color: var(--muted);
    text-align: right;
    font-size: 0.8rem;
    padding: 0.35rem 0.2rem;
    cursor: pointer;
    user-select: none;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'tnum' 1;
  }
  @media (max-width: 480px) {
    .hour-time {
      font-size: 0.75rem;
      padding: 0.5rem 0.1rem;
    }
  }
  .hour-row.moving-source .hour-time {
    background-color: var(--accent);
    color: #022;
    border-radius: 4px;
  }
  .hour-row.moving-target .hour-time { color: var(--accent); }
  .hour-row.moving-target .hour-time:hover { text-decoration: underline; }
  .hour-controls {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: start;
  }
  .hour-text-content {
    display: flex;
    flex-direction: column;
  }
  .hour-comment-switch {
    background: none;
    padding: 0.4rem;
    border: none;
    cursor: pointer;
    color: var(--muted);
    opacity: 0.2;
    min-width: 2rem;
    min-height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: opacity var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .hour-comment-switch svg { width: 14px; height: 14px; display: block; }
  .hour-row:hover .hour-comment-switch,
  .hour-row:focus-within .hour-comment-switch { opacity: 0.5; }
  .hour-comment-switch:hover { opacity: 1 !important; color: var(--text); background: rgba(255, 255, 255, 0.06); }
  .hour-row.is-comment .hour-comment-switch { opacity: 0.7; color: var(--accent); }
  .hour-checkbox-wrap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
  }
  .hour-checkbox {
    appearance: none;
    width: 0.75rem;
    height: 0.75rem;
    margin: 0;
    border-radius: 50%;
    background: var(--glass);
    cursor: pointer;
    position: relative;
    transition: all 0.18s ease;
  }
  .hour-checkbox:checked {
    background: var(--accent);
    border: 0;
  }
  .hour-input,
  .hour-comment {
    border: 0;
    background: transparent;
    padding: 0 0.5rem;
    font-size: 1rem;
    color: inherit;
    line-height: 1.9;
    outline: none;
    cursor: pointer;
  }
  .hour-input:focus,
  .hour-comment:focus { cursor: text; }
  .hour-comment {
    margin-top: 0.5rem;
    font-size: 1rem;
    min-height: 3rem;
    opacity: 0.6;
    white-space: pre-wrap;
  }
  .hour-comment-clear {
    background: none;
    padding: 0.4rem;
    border: none;
    cursor: pointer;
    color: var(--muted);
    opacity: 0;
    min-width: 2rem;
    min-height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: opacity var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .hour-comment-clear svg { width: 12px; height: 12px; display: block; }
  .hour-row.not-empty .hour-comment-clear,
  .hour-row:hover .hour-comment-clear,
  .hour-row:focus-within .hour-comment-clear { opacity: 0.4; }
  .hour-comment-clear:hover { opacity: 1 !important; color: #ff5b5b; background: rgba(255, 91, 91, 0.08); }
  @media (hover: none) {
    .hour-comment-clear { opacity: 0.4; }
  }
  .highlighted .hour-time { color: var(--accent); }
  .highlighted { color: var(--accent); }
  .hidden { display: none !important; }
  .hours-edge {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    height: 1.75rem;
  }
  .hours-edge.top {
    margin-bottom: 0.5rem;
  }
  .hours-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .hours-history {
    position: relative;
    display: flex;
    align-items: center;
    /* Avoid `transform` on this or any ancestor — it creates a new containing
       block for the fixed-positioned HistoryPopover and breaks viewport anchoring. */
  }
  .edge-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--muted);
    cursor: pointer;
    opacity: 0.55;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .edge-btn svg { width: 14px; height: 14px; display: block; }
  .hours-edge:hover .edge-btn { opacity: 0.85; }
  .edge-btn:hover {
    opacity: 1;
    color: var(--text);
    background: rgba(255, 255, 255, 0.08);
    border-color: var(--accent);
  }
  .edge-btn:disabled {
    cursor: default;
    opacity: 0.3 !important;
    background: transparent;
    border-color: transparent;
  }
</style>
