import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { get } from 'svelte/store'

const navigate = vi.fn()
vi.mock('../../router/sync', () => ({ navigate: (...a: unknown[]) => navigate(...a) }))

const searchApi = vi.fn()
vi.mock('../../api/search', () => ({ search: (...a: unknown[]) => searchApi(...a) }))

Element.prototype.scrollIntoView ??= () => {}

// jsdom has no Web Animations; finish transitions right away.
Element.prototype.animate ??= function () {
  const a = {
    onfinish: null as null | (() => void),
    cancel() {},
    finish() {},
    play() {},
    pause() {},
    currentTime: 0,
    finished: Promise.resolve(),
  }
  setTimeout(() => a.onfinish?.())
  return a as unknown as Animation
}

import SearchDialog from './SearchDialog.svelte'
import { searchStore } from '../../stores/search'
import { appStore } from '../../stores/app'
import { logsStore } from '../../stores/logs'
import { notesStore } from '../../stores/notes'
import { toastStore } from '../../stores/toast'
import { formatDate } from '../../utils/date'

const results = {
  notes: [
    { id: 'n1', title: 'Garden plan', tags: ['home'], updatedAt: 2, titleMatches: [[0, 6]], snippetMatches: [], field: 'title' },
    { id: 'day-2026-05-14', title: '', day: '2026-05-14', tags: [], updatedAt: 1, snippet: 'garden notes', snippetMatches: [[0, 6]], titleMatches: [], field: 'body' },
  ],
  tasks: [
    { date: '2026-05-14', id: 't1', text: 'Water the garden', done: false, textMatches: [[10, 16]], commentMatches: [] },
  ],
  truncated: false,
}

async function openWith(query: string) {
  render(SearchDialog)
  searchStore.open()
  const input = (await screen.findByRole('combobox')) as HTMLInputElement
  await fireEvent.input(input, { target: { value: query } })
  await screen.findByText('Water the', { exact: false })
  return input
}

