<script lang="ts">
  import { untrack } from 'svelte'
  import { appStore } from '../../stores/app'
  import { formatDate, prettyDisplay } from '../../utils/date'

  interface Props {
    value?: Date
    onSelect?: (d: Date) => void
  }
  let { value, onSelect }: Props = $props()

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
  function toggleCalendar() {
    showCalendar = !showCalendar
    if (showCalendar) calendarViewDate = new Date(currentDate)
  }
  function changeMonth(offset: number) {
    const d = new Date(calendarViewDate)
    d.setMonth(d.getMonth() + offset)
    calendarViewDate = d
  }
  function selectDate(d: Date) {
    commit(d)
    showCalendar = false
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

<div class="date-control">
  <button class="cal-arrow" aria-label="Previous day" onclick={goPrev}>◀</button>
  <div class="date-container">
    <button class="date-display" onclick={toggleCalendar}>
      {prettyDisplay(currentDate)}
    </button>
    <div class="calendar-modal" class:open={showCalendar}>
      <div class="calendar-header">
        <button class="cal-arrow" onclick={() => changeMonth(-1)}>◀</button>
        <div class="cal-month">{monthLabel}</div>
        <button class="cal-arrow" onclick={() => changeMonth(1)}>▶</button>
      </div>
      <button type="button" class="cal-today" onclick={goToday}>Today</button>
      <div class="cal-days">
        {#each days as d}
          <button
            class="cal-day"
            class:other-month={d.getMonth() !== viewMonth}
            class:selected={formatDate(d) === selectedStr}
            onclick={() => selectDate(new Date(d))}
          >
            {d.getDate()}
          </button>
        {/each}
      </div>
    </div>
  </div>
  <button class="cal-arrow" aria-label="Next day" onclick={goNext}>▶</button>
</div>
{#if showCalendar}
  <button
    type="button"
    class="modal-overlay"
    onclick={toggleCalendar}
    aria-label="Close calendar"
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
  }
  .calendar-modal {
    position: absolute;
    top: 0;
    left: 50%;
    margin-top: 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 20px;
    min-width: 300px;
    box-shadow: 0 8px 40px rgba(2, 6, 8, 0.8);
    z-index: 1000;
    transform-origin: top center;
    opacity: 0;
    transform: translateX(-50%) translateY(-4px) scale(0.98);
    pointer-events: none;
    transition:
      opacity var(--dur-base) var(--ease-out),
      transform var(--dur-base) var(--ease-spring);
  }
  .calendar-modal.open {
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
    font-size: 1.25rem;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
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
  .cal-day.other-month {
    color: var(--muted);
    opacity: 0.4;
  }
  .cal-day.selected {
    background: linear-gradient(180deg, var(--accent), #fff076);
    color: #000;
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
    margin: 0.5rem 0;
    padding: 8px;
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
    background: rgba(0, 0, 0, 0.18);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 999;
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
</style>
