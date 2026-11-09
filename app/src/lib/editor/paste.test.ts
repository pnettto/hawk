import { describe, expect, it } from 'vitest'
import { looksLikeMarkdown, splitSoftBreaks } from './paste'

describe('looksLikeMarkdown', () => {
  it('detects common syntax', () => {
    expect(looksLikeMarkdown('# Title')).toBe(true)
    expect(looksLikeMarkdown('- a\n- b')).toBe(true)
    expect(looksLikeMarkdown('see [docs](https://x.y)')).toBe(true)
    expect(looksLikeMarkdown('some **bold** text')).toBe(true)
  })
  it('ignores prose', () => {
    expect(looksLikeMarkdown('Just a sentence.\nAnother line.')).toBe(false)
    expect(looksLikeMarkdown('snake_case_name is fine')).toBe(false)
  })
})

describe('splitSoftBreaks', () => {
  it('keeps consecutive plain lines as separate paragraphs', () => {
    expect(splitSoftBreaks('# T\nline a\nline b')).toBe('# T\nline a\n\nline b')
  })
  it('leaves lists and code fences alone', () => {
    expect(splitSoftBreaks('- a\n- b')).toBe('- a\n- b')
    expect(splitSoftBreaks('```\nx\ny\n```')).toBe('```\nx\ny\n```')
  })
})
