import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import ActionMenu from './ActionMenu.svelte'
import MoreButton from './MoreButton.svelte'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

function setup() {
  const anchor = document.createElement('button')
  anchor.textContent = 'More actions'
  document.body.append(anchor)
  const onClose = vi.fn()
  const onSelect = vi.fn()
  const items = [
    { label: 'Copy', onSelect },
    { label: 'History', onSelect: vi.fn() },
    { label: 'Delete', danger: true, onSelect: vi.fn() },
  ]
  const result = render(ActionMenu, { props: { anchor, items, onClose, label: 'Note actions' } })
  return { ...result, anchor, onClose, onSelect }
}

describe('ActionMenu', () => {
  it('portals the menu and separates destructive actions', () => {
    const { container } = setup()
    expect(screen.getByRole('menu', { name: 'Note actions' }).parentElement).toBe(document.body)
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(screen.getAllByRole('separator')).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveClass('danger')
  })

  it('focuses the first item and supports arrows, wrapping, Home, and End', async () => {
    setup()
    const copy = screen.getByRole('menuitem', { name: 'Copy' })
    const history = screen.getByRole('menuitem', { name: 'History' })
    const del = screen.getByRole('menuitem', { name: 'Delete' })
    expect(copy).toHaveFocus()
    await fireEvent.keyDown(copy, { key: 'ArrowDown' })
    expect(history).toHaveFocus()
    await fireEvent.keyDown(history, { key: 'End' })
    expect(del).toHaveFocus()
    await fireEvent.keyDown(del, { key: 'ArrowDown' })
    expect(copy).toHaveFocus()
    await fireEvent.keyDown(copy, { key: 'ArrowUp' })
    expect(del).toHaveFocus()
    await fireEvent.keyDown(del, { key: 'Home' })
    expect(copy).toHaveFocus()
  })

  it.each(['Escape', 'Tab'])('closes on %s and restores the trigger focus', async (key) => {
    const { anchor, onClose } = setup()
    await fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Copy' }), { key })
    expect(onClose).toHaveBeenCalledOnce()
    expect(anchor).toHaveFocus()
  })

  it('restores focus before running an action, allowing it to focus its destination', async () => {
    const { anchor, onClose, onSelect } = setup()
    const destination = document.createElement('input')
    document.body.append(destination)
    onSelect.mockImplementation(() => {
      expect(anchor).toHaveFocus()
      destination.focus()
    })
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }))
    expect(onClose).toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledOnce()
    expect(destination).toHaveFocus()
  })

  it('dismisses outside without stealing focus and ignores the trigger pointerdown', async () => {
    const { anchor, onClose } = setup()
    await fireEvent.pointerDown(anchor)
    expect(onClose).not.toHaveBeenCalled()
    const outside = document.createElement('button')
    document.body.append(outside)
    await fireEvent.pointerDown(outside)
    expect(onClose).toHaveBeenCalledOnce()
    expect(anchor).not.toHaveFocus()
  })

  it('removes its portalled panel on unmount', () => {
    const { unmount } = setup()
    unmount()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('MoreButton', () => {
  it('defaults to a lightweight row button and supports bordered toolbars', async () => {
    const { rerender } = render(MoreButton, { expanded: false, onclick: vi.fn() })
    const trigger = screen.getByRole('button', { name: 'More actions' })
    expect(trigger).toHaveClass('ghost')
    await rerender({ ghost: false })
    expect(trigger).toHaveClass('icon-btn')
    expect(trigger).not.toHaveClass('ghost')
  })

  it('exposes an accessible, controlled menu trigger', async () => {
    const onclick = vi.fn()
    const { rerender } = render(MoreButton, { expanded: false, onclick, label: 'More actions for report.pdf' })
    const trigger = screen.getByRole('button', { name: 'More actions for report.pdf' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await fireEvent.click(trigger)
    expect(onclick).toHaveBeenCalledOnce()
    await rerender({ expanded: true })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})
