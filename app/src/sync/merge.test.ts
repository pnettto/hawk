import { describe, expect, it } from 'vitest'
import { merge3 } from './merge'

describe('merge3', () => {
  it('takes remote when local is unchanged', () => {
    expect(merge3('a b', 'a b', 'a b c')).toBe('a b c')
  })

  it('takes local when remote is unchanged', () => {
    expect(merge3('a b', 'a b c', 'a b')).toBe('a b c')
  })

  it('merges edits to different words of the same paragraph', () => {
    const base = 'The quick brown fox jumps over the lazy dog.'
    const local = 'The quick red fox jumps over the lazy dog.'
    const remote = 'The quick brown fox jumps over the sleepy dog.'
    expect(merge3(base, local, remote)).toBe('The quick red fox jumps over the sleepy dog.')
  })

  it('merges edits in different paragraphs', () => {
    const base = '# Title\n\nFirst para.\n\nSecond para.'
    const local = '# Title\n\nFirst para, edited here.\n\nSecond para.'
    const remote = '# Title\n\nFirst para.\n\nSecond para.\n\nThird para from phone.'
    expect(merge3(base, local, remote)).toBe(
      '# Title\n\nFirst para, edited here.\n\nSecond para.\n\nThird para from phone.',
    )
  })

  it('does not duplicate an identical edit made on both sides', () => {
    const base = 'one two'
    const both = 'one two three'
    expect(merge3(base, both, both)).toBe(both)
    expect(merge3(base, 'zero one two three', 'one two three')).toBe('zero one two three')
  })

  it('keeps the local side of a true conflict', () => {
    expect(merge3('a cat', 'a dog', 'a bird')).toBe('a dog')
  })

  it('handles unicode words', () => {
    expect(merge3('olá mundo', 'olá mundo lindo', 'oi olá mundo')).toBe('oi olá mundo lindo')
  })
})
