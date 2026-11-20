import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { contentExtensions } from './schema'
import { tagLinks } from './tagLinks'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

function setup(content: string) {
  const open = vi.fn()
  editor = new Editor({ extensions: [...contentExtensions(), tagLinks(open)], content })
  return { editor, open }
}

describe('tag links', () => {
  it('normalizes collection names and ignores code, links, numbers and URL fragments', () => {
    const { editor } = setup('#Work/Ideas/ #123 page#fragment `#code` [#link](https://test.com)\n\n```\n#fenced\n```')
    const tags = editor.view.dom.querySelectorAll('[data-tag]')
    expect(tags).toHaveLength(1)
    expect(tags[0].getAttribute('data-tag')).toBe('work/ideas')
    expect(tags[0].textContent).toBe('#Work/Ideas')
  })

  it('opens a tag on click without changing Markdown, and allows Alt-click to edit', () => {
    const { editor, open } = setup('A note #Work')
    const before = editor.getJSON()
    const tag = editor.view.dom.querySelector('[data-tag]')!
    tag.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(open).toHaveBeenCalledWith('work')
    expect(editor.getJSON()).toEqual(before)
    open.mockClear()
    tag.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))
    expect(open).not.toHaveBeenCalled()
  })

  it.each(['Enter', ' '])('supports keyboard activation with %s', key => {
    const { editor, open } = setup('#journal')
    const tag = editor.view.dom.querySelector('[data-tag]')!
    expect(tag.getAttribute('tabindex')).toBe('0')
    tag.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))
    expect(open).toHaveBeenCalledWith('journal')
  })
})
