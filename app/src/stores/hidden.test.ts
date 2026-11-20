import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { conceal, isConcealed, reveal, revealedNote } from './hidden'

describe('hidden notes', () => {
  it('reveals one note at a time', () => {
    reveal('a')
    expect(isConcealed({ id: 'a', hidden: true }, get(revealedNote))).toBe(false)
    expect(isConcealed({ id: 'b', hidden: true }, get(revealedNote))).toBe(true)
    expect(isConcealed({ id: 'c' }, get(revealedNote))).toBe(false)

    reveal('b')
    expect(isConcealed({ id: 'a', hidden: true }, get(revealedNote))).toBe(true)
    conceal()
  })

  it('only conceals the note it was asked to', () => {
    reveal('a')
    conceal('b')
    expect(get(revealedNote)).toBe('a')
    conceal('a')
    expect(get(revealedNote)).toBeNull()
  })
})
