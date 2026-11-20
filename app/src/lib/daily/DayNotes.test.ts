import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import DayNotes from './DayNotes.svelte'

const mocks = vi.hoisted(() => ({ reorder: vi.fn(), title: vi.fn() }))
vi.mock('svelte/transition', () => ({ fade: () => ({ duration: 0 }) }))
vi.mock('../notes/NoteEditor.svelte', () => ({ default: () => {} }))
vi.mock('../../stores/app', async () => {
  const { writable } = await import('svelte/store')
  return { appStore: writable({ selectedDate: new Date(2026, 5, 10) }) }
})
vi.mock('../../stores/notes', async () => {
  const { writable } = await import('svelte/store')
  return {
    notesStore: {
      ...writable({ loaded: true, allNotes: [
        { id: 'a', title: 'First', day: '2026-06-10', dayOrder: 0 },
        { id: 'b', title: 'A wider second note', day: '2026-06-10', dayOrder: 1 },
        { id: 'c', title: 'Third', day: '2026-06-10', dayOrder: 2 },
      ] }),
      ensureDayDraft: vi.fn(), reorderDayNotes: mocks.reorder, setTitle: mocks.title,
    },
    sortDayNotes: (notes: unknown[]) => notes,
  }
})

function setup() {
  render(DayNotes)
  const tabs = screen.getAllByRole('tab')
  const widths = [80, 160, 90]
  let left = 0
  tabs.forEach((tab, i) => {
    const x = left
    tab.getBoundingClientRect = () => ({ left: x, width: widths[i] }) as DOMRect
    tab.setPointerCapture = vi.fn()
    left += widths[i] + 4
  })
  return tabs
}
async function pointer(el: HTMLElement, type: string, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  await fireEvent(el, event)
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('day note tab ordering', () => {
  it('reorders with Alt+arrow without changing the selected note', async () => {
    const tabs = setup()
    await fireEvent.keyDown(tabs[0], { key: 'ArrowRight', altKey: true })
    expect(mocks.reorder).toHaveBeenCalledWith('2026-06-10', ['b', 'a', 'c'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    await fireEvent.keyDown(tabs[0], { key: 'ArrowLeft', altKey: true })
    expect(mocks.reorder).toHaveBeenCalledTimes(1)
  })

  it('keeps plain arrow navigation and double-click rename', async () => {
    const tabs = setup()
    await fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(mocks.reorder).not.toHaveBeenCalled()
    await fireEvent.doubleClick(tabs[1])
    expect(screen.getByRole('textbox', { name: 'Note name' })).toHaveValue('A wider second note')
  })

  it('previews variable-width tabs and saves only on release', async () => {
    const tabs = setup()
    await pointer(tabs[0], 'pointerdown', 40)
    await pointer(tabs[0], 'pointermove', 280)
    expect(tabs[0].style.transform).toBe('translateX(240px)')
    expect(tabs[1].style.transform).toBe('translateX(-84px)')
    expect(mocks.reorder).not.toHaveBeenCalled()
    await pointer(tabs[0], 'pointerup', 280)
    expect(mocks.reorder).toHaveBeenCalledWith('2026-06-10', ['b', 'a', 'c'])
  })

  it.each(['pointercancel', 'lostpointercapture', 'Escape'])('cancels on %s', async (cancel) => {
    const tabs = setup()
    await pointer(tabs[0], 'pointerdown', 40)
    await pointer(tabs[0], 'pointermove', 280)
    if (cancel === 'Escape') await fireEvent.keyDown(window, { key: 'Escape' })
    else await pointer(tabs[0], cancel, 280)
    await pointer(tabs[0], 'pointerup', 280)
    expect(mocks.reorder).not.toHaveBeenCalled()
    expect(tabs[0].style.transform).toBe('translateX(0px)')
  })
})
