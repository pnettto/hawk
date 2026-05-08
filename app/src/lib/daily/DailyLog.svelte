<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { appStore } from '../../stores/app'
  import { logsStore } from '../../stores/logs'
  import { savingStore } from '../../stores/saving'
  import { showToast } from '../../stores/toast'
  import { formatDate } from '../../utils/date'
  import { debounce } from '../../utils/debounce'
  import {
    HOURS_END as DEFAULT_END,
    HOURS_START as DEFAULT_START,
  } from '../../utils/constants'
  import type { DayLog, HourEntry } from '../../types/models'

  let hoursStart = $state(DEFAULT_START)
  let hoursEnd = $state(DEFAULT_END)
  let showingAllHours = $state(false)
  let movingFrom = $state<string | null>(null)
  let openComments = $state(new Set<string>())

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

  onDestroy(() => {
    save.flush()
    savingStore.clearPending(PENDING_KEY)
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
  function toggleExpand() {
    if (showingAllHours) {
      hoursStart = DEFAULT_START
      hoursEnd = DEFAULT_END
      showingAllHours = false
    } else {
      hoursStart = 7
      hoursEnd = 20
      showingAllHours = true
    }
  }

  let canGoUp = $derived(hoursStart > 1)
  let canGoDown = $derived(hoursEnd < 23)
</script>

<div class="hours-edge top">
  <button
    class="hours-nudge"
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
    class="hours-expand"
    title={showingAllHours ? 'Collapse hours' : 'Expand hours'}
    aria-label={showingAllHours ? 'Collapse hours' : 'Expand hours'}
    onclick={toggleExpand}
  >
    {#if showingAllHours}
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9.5 2.5v4h4M2.5 9.5h4v4"/>
        <path d="M9.5 6.5l4-4M6.5 9.5l-4 4"/>
      </svg>
    {:else}
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2.5 6.5v-4h4M13.5 9.5v4h-4"/>
        <path d="M2.5 2.5l4 4M13.5 13.5l-4-4"/>
      </svg>
    {/if}
  </button>
</div>

<div class="hours">
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

<div class="hours-edge bottom">
  <button
    class="hours-nudge"
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
    justify-content: center;
    gap: 0.5rem;
    height: 1.25rem;
  }
  .hours-edge.top {
    margin-bottom: 0.25rem;
    position: relative;
  }
  .hours-edge.bottom {
    margin-top: 0.25rem;
    margin-bottom: 1rem;
  }
  .hours-nudge,
  .hours-expand {
    background: none;
    border: 0;
    color: var(--muted);
    cursor: pointer;
    opacity: 0.15;
    padding: 4px 8px;
    line-height: 1;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: opacity var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .hours-nudge svg,
  .hours-expand svg { width: 14px; height: 14px; display: block; }
  .hours-edge:hover .hours-nudge,
  .hours-edge:hover .hours-expand { opacity: 0.55; }
  .hours-nudge:hover,
  .hours-expand:hover { opacity: 1 !important; color: var(--text); background: rgba(255, 255, 255, 0.05); }
  .hours-nudge:disabled {
    cursor: default;
    opacity: 0.05 !important;
  }
  .hours-expand {
    position: absolute;
    right: 0.5rem;
  }
</style>
