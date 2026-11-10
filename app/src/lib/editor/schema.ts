import StarterKit from '@tiptap/starter-kit'
import Paragraph from '@tiptap/extension-paragraph'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Youtube from '@tiptap/extension-youtube'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Markdown } from 'tiptap-markdown'
import { Attachment, Lead, Video } from './nodes'

interface PMNode {
  type: { name: string }
  childCount: number
  child(i: number): PMNode
}

interface MarkdownState {
  write(s: string): void
  esc(s: string): string
  closeBlock(node: unknown): void
}

// tiptap-markdown writes images as inline markdown and never ends the block,
// so a block image ran straight into whatever followed it ("![](a.png)Next
// paragraph"). Same syntax, but closed like any other block.
const BlockImage = Image.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: { attrs: { src: string; alt?: string; title?: string } }) {
          const { src, alt, title } = node.attrs
          const t = title ? ` "${title.replace(/"/g, '\\"')}"` : ''
          // Spaces aren't allowed in a bare destination; <…> allows them.
          const dest = /\s/.test(src) ? `<${src.replace(/[<>]/g, encodeURIComponent)}>` : src.replace(/[()]/g, '\\$&')
          state.write(`![${state.esc(alt || '')}](${dest}${t})`)
          state.closeBlock(node)
        },
      },
    }
  },
})

// tiptap-markdown only tracks list tightness on bullet/ordered lists, so a
// checklist was written loose — a blank line between every item. Same
// attribute, for checklists.
const TightTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tight: {
        default: true,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tight') === 'true' || !el.querySelector('p'),
        renderHTML: (attrs: { tight?: boolean }) => (attrs.tight ? { 'data-tight': 'true' } : {}),
      },
    }
  },
})

// Markdown has no empty paragraph — blank lines between blocks collapse — so
// an empty line in the editor was lost on save. Write it as "&nbsp;" (which
// any markdown renderer shows as a blank line) and read that back as an empty
// paragraph. Trailing empty paragraphs are left out; the editor adds one after
// a closing image/video on its own.
const BlankLineParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: MarkdownState & { renderInline(node: unknown): void },
          node: PMNode,
          parent: PMNode,
          index: number,
        ) {
          if (node.childCount === 0 && parent.type.name === 'doc') {
            let more = false
            for (let i = index + 1; i < parent.childCount && !more; i++) {
              const next = parent.child(i)
              more = !(next.type.name === 'paragraph' && next.childCount === 0)
            }
            if (more) state.write('&nbsp;')
            state.closeBlock(node)
            return
          }
          state.renderInline(node)
          state.closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            for (const p of element.querySelectorAll(':scope > p')) {
              if (p.childNodes.length === 1 && p.textContent === '\u00a0') p.textContent = ''
            }
          },
        },
      },
    }
  },
})

// Everything that defines what a body can contain and how it maps to
// markdown. Shared by the editor and the round-trip tests.
export function contentExtensions() {
  return [
    StarterKit.configure({ link: false, paragraph: false }),
    BlankLineParagraph,
    Markdown.configure({ transformPastedText: false, transformCopiedText: true }),
    Link.configure({
      openOnClick: true,
      autolink: true,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    // allowBase64 stays on so older notes with inline images still load.
    BlockImage.configure({ inline: false, allowBase64: true }),
    Youtube.configure({ controls: true, nocookie: true, allowFullscreen: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TightTaskList,
    TaskItem.configure({ nested: true }),
    Lead,
    Video,
    Attachment,
  ]
}
