import { describe, expect, it } from 'vitest'
import { parseTags, splitTitleTags, TAG_TYPING_RE } from './tags'

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

describe('splitTitleTags', () => {
  it('moves tags out of the title', () => {
    expect(splitTitleTags('Trip ideas #travel')).toEqual({ title: 'Trip ideas', tags: ['travel'] })
    expect(splitTitleTags('#work Plan  Q3 #Ideas')).toEqual({ title: 'Plan Q3', tags: ['ideas', 'work'] })
    expect(splitTitleTags('Issue #1 and page#top')).toEqual({ title: 'Issue #1 and page#top', tags: [] })
    expect(splitTitleTags('#travel')).toEqual({ title: '', tags: ['travel'] })
  })
})