describe('SearchDialog', () => {
  beforeEach(() => {
    navigate.mockReset()
    searchApi.mockReset().mockResolvedValue(results)
    searchStore.close()
    localStorage.clear()
  })

  it('shows grouped results with marks', async () => {
    await openWith('garden')
    const groups = [...document.querySelectorAll('.group-label')].map((el) => el.textContent)
    expect(groups).toEqual(['Notes', 'Tasks'])
    expect(screen.getByText('Untitled')).toBeTruthy()
    expect(screen.getByText('Day note', { exact: false })).toBeTruthy()
    expect(document.querySelectorAll('mark').length).toBe(3)
  })

  it('moves with the arrows and opens a note on Enter', async () => {
    const input = await openWith('garden')
    expect(input.getAttribute('aria-activedescendant')).toBe('search-opt-0')
    await fireEvent.keyDown(input, { key: 'ArrowUp' })
    // Wraps to the last create row.
    expect(input.getAttribute('aria-activedescendant')).toBe('search-opt-4')
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledWith({ page: 'notes', nid: 'n1' })
    expect(get(searchStore).open).toBe(false)
    expect(JSON.parse(localStorage.getItem('hawk_recent_searches')!)).toEqual(['garden'])
  })

  it('opens a day note in the Journal on its tab', async () => {
    const input = await openWith('garden')
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledWith({ page: 'journal', date: '2026-05-14', tab: 'notes' })
    expect(get(appStore).focusDayNoteId).toBe('day-2026-05-14')
    appStore.setFocusDayNote(null)
  })

  it('opens a task highlighted', async () => {
    const input = await openWith('garden')
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigate).toHaveBeenLastCalledWith({ page: 'journal', date: '2026-05-14', tab: 'tasks', task: 't1' })
  })

  it('closes on Escape', async () => {
    const input = await openWith('garden')
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(get(searchStore).open).toBe(false)
  })

  it('says when nothing matches and when search fails', async () => {
    searchApi.mockResolvedValue({ notes: [], tasks: [], truncated: false })
    render(SearchDialog)
    searchStore.open()
    const input = await screen.findByRole('combobox')
    await fireEvent.input(input, { target: { value: 'zzz' } })
    expect(await screen.findByText('Nothing matches “zzz”')).toBeTruthy()
    searchApi.mockRejectedValue(new Error('boom'))
    await fireEvent.input(input, { target: { value: 'zzzz' } })
    expect(await screen.findByText('Couldn’t search right now.')).toBeTruthy()
  })

  describe('quick create', () => {
    const today = formatDate(new Date())
    let addTask: ReturnType<typeof vi.spyOn>
    let createNote: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      appStore.setCurrentPage('notes')
      vi.spyOn(logsStore, 'loadForDate').mockResolvedValue({ tasks: [] })
      addTask = vi.spyOn(logsStore, 'addTask').mockImplementation((date, t) => ({ id: 'new', done: false, order: 1, ...t }))
      createNote = vi.spyOn(notesStore, 'createNote').mockReturnValue('nid-1')
    })
    afterEach(() => {
      vi.restoreAllMocks()
      appStore.setCurrentPage('app')
    })

    async function typeWithNoResults(query: string) {
      searchApi.mockResolvedValue({ notes: [], tasks: [], truncated: false })
      render(SearchDialog)
      searchStore.open()
      const input = (await screen.findByRole('combobox')) as HTMLInputElement
      await fireEvent.input(input, { target: { value: query } })
      await screen.findByText(`Nothing matches “${query}”`)
      return input
    }

    it('adds a task on Enter when nothing matches', async () => {
      const input = await typeWithNoResults('Call dentist 14:30')
      expect(screen.getByText('Add task “Call dentist”')).toBeTruthy()
      expect(screen.getByText('Today, 14:30')).toBeTruthy()
      expect(input.getAttribute('aria-activedescendant')).toBe('search-opt-0')
      await fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(addTask).toHaveBeenCalledWith(today, { text: 'Call dentist', time: '14:30' }))
      expect(get(searchStore).open).toBe(false)
      const toast = get(toastStore).at(-1)!
      expect(toast.message).toBe('Task added to Today')
      toast.onAction?.()
      expect(navigate).toHaveBeenLastCalledWith({ page: 'journal', date: today, tab: 'tasks', task: 'new' })
      expect(localStorage.getItem('hawk_recent_searches')).toBeNull()
    })

    it('creates from any row with ⌘Enter and ⌘⇧Enter', async () => {
      let input = await openWith('garden')
      await fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
      await waitFor(() => expect(addTask).toHaveBeenCalledWith(today, { text: 'garden' }))
      expect(navigate).not.toHaveBeenCalled()

      searchStore.setQuery('Trip ideas #travel')
      searchStore.open()
      input = (await screen.findByRole('combobox')) as HTMLInputElement
      await fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, shiftKey: true })
      expect(createNote).toHaveBeenCalledWith({ title: 'Trip ideas', tags: ['travel'] })
      expect(navigate).toHaveBeenLastCalledWith({ page: 'notes', nid: 'nid-1' })
      expect(get(appStore).focusNoteBodyId).toBe('nid-1')
      expect(get(searchStore).open).toBe(false)
      appStore.setFocusNoteBody(null)
    })

    it('uses the Journal date and offers a day note there', async () => {
      appStore.setCurrentPage('app')
      appStore.setSelectedDate(new Date(2030, 0, 4, 12))
      appStore.setJournalTab('notes', { remember: false })
      const input = await typeWithNoResults('Ideas')
      expect(screen.getByText('New day note “Ideas”')).toBeTruthy()
      await fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(addTask).toHaveBeenCalledWith('2030-01-04', { text: 'Ideas' }))
      appStore.setJournalTab('tasks', { remember: false })
      appStore.setSelectedDate(new Date())
    })

    it('hides the row that doesn’t fit the view', async () => {
      await typeWithNoResults('Call dentist')
      searchStore.setKind('notes')
      await waitFor(() => expect(screen.queryByText('Add task “Call dentist”')).toBeNull())
      expect(screen.getByText('New note “Call dentist”')).toBeTruthy()
      searchStore.setKind('tasks')
      await waitFor(() => expect(screen.queryByText('New note “Call dentist”')).toBeNull())
      expect(screen.getByText('Add task “Call dentist”')).toBeTruthy()
      searchStore.setKind('all')
    })
  })
})
