import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte'
import DayTasks from './DayTasks.svelte'

const mocks = vi.hoisted(() => ({
  flush: vi.fn().mockResolvedValue(undefined),
  edit: vi.fn(),
  move: vi.fn().mockResolvedValue(true),
  removeTasks: vi.fn(),
}))
vi.mock('../../stores/app', async () => {
  const { writable } = await import('svelte/store')
  return { appStore: writable({ selectedDate: new Date(2026, 5, 10) }) }
})
vi.mock('../../stores/logs', async () => {
  const { writable } = await import('svelte/store')
  const tasks = [
    { id: 'a', text: 'Write report', done: false, order: 1 },
    { id: 'b', text: 'Buy milk', done: true, order: 2 },
    { id: 'g', text: 'Trip', done: false, order: 3 },
    { id: 'g1', text: 'Pack', done: false, order: 1, parentId: 'g' },
    { id: 'c', text: 'Call Ana', done: false, order: 4 },
  ]
  return {
    logsStore: {
      ...writable({ byDate: { '2026-06-10': { tasks } } }),
      flushTasks: mocks.flush,
      editTask: mocks.edit,
      moveTasks: mocks.move,
      removeTasks: mocks.removeTasks,
    },
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

const row = (name: string) => screen.getByRole('checkbox', { name: `Select “${name}”` })

async function enterSelect() {
  render(DayTasks)
  await fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0])
  await fireEvent.click(screen.getByRole('menuitem', { name: 'Select tasks' }))
  expect(screen.getByRole('toolbar', { name: 'Selected tasks' })).toBeInTheDocument()
}

const inSelectMode = () => !!screen.queryByRole('toolbar', { name: 'Selected tasks' })

describe('Select mode', () => {
  it('turns rows into selection targets instead of completing them', async () => {
    await enterSelect()
    expect(screen.queryByRole('textbox', { name: 'Task' })).not.toBeInTheDocument()
    await fireEvent.click(row('Write report'))
    expect(row('Write report')).toHaveAttribute('aria-checked', 'true')
    expect(mocks.edit).not.toHaveBeenCalled()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('shows subtasks of a selected group as included and not selectable', async () => {
    await enterSelect()
    await fireEvent.click(row('Trip'))
    const sub = screen.getByRole('checkbox', { name: '“Pack” moves with its group' })
    expect(sub).toHaveAttribute('aria-checked', 'true')
    expect(sub).toHaveAttribute('aria-disabled', 'true')
  })

  it('selects a range with Shift+click', async () => {
    await enterSelect()
    await fireEvent.click(row('Write report'))
    await fireEvent.click(row('Trip'), { shiftKey: true })
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    expect(row('Call Ana')).toHaveAttribute('aria-checked', 'false')
  })

  it('selects every top-level row with ⌘A and toggles with Space', async () => {
    await enterSelect()
    await fireEvent.keyDown(row('Write report'), { key: 'a', metaKey: true })
    expect(screen.getByText('4 selected')).toBeInTheDocument()
    await fireEvent.keyDown(row('Call Ana'), { key: ' ' })
    expect(screen.getByText('3 selected')).toBeInTheDocument()
  })

  it('selects only unfinished tasks', async () => {
    await enterSelect()
    await fireEvent.click(screen.getByRole('button', { name: 'Select unfinished' }))
    expect(row('Write report')).toHaveAttribute('aria-checked', 'true')
    expect(row('Buy milk')).toHaveAttribute('aria-checked', 'false')
    expect(row('Trip')).toHaveAttribute('aria-checked', 'true')
  })

  it('moves the selection to a picked day and leaves select mode', async () => {
    await enterSelect()
    await fireEvent.click(row('Write report'))
    await fireEvent.click(row('Trip'))
    await fireEvent.click(screen.getByRole('button', { name: 'Move to…' }))
    const dialog = screen.getByRole('dialog', { name: 'Move to' })
    // The source day is shown but can't be picked.
    expect(within(dialog).getByRole('button', { name: /June 10/ })).toHaveAttribute('aria-disabled', 'true')
    await fireEvent.click(within(dialog).getByRole('button', { name: /June 12/ }))
    expect(mocks.move).toHaveBeenCalledWith('2026-06-10', '2026-06-12', ['a', 'g'])
    await vi.waitFor(() => expect(inSelectMode()).toBe(false))
  })

  it('deletes the selection in one go', async () => {
    await enterSelect()
    await fireEvent.click(row('Write report'))
    await fireEvent.click(row('Call Ana'))
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mocks.removeTasks).toHaveBeenCalledWith('2026-06-10', ['a', 'c'])
  })

  it('leaves with Escape', async () => {
    await enterSelect()
    await fireEvent.click(row('Write report'))
    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(inSelectMode()).toBe(false)
    expect(screen.getAllByRole('textbox', { name: 'Task' }).length).toBeGreaterThan(0)
  })
})

describe('Select mode entry and exit', () => {
  it('lives in the toolbar menu and leaves with Done', async () => {
    await enterSelect()
    await fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0])
    expect(screen.queryByRole('menuitem', { name: 'Select tasks' })).not.toBeInTheDocument()
    await fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Copy link' }), { key: 'Escape' })
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(inSelectMode()).toBe(false)
    expect(screen.getAllByRole('textbox', { name: 'Task' }).length).toBeGreaterThan(0)
  })
})

describe('Row menu', () => {
  it('offers Move to… instead of carrying over to tomorrow', async () => {
    render(DayTasks)
    await fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[1])
    expect(screen.queryByRole('menuitem', { name: 'Carry over to tomorrow' })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }))
    expect(screen.getByRole('dialog', { name: 'Move to' })).toBeInTheDocument()
  })
})
