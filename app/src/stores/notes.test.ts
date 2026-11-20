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
