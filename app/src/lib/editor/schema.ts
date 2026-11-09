import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Youtube from '@tiptap/extension-youtube'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
import { Lead, Video } from './nodes'

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

// Everything that defines what a body can contain and how it maps to
// markdown. Shared by the editor and the round-trip tests.
export function contentExtensions() {
  return [
    StarterKit.configure({ link: false }),
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
    Lead,
    Video,
  ]
}
