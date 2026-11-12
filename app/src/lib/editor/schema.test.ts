import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { contentExtensions } from './schema'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

const md = (e: Editor) => (e.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()

function roundTrip(input: string): { first: string; second: string; editor: Editor } {
  editor = new Editor({ extensions: contentExtensions(), content: input })
  const first = md(editor)
  editor.commands.setContent(first)
  return { first, second: md(editor), editor }
}

describe('body markdown round-trip', () => {
  it('keeps checklists tight, checked state and nesting included', () => {
    const input = '- [ ] one\n- [x] two\n  - [ ] nested'
    const { first, second, editor } = roundTrip(input)
    expect(first.trim()).toBe(input)
    expect(second).toBe(first)
    const list = editor.state.doc.firstChild!
    expect(list.type.name).toBe('taskList')
    expect(list.child(1).attrs.checked).toBe(true)
  })

  it('keeps a line-leading #tag unescaped', () => {
    const { first } = roundTrip('Body\n\n#general-notes')
    expect(first.trim()).toBe('Body\n\n#general-notes')
  })

  it('keeps tables as GFM', () => {
    const input = '| A | B |\n| --- | --- |\n| 1 | **2** |'
    const { first, second, editor } = roundTrip(input)
    expect(first.trim()).toBe(input)
    expect(second).toBe(first)
    expect(editor.getJSON().content?.[0].type).toBe('table')
  })

  it('keeps lead paragraphs with their inline marks', () => {
    const { second, editor } = roundTrip('<p class="lead">Hello <strong>there</strong></p>\n\nBody')
    expect(second).toContain('class="lead"')
    const doc = editor.getJSON()
    expect(doc.content?.[0].type).toBe('lead')
    expect(doc.content?.[0].content?.[1].marks?.[0].type).toBe('bold')
    expect(doc.content?.[1].type).toBe('paragraph')
  })

  it('keeps uploaded videos', () => {
    const { second, editor } = roundTrip('Before\n\n<video src="https://x.test/v.mp4"></video>\n\nAfter')
    expect(second).toContain('<video')
    expect(editor.getJSON().content?.map((n) => n.type)).toEqual(['paragraph', 'video', 'paragraph'])
    expect(editor.getJSON().content?.[1].attrs?.src).toBe('https://x.test/v.mp4')
  })

  it('keeps file attachments with name and size', () => {
    const input = 'Before\n\n<div data-attachment="" data-size="2048"><a href="https://x.test/f" target="_blank" rel="noopener noreferrer">Q3 report &amp; notes.pdf</a></div>\n\nAfter'
    const { first, second, editor } = roundTrip(input)
    expect(second).toBe(first)
    expect(editor.getJSON().content?.map((n) => n.type)).toEqual(['paragraph', 'attachment', 'paragraph'])
    expect(editor.getJSON().content?.[1].attrs).toEqual({ href: 'https://x.test/f', name: 'Q3 report & notes.pdf', size: 2048 })
  })

  it('ends block images so the next block starts on its own', () => {
    editor = new Editor({ extensions: contentExtensions(), content: '' })
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'x.png' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        { type: 'image', attrs: { src: 'y (1).png' } },
        { type: 'video', attrs: { src: 'v.mp4' } },
      ],
    })
    const out = md(editor)
    expect(out.startsWith('![](x.png)\n\nb\n\n![](<y (1).png>)\n\n<video')).toBe(true)
    editor.commands.setContent(out)
    // (An HTML block at the very end parses with an empty paragraph after it.)
    expect(editor.getJSON().content?.map((n) => n.type).slice(0, 4)).toEqual(['image', 'paragraph', 'image', 'video'])
    // markdown-it percent-encodes the space: the same URL.
    expect(editor.getJSON().content?.[2].attrs?.src).toBe('y%20(1).png')
  })

  it('keeps map blocks as ```map fenced code', () => {
    const input = '```map\n{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[18.0498802,59.3410997]},"properties":{"name":"Old Touch"}}]}\n```'
    const { first, second, editor } = roundTrip(input)
    expect(first.trim()).toBe(input)
    expect(second).toBe(first)
    expect(editor.getJSON().content?.map((n) => n.type)).toEqual(['mapBlock', 'paragraph'])
  })

  it('keeps more than one map in a note', () => {
    const map = '```map\n{"type":"FeatureCollection","properties":{"center":[18,59]},"features":[]}\n```'
    const { first, second, editor } = roundTrip(`${map}\n\nBetween\n\n${map}`)
    expect(first.match(/```map/g)).toHaveLength(2)
    expect(second).toBe(first)
    expect(editor.getJSON().content?.map((n) => n.type)).toEqual(['mapBlock', 'paragraph', 'mapBlock', 'paragraph'])
  })

  it('keeps empty lines between paragraphs', () => {
    editor = new Editor({
      extensions: contentExtensions(),
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph' },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        { type: 'paragraph' },
      ] },
    })
    const out = md(editor)
    expect(out).toBe('a\n\n&nbsp;\n\n&nbsp;\n\nb')
    editor.commands.setContent(out)
    expect(editor.getJSON().content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
      { type: 'paragraph' },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
    ])
    expect(md(editor)).toBe(out)
  })
})
