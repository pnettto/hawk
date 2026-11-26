import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { formatDate } from '../utils/date'

const NOTES = [
  { id: 'n-plain', title: 'Plain', tags: [], createdAt: 1, updatedAt: 1 },
  { id: 'n-day', title: 'Day', tags: [], day: '2026-05-01', dayOrder: 0, createdAt: 2, updatedAt: 2 },
  { id: 'n-trash', title: 'Gone', tags: [], createdAt: 3, updatedAt: 3, deletedAt: 5 },
]

const flush = () => new Promise((r) => setTimeout(r, 0))

async function boot(url: string) {
  history.replaceState(null, '', url)
  vi.resetModules()
  const notesApi = await import('../api/notes')
  vi.spyOn(notesApi, 'getNotesIndex').mockResolvedValue(NOTES)
  vi.spyOn(notesApi, 'getNote').mockImplementation(async (id: string) => ({ ...NOTES.find((n) => n.id === id)!, content: '' }))
  const authApi = await import('../api/auth')
  vi.spyOn(authApi, 'authCheck').mockResolvedValue(true)
  const { appStore } = await import('../stores/app')
  const { notesStore } = await import('../stores/notes')
  const { authStore } = await import('../stores/auth')
  const router = await import('./sync')
  router.startRouter()
  await authStore.checkSession()
  await flush()
  const here = () => `${location.pathname}${location.search}`
  return { appStore, notesStore, router, here }
}

beforeEach(() => {
  localStorage.clear()
})

describe('router sync', () => {
  it('applies a journal link without changing the remembered tab', async () => {
    localStorage.setItem('hawk_journal_tab', 'tasks')
    const { appStore, here } = await boot('/journal/2026-05-14/notes')
    expect(formatDate(get(appStore).selectedDate)).toBe('2026-05-14')
    expect(get(appStore).journalTab).toBe('notes')
    expect(localStorage.getItem('hawk_journal_tab')).toBe('tasks')
    expect(here()).toBe('/journal/2026-05-14/notes')
  })

  it('round-trips store state through the URL', async () => {
    const { appStore, notesStore, here } = await boot('/')
    expect(here()).toBe('/')
    appStore.setCurrentPage('notes')
    notesStore.setFilter({ kind: 'tag', tag: 'a b' })
    await flush()
    expect(here()).toBe('/notes/tag/a%20b')
    appStore.setCurrentPage('admin')
    await flush()
    expect(here()).toBe('/settings')
    expect(document.title).toBe('Hawk · Settings')
  })

  it('replaces for day steps and pushes for pages', async () => {
    const { appStore, here } = await boot('/journal/2026-05-14')
    const start = history.length
    appStore.setSelectedDate(new Date('2026-05-15T12:00:00'))
    await flush()
    appStore.setSelectedDate(new Date('2026-05-16T12:00:00'))
    await flush()
    expect(history.length).toBe(start)
    expect(here()).toBe('/journal/2026-05-16')
    appStore.setCurrentPage('files')
    await flush()
    expect(history.length).toBe(start + 1)
  })

  it('opens a linked note once the notes load, under a filter that shows it', async () => {
    const { appStore, notesStore, here } = await boot('/notes/n-day')
    expect(get(appStore).currentPage).toBe('notes')
    await notesStore.load()
    await flush()
    expect(get(notesStore).selectedNid).toBe('n-day')
    expect(get(notesStore).filter).toEqual({ kind: 'day' })
    expect(localStorage.getItem('hawk_notes_filter')).toBeNull()
    expect(here()).toBe('/notes/n-day')
    expect(document.title).toBe('Hawk · Day')
  })

  it('opens a trashed note in Trash', async () => {
    const { notesStore } = await boot('/notes/n-trash')
    await notesStore.load()
    await flush()
    expect(get(notesStore).filter).toEqual({ kind: 'trash' })
    expect(get(notesStore).selectedNid).toBe('n-trash')
  })

  it('falls back to the list for a missing note', async () => {
    const { notesStore, here } = await boot('/notes/nope')
    await notesStore.load()
    await flush()
    expect(get(notesStore).selectedNid).toBeNull()
    expect(here()).toBe('/notes/pinned')
  })

  it('sets a one-shot task highlight from ?task=', async () => {
    const { appStore } = await boot('/journal/2026-05-14?task=t1')
    expect(get(appStore).highlightTaskId).toBe('t1')
  })
})
