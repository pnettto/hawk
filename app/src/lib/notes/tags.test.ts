import { describe, expect, it } from 'vitest'
import { parseTags, TAG_TYPING_RE } from './tags'

describe('parseTags', () => {
  it('finds tags at line starts, after spaces and parens', () => {
    expect(parseTags('#Work notes and #a/b (#paren)\n\\#escaped')).toEqual(['a/b', 'escaped', 'paren', 'work'])
  })

  it('ignores headings, numbers, URL fragments and code', () => {
    expect(parseTags('# Heading\n#123 [x](http://a.com/#frag) page#x `#code`\n```\n#fenced\n```')).toEqual([])
  })

  it('keeps tags with digits when they have a letter', () => {
    expect(parseTags('#2024-ideas')).toEqual(['2024-ideas'])
  })
})

describe('TAG_TYPING_RE', () => {
  it('matches a tag being typed', () => {
    expect(TAG_TYPING_RE.exec('hello #wo')?.[1]).toBe('wo')
    expect(TAG_TYPING_RE.exec('#')?.[1]).toBe('')
    expect(TAG_TYPING_RE.exec('a#b')).toBeNull()
    expect(TAG_TYPING_RE.exec('#done ')).toBeNull()
  })
})
