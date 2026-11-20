<script lang="ts">
  import { tick } from 'svelte'
  import { formatDate } from '../../utils/date'

  interface Props {
    // Month on show; bindable so the owner can jump to a date.
    viewDate: Date
    // "YYYY-MM-DD" of the highlighted day.
    selected?: string
    // Days shown but not pickable (e.g. the day tasks are moving from).
    isDisabled?: (dateStr: string) => boolean
    onSelect: (d: Date) => void
  }
  let { viewDate = $bindable(), selected, isDisabled, onSelect }: Props = $props()

  let gridEl = $state<HTMLDivElement | null>(null)

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'narrow' }),
  )
  const todayStr = formatDate(new Date())

  function changeMonth(offset: number) {
    const d = new Date(viewDate)
    d.setDate(1)
    d.setMonth(d.getMonth() + offset)
    viewDate = d
  }

  // Arrow keys move through the grid (and across months).
  async function onGridKey(e: KeyboardEvent, d: Date) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (!step) return
    e.preventDefault()
    const next = new Date(d)
    next.setDate(next.getDate() + step)
    if (next.getMonth() !== viewDate.getMonth()) viewDate = new Date(next)
    await tick()
    gridEl?.querySelector<HTMLElement>(`[data-day="${formatDate(next)}"]`)?.focus()
  }

  let days = $derived.by(() => {
    const year = viewDate.getFullYear()
    const month = viewDate.getMonth()
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

  let viewMonth = $derived(viewDate.getMonth())
  let monthLabel = $derived(viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))
</script>

<div class="calendar-grid" bind:this={gridEl}>
  <div class="calendar-header">
    <button type="button" class="cal-arrow" aria-label="Previous month" onclick={() => changeMonth(-1)}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg></button>
    <div class="cal-month">{monthLabel}</div>
    <button type="button" class="cal-arrow" aria-label="Next month" onclick={() => changeMonth(1)}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg></button>
  </div>
  <div class="cal-weekdays" aria-hidden="true">
    {#each weekdays as w, i (i)}<span>{w}</span>{/each}
  </div>
  <div class="cal-days">
    {#each days as d (formatDate(d))}
      {@const ds = formatDate(d)}
      {@const disabled = !!isDisabled?.(ds)}
      <button
        type="button"
        class="cal-day"
        data-day={ds}
        class:other-month={d.getMonth() !== viewMonth}
        class:selected={ds === selected}
        class:today={ds === todayStr}
        aria-current={ds === todayStr ? 'date' : undefined}
        aria-label={d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        aria-disabled={disabled || undefined}
        onclick={() => {
          if (!disabled) onSelect(new Date(d))
        }}
        onkeydown={(e) => onGridKey(e, d)}
      >
        {d.getDate()}
      </button>
    {/each}
  </div>
</div>

<style>
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
    border-radius: var(--r-sm);
    cursor: pointer;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .cal-day:hover { background-color: var(--glass); }
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
  .cal-day[aria-disabled='true'] {
    cursor: default;
    opacity: 0.3;
    text-decoration: line-through;
  }
  .cal-day[aria-disabled='true']:hover { background: transparent; }
  .cal-day:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
