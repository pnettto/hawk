<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { appStore } from '../../stores/app'
  import { formatDate, prettyDisplay, shortDisplay } from '../../utils/date'
  import CalendarGrid from '../ui/CalendarGrid.svelte'

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

  const todayStr = formatDate(new Date())
  function selectDate(d: Date) {
    commit(d)
    showCalendar = false
    triggerEl?.focus()
  }

  let selectedStr = $derived(formatDate(currentDate))
  let isToday = $derived(selectedStr === todayStr)
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
      <CalendarGrid bind:viewDate={calendarViewDate} selected={selectedStr} onSelect={selectDate} />
      <button type="button" class="cal-today" onclick={goToday}>Today</button>
    </div>
  </div>
  {#if !hideArrows}
    <button class="cal-arrow" aria-label="Next day" title="Next day" onclick={goNext}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg></button>
  {/if}
  {#if !hideArrows && !isToday}
    <button type="button" class="today-btn" onclick={goToday}>Today</button>
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
    border-radius: var(--r-sm);
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
    border-radius: var(--r-sm);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .cal-today:hover {
    background-color: var(--glass);
  }
  .today-btn {
    appearance: none;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    height: var(--h-sm);
    padding: 0 0.8rem;
    border-radius: var(--r-sm);
    cursor: pointer;
    font-family: var(--font-ui, inherit);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    transition:
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  .today-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--glass-dark);
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
    .date-control { gap: 2px; }
    .date-container { min-width: auto; }
    .date-display { padding: 6px 8px; font-size: 0.9rem; }
    .cal-arrow { width: 28px; height: 28px; }
    .today-btn { height: 26px; padding: 0 0.45rem; font-size: 0.68rem; }
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
