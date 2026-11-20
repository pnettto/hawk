import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

async function store() {
  return (await import('./notes')).notesStore
}

describe('default Notepad collection', () => {
  it('starts in Notepad notes without a saved collection', async () => {
    expect(get(await store()).filter).toEqual({ kind: 'notepad' })
  })

  it('migrates the old All notes default once', async () => {
    localStorage.setItem('hawk_notes_filter', JSON.stringify({ kind: 'all' }))
    const notes = await store()
    expect(get(notes).filter).toEqual({ kind: 'notepad' })
    notes.setFilter({ kind: 'all' })
    vi.resetModules()
    expect(get(await store()).filter).toEqual({ kind: 'all' })
  })

  it.each([{ kind: 'tag', tag: 'work' }, { kind: 'day' }, { kind: 'trash' }])('preserves a saved $kind collection', async filter => {
    localStorage.setItem('hawk_notes_filter', JSON.stringify(filter))
    expect(get(await store()).filter).toEqual(filter)
  })

  it('falls back to Notepad notes for invalid saved data', async () => {
    localStorage.setItem('hawk_notes_filter', 'not json')
    expect(get(await store()).filter).toEqual({ kind: 'notepad' })
  })
})

describe('day note ordering', () => {
  async function setup() {
    const api = await import('../api/notes')
    const day = '2026-06-10'
    const original = [
      { id: 'a', title: 'First', tags: [], day, dayOrder: 0, createdAt: 1, updatedAt: 1 },
      { id: 'b', title: 'Second', tags: [], day, dayOrder: 1, createdAt: 2, updatedAt: 2 },
      { id: 'other', title: 'Other day', tags: [], day: '2026-06-11', dayOrder: 0, createdAt: 3, updatedAt: 3 },
    ]
    vi.spyOn(api, 'getNotesIndex').mockResolvedValue(original)
    const save = vi.spyOn(api, 'saveNote').mockResolvedValue({ success: true, rev: 1, updatedAt: 1 })
    const notes = await store()
    await notes.load()
    return { notes, save, day }
  }

  it('updates immediately and persists only ordering metadata', async () => {
    const { notes, save, day } = await setup()
    const saving = notes.reorderDayNotes(day, ['b', 'a'])
    expect(get(notes).allNotes.find((n) => n.id === 'b')?.dayOrder).toBe(0)
    await saving
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledWith({ id: 'b', day, dayOrder: 0, createdAt: 2 })
    expect(save).toHaveBeenCalledWith({ id: 'a', day, dayOrder: 1, createdAt: 1 })
    expect(get(notes).allNotes.find((n) => n.id === 'other')?.dayOrder).toBe(0)
  })

  it('ignores stale IDs, duplicates, and unchanged order', async () => {
    const { notes, save, day } = await setup()
    await notes.reorderDayNotes(day, ['missing', 'a', 'a', 'other'])
    expect(save).not.toHaveBeenCalled()
  })

  it('serializes quick successive reorders', async () => {
    const { notes, save, day } = await setup()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    save.mockImplementationOnce(async () => {
      await waiting
      return { success: true, rev: 1, updatedAt: 1 }
    })
    const first = notes.reorderDayNotes(day, ['b', 'a'])
    const second = notes.reorderDayNotes(day, ['a', 'b'])
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    release()
    await Promise.all([first, second])
    expect(save.mock.calls.map(([note]) => [note.id, note.dayOrder])).toEqual([
      ['b', 0], ['a', 1], ['a', 0], ['b', 1],
    ])
  })
})
