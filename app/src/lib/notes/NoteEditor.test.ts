import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import NoteEditor from './NoteEditor.svelte'

const mocks = vi.hoisted(() => ({ state: null as unknown as import('svelte/store').Writable<unknown> }))

vi.mock('../../stores/notes', async () => {
  const { writable } = await import('svelte/store')
  const note = (id: string) => ({ id, title: id, tags: [], createdAt: 0, updatedAt: 0 })
  const state = writable({ loaded: true, selectedNid: 'n1', allNotes: [note('n1'), note('n2')] })
  mocks.state = state
  return {
    notesStore: {
      ...state,
      loadBody: vi.fn(),
      triggerSnapshot: vi.fn(),
      sessionFor: () => null,
      setTitle: vi.fn(),
      setPublic: vi.fn(),
      setFilter: vi.fn(),
    },
    tagCounts: () => [],
    dayLabel: () => '',
  }
})
vi.mock('../../stores/app', async () => {
  const { writable } = await import('svelte/store')
  return {
    appStore: writable({ focusNoteBodyId: null }),
  }
})
vi.mock('../../stores/auth', async () => {
  const { writable } = await import('svelte/store')
  return { authStore: writable({ isAuth: true, isGuest: false }) }
})
vi.mock('../../api/auth', () => ({ verifyPassword: vi.fn() }))
vi.mock('../../router/sync', () => ({ closeNote: vi.fn(), linkTo: () => '' }))
vi.mock('../../stores/toast', () => ({ showError: vi.fn(), showToast: vi.fn() }))
vi.mock('../editor/RichEditor.svelte', () => ({ default: () => {} }))

afterEach(cleanup)

describe('share popover', () => {
  it('stays open when the note updates, and closes when another note is selected', async () => {
    const { rerender } = render(NoteEditor, { nid: 'n1', onDelete: () => {} })

    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Share/ }))
    expect(screen.getByText('Enable Public Link')).toBeInTheDocument()

    // Enabling sharing patches the note, which re-renders the parent with fresh
    // callbacks. That must not be mistaken for selecting a different note.
    await rerender({ nid: 'n1', onDelete: () => {} })
    expect(screen.getByText('Enable Public Link')).toBeInTheDocument()

    await rerender({ nid: 'n2', onDelete: () => {} })
    expect(screen.queryByText('Enable Public Link')).not.toBeInTheDocument()
  })
})
