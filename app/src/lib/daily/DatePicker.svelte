<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { appStore } from '../../stores/app'
  import { formatDate, prettyDisplay, shortDisplay } from '../../utils/date'

  interface Props {
    value?: Date
    onSelect?: (d: Date) => void
    hideArrows?: boolean
  }
  let { value, onSelect, hideArrows = false }: Props = $props()

  // When no props are passed, the picker is bound to the global selectedDate.
  let currentDate = $derived(value ?? $appStore.selectedDate)
  function commit(d: Date) {
    if (onSelect) onSelect(d)
    else appStore.setSelectedDate(d)
  }

  let showCalendar = $state(false)
  let calendarViewDate = $state(untrack(() => new Date(currentDate)))

  function goPrev() {
    const d = new Date(currentDate)
    d.setDate(d.getDate() - 1)
    commit(d)
  }
  function goNext() {
    const d = new Date(currentDate)
    d.setDate(d.getDate() + 1)
    commit(d)
  }
  function goToday() {
    const today = new Date()
    commit(today)
    calendarViewDate = today
  }
  let triggerEl = $state<HTMLButtonElement | null>(null)
  let modalEl = $state<HTMLDivElement | null>(null)

  async function toggleCalendar() {
    showCalendar = !showCalendar
    if (showCalendar) {
      calendarViewDate = new Date(currentDate)
      await tick()
      modalEl?.querySelector<HTMLElement>('.cal-day.selected, .cal-day.today')?.focus()
    } else {
      triggerEl?.focus()
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!showCalendar) return
    if (e.key === 'Escape') {
      e.preventDefault()
      toggleCalendar()
    }
  }

  // Arrow keys move through the grid (and across months).
  async function onGridKey(e: KeyboardEvent, d: Date) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (!step) return
    e.preventDefault()
    const next = new Date(d)
    next.setDate(next.getDate() + step)
    if (next.getMonth() !== calendarViewDate.getMonth()) calendarViewDate = new Date(next)
    await tick()
    modalEl?.querySelector<HTMLElement>(`[data-day="${formatDate(next)}"]`)?.focus()
  }

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'narrow' }),
  )
  const todayStr = formatDate(new Date())
  function changeMonth(offset: number) {
    const d = new Date(calendarViewDate)
    d.setMonth(d.getMonth() + offset)
    calendarViewDate = d
  }
  function selectDate(d: Date) {
    commit(d)
    showCalendar = false
    triggerEl?.focus()
  }

  let days = $derived.by(() => {
    const year = calendarViewDate.getFullYear()
    const month = calendarViewDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const start = new Date(firstDay)
    start.setDate(start.getDate() - firstDay.getDay())
    const out: Date[] = []
    const curr = new Date(start)
    for (let i = 0; i < 42; i++) {
      out.push(new Date(curr))
      curr.setDate(curr.getDate() + 1)
    }
    return out
  })

  let viewMonth = $derived(calendarViewDate.getMonth())
  let monthLabel = $derived(
    calendarViewDate.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    }),
  )
  let selectedStr = $derived(formatDate(currentDate))
</script>

<svelte:window onkeydown={onKey} />

