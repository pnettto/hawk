import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import DayTasks from './DayTasks.svelte'

const mocks = vi.hoisted(() => ({ flush: vi.fn().mockResolvedValue(undefined), edit: vi.fn() }))
vi.mock('../../stores/app', async () => {
  const { writable } = await import('svelte/store')
  return { appStore: writable({ selectedDate: new Date(2026, 5, 10) }) }
})
vi.mock('../../stores/logs', async () => {
  const { writable } = await import('svelte/store')
  return {
    logsStore: {
      ...writable({ byDate: { '2026-06-10': { tasks: [{ id: 'one', text: 'Keep this task', done: false, order: 0 }] } } }),
      flushTasks: mocks.flush,
      editTask: mocks.edit,
    },
    sortTasks: <T,>(tasks: T[]) => tasks,
  }
})
vi.mock('../../api/logs', () => ({ listDayVersions: vi.fn().mockResolvedValue([]) }))
vi.mock('../../stores/pomodoro', async () => {
  const { writable } = await import('svelte/store')
  return { pomodoroStore: writable({ mode: 'focus', taskId: null }), EXTENSION_ID: 'pomodoro', formatClock: vi.fn() }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Tasks toolbar', () => {
  it('enters full screen without remounting tasks and restores focus on Escape', async () => {
    render(DayTasks)
    const task = screen.getByRole('textbox', { name: 'Task' })
    const fullScreen = screen.getByRole('button', { name: 'Full screen' })
    await fireEvent.click(fullScreen)
    const overlay = screen.getByRole('dialog', { name: 'Tasks' })
    expect(overlay).toHaveClass('full-screen')
    expect(overlay).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Task' })).toBe(task)
    expect(task).toHaveValue('Keep this task')
    await fireEvent.keyDown(overlay, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Tasks' })).not.toBeInTheDocument()
    expect(fullScreen).toHaveFocus()
  })

  it('also exits with the full-screen button', async () => {
    render(DayTasks)
    await fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }))
    expect(screen.queryByRole('dialog', { name: 'Tasks' })).not.toBeInTheDocument()
  })

  it('keeps history behind the toolbar menu with correctly sized artwork', async () => {
    render(DayTasks)
    expect(screen.queryByRole('button', { name: 'Version history' })).not.toBeInTheDocument()
    const more = screen.getAllByRole('button', { name: 'More actions' })[0]
    await fireEvent.click(more)
    const history = screen.getByRole('menuitem', { name: 'Version history' })
    expect(history.querySelector('svg')).toHaveAttribute('viewBox', '0 0 16 16')
    expect(history.querySelector('path')).toHaveAttribute('d', 'M2 8a6 6 0 1 0 2-4.47L2 5.33')
    await fireEvent.click(history)
    await waitFor(() => expect(mocks.flush).toHaveBeenCalledWith('2026-06-10', { snapshot: true }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(await screen.findByRole('dialog', { name: 'Version history' })).toBeInTheDocument()
  })

  it('Escape closes history before leaving full screen', async () => {
    render(DayTasks)
    await fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    await fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0])
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Version history' }))
    await screen.findByRole('dialog', { name: 'Version history' })
    const overlay = screen.getByRole('dialog', { name: 'Tasks' })
    await fireEvent.keyDown(overlay, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Version history' })).not.toBeInTheDocument()
    expect(overlay).toBeInTheDocument()
  })

  it('Escape closes a menu before leaving full screen', async () => {
    render(DayTasks)
    await fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    await fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0])
    await fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Version history' }), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Tasks' })).toBeInTheDocument()
  })
})
