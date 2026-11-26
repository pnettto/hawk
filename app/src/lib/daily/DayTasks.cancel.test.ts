import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte'
import DayTasks from './DayTasks.svelte'

const mocks = vi.hoisted(() => ({ flush: vi.fn().mockResolvedValue(undefined), edit: vi.fn() }))
vi.mock('../../stores/app', async () => {
  const { writable } = await import('svelte/store')
  return { appStore: writable({ selectedDate: new Date(2026, 5, 10) }) }
})
vi.mock('../../stores/logs', async () => {
  const { writable } = await import('svelte/store')
  const tasks = [
    { id: 'a', text: 'Write report', done: false, order: 1 },
    { id: 'b', text: 'Buy milk', done: false, order: 2, cancelled: true },
    { id: 'g', text: 'Trip', done: false, order: 3, cancelled: true },
    { id: 'g1', text: 'Pack', done: false, order: 1, parentId: 'g', cancelled: true },
  ]
  return {
    logsStore: { ...writable({ byDate: { '2026-06-10': { tasks } } }), flushTasks: mocks.flush, editTask: mocks.edit },
    sortTasks: <T,>(tasks: T[]) => tasks,
  }
})
vi.mock('../../api/logs', () => ({ listDayVersions: vi.fn().mockResolvedValue([]) }))
vi.mock('../../stores/pomodoro', async () => {
  const { writable } = await import('svelte/store')
  return {
    pomodoroStore: { ...writable({ mode: 'focus', taskId: null }), stop: vi.fn() },
    EXTENSION_ID: 'pomodoro',
    formatClock: vi.fn(),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('Cancelled tasks', () => {
  it('keeps them out of the list, in their own section at the bottom', () => {
    render(DayTasks)
    const cancelled = screen.getByRole('region', { name: 'Cancelled tasks' })
    expect(within(cancelled).getByText('Buy milk')).toBeInTheDocument()
    expect(within(cancelled).getByText('Trip')).toBeInTheDocument()
    expect(within(cancelled).getByText('Pack')).toBeInTheDocument()
    // Subtasks keep their indent under a cancelled parent.
    expect(within(cancelled).getByRole('button', { name: 'Restore “Pack”' }).closest('li')).toHaveClass('sub')
  })

  it('cancels a task from its row menu', async () => {
    render(DayTasks)
    const row = screen.getByRole('textbox', { name: 'Task' }).closest('li') as HTMLElement
    await fireEvent.click(within(row).getByRole('button', { name: 'More actions' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel task' }))
    expect(mocks.edit).toHaveBeenCalledWith('2026-06-10', 'a', { cancelled: true }, { immediate: true })
  })

  it('restores a cancelled task', async () => {
    render(DayTasks)
    await fireEvent.click(screen.getByRole('button', { name: 'Restore “Buy milk”' }))
    expect(mocks.edit).toHaveBeenCalledWith('2026-06-10', 'b', { cancelled: undefined }, { immediate: true })
  })
})