<div class="date-control" class:compact={hideArrows}>
  {#if !hideArrows}
    <button class="cal-arrow" aria-label="Previous day" title="Previous day" onclick={goPrev}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg></button>
  {/if}
  <div class="date-container">
    <button
      class="date-display"
      bind:this={triggerEl}
      aria-haspopup="dialog"
      aria-expanded={showCalendar}
      onclick={toggleCalendar}
    >
      {hideArrows ? shortDisplay(currentDate) : prettyDisplay(currentDate)}
    </button>
    <div
      class="calendar-modal"
      class:open={showCalendar}
      bind:this={modalEl}
      role="dialog"
      aria-label="Choose date"
      inert={!showCalendar}
    >
      <div class="calendar-header">
        <button class="cal-arrow" aria-label="Previous month" onclick={() => changeMonth(-1)}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg></button>
        <div class="cal-month">{monthLabel}</div>
        <button class="cal-arrow" aria-label="Next month" onclick={() => changeMonth(1)}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg></button>
      </div>
      <div class="cal-weekdays" aria-hidden="true">
        {#each weekdays as w, i (i)}<span>{w}</span>{/each}
      </div>
      <div class="cal-days">
        {#each days as d (formatDate(d))}
          <button
            class="cal-day"
            data-day={formatDate(d)}
            class:other-month={d.getMonth() !== viewMonth}
            class:selected={formatDate(d) === selectedStr}
            class:today={formatDate(d) === todayStr}
            aria-current={formatDate(d) === todayStr ? 'date' : undefined}
            onclick={() => selectDate(new Date(d))}
            onkeydown={(e) => onGridKey(e, d)}
          >
            {d.getDate()}
          </button>
        {/each}
      </div>
      <button type="button" class="cal-today" onclick={goToday}>Today</button>
    </div>
  </div>
  {#if !hideArrows}
    <button class="cal-arrow" aria-label="Next day" title="Next day" onclick={goNext}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg></button>
  {/if}
</div>
{#if showCalendar}
  <button
    type="button"
    class="modal-overlay"
    onclick={toggleCalendar}
    aria-label="Close calendar"
    tabindex="-1"
  ></button>
{/if}

<style>
  .date-control {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .date-container {
    position: relative;
    min-width: 9rem;
  }
  .date-control.compact .date-container {
    min-width: auto;
  }
  .date-display {
    background: transparent;
    border: none;
    color: var(--accent);
    width: 100%;
    padding: 10px 18px;
    border-radius: 10px;
    cursor: pointer;
    font-weight: normal;
    font-family: inherit;
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .date-display:hover { background: var(--glass-dark); }
  .calendar-modal {
    position: absolute;
    top: 0;
    left: 50%;
    margin-top: 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    padding: 16px;
    min-width: 300px;
    z-index: calc(var(--z-overlay) + 1);
    box-shadow: var(--shadow-pop);
    visibility: hidden;
    transform-origin: top center;
    opacity: 0;
    transform: translateX(-50%) translateY(-4px) scale(0.98);
    pointer-events: none;
    transition:
      opacity var(--dur-base) var(--ease-out),
      transform var(--dur-base) var(--ease-spring),
      visibility 0s linear var(--dur-base);
  }
  .calendar-modal.open {
    visibility: visible;
    transition-delay: 0s;
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
    pointer-events: auto;
  }
  .calendar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .cal-month {
    font-size: 1rem;
    color: var(--accent);
    flex: 1;
    text-align: center;
  }
  .cal-arrow {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--accent);
    width: 32px;
    height: 32px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .cal-arrow svg { width: 15px; height: 15px; }
  .cal-arrow:hover { background: var(--glass-dark); }
  .cal-weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
    margin: 0.6rem 0 0.25rem;
    text-align: center;
    font-family: var(--font-ui);
    font-size: 0.6875rem;
    color: var(--muted);
    opacity: 0.6;
  }
  .cal-days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .cal-day {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--accent);
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .cal-day:hover {
    background-color: var(--glass);
  }
  .cal-day.today { box-shadow: inset 0 0 0 1px var(--accent); }
  .cal-day.other-month {
    color: var(--muted);
    opacity: 0.4;
  }
  .cal-day.selected {
    background: var(--accent);
    color: var(--on-accent);
    border: 0;
    font-weight: bold;
  }
  .cal-today {
    appearance: none;
    border: 0;
    background: transparent;
    font-size: 1rem;
    color: var(--accent);
    width: 100%;
    text-align: center;
    cursor: pointer;
    margin: 0.5rem 0 0;
    padding: 8px;
    font-family: var(--font-ui);
    font-size: 0.8125rem;
    border-radius: 6px;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .cal-today:hover {
    background-color: var(--glass);
  }
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: var(--scrim);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: var(--z-overlay);
    animation: overlayIn var(--dur-base) var(--ease-out);
    border: 0;
  }
  @keyframes overlayIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (max-width: 600px) {
    .calendar-modal {
      position: fixed;
      top: 50%;
      left: 50%;
      margin-top: 0;
      transform: translate(-50%, -50%) scale(0.98);
    }
    .calendar-modal.open {
      transform: translate(-50%, -50%) scale(1);
    }
  }
</style>
