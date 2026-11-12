import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayLog, Note, NoteMetadata } from '../types/models'
import { formatDate } from '../utils/date'

// guest.ts caches its data per module instance; reload it for each test.
async function freshGuest() {
  vi.resetModules()
  return (await import('./guest')).guestRequest
}

describe('guest API', () => {
  beforeEach(() => localStorage.clear())

  it('seeds demo content on first use', async () => {
    const req = await freshGuest()
    const today = formatDate(new Date())
    const day = await req<DayLog>('GET', `/api/day?date=${today}`)
    expect(day.tasks.length).toBeGreaterThan(0)
    const index = await req<NoteMetadata[]>('GET', '/api/notes/index')
    expect(index.map((n) => n.id)).toContain('demo-welcome')
    expect(index.find((n) => n.id === 'demo-trip')?.tags).toEqual(['personal', 'travel'])
    expect(index.find((n) => n.id === 'demo-ideas')?.tags).toEqual([])
    const dayNotes = await req<Note[]>('GET', `/api/notes/days?start=${today}&end=${today}`)
    expect(dayNotes.map((n) => n.id)).toEqual([`day-${today}`])
  })

  it('upserts and removes tasks', async () => {
    const req = await freshGuest()
    const t = { id: 'a', text: '14:30 Gym', time: '14:30', done: false, order: 0 }
    await req('POST', '/api/day/tasks?date=2026-01-02', { upsert: [t] })
    let day = await req<DayLog>('GET', '/api/day?date=2026-01-02')
    expect(day.tasks.map((x) => x.text)).toEqual(['14:30 Gym'])
    await req('POST', '/api/day/tasks?date=2026-01-02', { remove: ['a'] })
    day = await req<DayLog>('GET', '/api/day?date=2026-01-02')
    expect(day.tasks).toEqual([])
  })

  it('saves notes, parses tags, and survives a reload', async () => {
    let req = await freshGuest()
    const res = await req<{ rev: number }>('POST', '/api/notes/notes', { id: 'n1', title: 'Hi', content: 'Body #work' })
    expect(res.rev).toBe(1)
    req = await freshGuest()
    const note = await req<Note>('GET', '/api/notes/notes/n1')
    expect(note.tags).toEqual(['work'])
    expect(note.content).toBe('Body #work')
  })

  it('trashes, restores and empties the trash', async () => {
    const req = await freshGuest()
    await req('POST', '/api/notes/notes/demo-trip/trash')
    let meta = (await req<NoteMetadata[]>('GET', '/api/notes/index')).find((n) => n.id === 'demo-trip')
    expect(meta?.deletedAt).toBeTypeOf('number')
    await req('POST', '/api/notes/notes/demo-trip/restore')
    meta = (await req<NoteMetadata[]>('GET', '/api/notes/index')).find((n) => n.id === 'demo-trip')
    expect(meta?.deletedAt).toBeUndefined()
    await req('POST', '/api/notes/notes/demo-trip/trash')
    await req('DELETE', '/api/notes/trash')
    const ids = (await req<NoteMetadata[]>('GET', '/api/notes/index')).map((n) => n.id)
    expect(ids).not.toContain('demo-trip')
  })

  it('has no version history or files', async () => {
    const req = await freshGuest()
    expect(await req('GET', '/api/notes/notes/demo-welcome/versions')).toEqual([])
    expect(await req('GET', '/api/files')).toEqual([])
  })
})
