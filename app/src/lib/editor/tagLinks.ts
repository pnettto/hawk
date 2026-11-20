import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'

const TAG_IN_TEXT = /(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_\-/]*)/gu

// Decorations keep tags as plain, editable text in saved Markdown.
export function tagDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false
    if (!node.isText || node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return
    for (const match of node.text!.matchAll(TAG_IN_TEXT)) {
      const text = match[2].replace(/[-/]+$/, '')
      if (!/\p{L}/u.test(text)) continue
      const tag = text.toLowerCase()
      const from = pos + match.index! + match[1].length
      decorations.push(Decoration.inline(from, from + text.length + 1, {
        class: 'hawk-tag tag-badge', 'data-tag': tag, role: 'link', tabindex: '0',
        'aria-label': `Open #${tag} collection`, title: `Open #${tag} collection (Alt-click to edit)`,
      }))
    }
  })
  return DecorationSet.create(doc, decorations)
}

export function tagLinks(onOpen: (tag: string) => void) {
  return Extension.create({
    name: 'tagLinks',
    addProseMirrorPlugins() {
      const key = new PluginKey<DecorationSet>('tagLinks')
      const target = (event: Event) => event.target instanceof Element
        ? event.target.closest<HTMLElement>('.hawk-tag[data-tag]') : null
      return [new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, { doc }) => tagDecorations(doc),
          apply: (tr, old) => tr.docChanged ? tagDecorations(tr.doc) : old,
        },
        props: {
          decorations: state => key.getState(state),
          handleDOMEvents: {
            mousedown: (_, event) => {
              if (event.button !== 0 || event.altKey || !target(event)) return false
              // Keep clicking a tag from moving the editing caret first.
              event.preventDefault()
              return true
            },
            click: (view, event) => {
              const tag = target(event)?.dataset.tag
              if (!tag || event.altKey || !view.state.selection.empty) return false
              event.preventDefault()
              event.stopPropagation()
              onOpen(tag)
              return true
            },
            keydown: (_, event) => {
              const tag = target(event)?.dataset.tag
              if (!tag || !['Enter', ' '].includes(event.key)) return false
              event.preventDefault()
              event.stopPropagation()
              onOpen(tag)
              return true
            },
          },
        },
      })]
    },
  })
}
