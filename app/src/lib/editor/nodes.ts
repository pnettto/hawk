import { Node, mergeAttributes } from '@tiptap/core'

// Bodies are stored as markdown. Neither of these has a markdown form, so
// tiptap-markdown falls back to writing them as raw HTML blocks — the same
// way the YouTube embed round-trips.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    video: {
      setVideo: (attrs: { src: string }) => ReturnType
    }
    attachment: {
      setAttachment: (attrs: { href: string; name: string; size?: number | null }) => ReturnType
    }
  }
}

// Larger opening paragraph: <p class="lead">.
export const Lead = Node.create({
  name: 'lead',
  group: 'block',
  content: 'inline*',
  defining: true,
  parseHTML() {
    // Must win over the plain paragraph rule.
    return [{ tag: 'p.lead', priority: 100 }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { class: 'lead' }), 0]
  },
})

// Native <video> for uploaded files and direct links. YouTube keeps its own
// iframe node.
export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'video[src]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: 'true', preload: 'metadata', playsinline: 'true' })]
  },
  addCommands() {
    return {
      setVideo:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// Set on the transaction when an attachment's ✕ removes it, so the editor can
// offer to delete the stored file too (see RichEditor).
export const REMOVE_ATTACHMENT = 'hawkRemoveAttachment'

// The stored file behind an attachment link, if it's one of ours.
export function attachmentFileId(href: string | null | undefined): string | null {
  return href?.match(/\/api\/(?:public\/)?files\/([^/?#]+)/)?.[1] ?? null
}

// Any other file uploaded into a note: a download chip.
//   <div data-attachment data-size="1234"><a href="…">report.pdf</a></div>
export const Attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      href: { default: null },
      name: { default: 'File' },
      size: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const n = Number(el.getAttribute('data-size'))
          return Number.isFinite(n) && n > 0 ? n : null
        },
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-attachment]',
        getAttrs: (el: HTMLElement) => {
          const a = el.querySelector('a')
          if (!a?.getAttribute('href')) return false
          return { href: a.getAttribute('href'), name: a.textContent?.trim() || 'File' }
        },
      },
    ]
  },
  renderHTML({ node }) {
    const { href, name, size } = node.attrs
    return [
      'div',
      size ? { 'data-attachment': '', 'data-size': String(size) } : { 'data-attachment': '' },
      ['a', { href, target: '_blank', rel: 'noopener noreferrer' }, name],
    ]
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div')
      dom.className = 'attachment'
      dom.contentEditable = 'false'
      const a = document.createElement('a')
      a.href = node.attrs.href
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.draggable = false
      const icon = document.createElement('span')
      icon.className = 'attachment-icon'
      icon.setAttribute('aria-hidden', 'true')
      const name = document.createElement('span')
      name.className = 'attachment-name'
      name.textContent = node.attrs.name
      a.append(icon, name)
      if (node.attrs.size) {
        const size = document.createElement('span')
        size.className = 'attachment-size'
        size.textContent = formatBytes(node.attrs.size)
        a.append(size)
      }
      // Open in a new tab rather than letting the editor swallow the click.
      a.addEventListener('click', (e) => {
        e.preventDefault()
        window.open(node.attrs.href, '_blank', 'noopener')
      })
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'attachment-remove'
      remove.title = 'Remove from note'
      remove.setAttribute('aria-label', 'Remove from note')
      remove.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>'
      remove.addEventListener('mousedown', (e) => e.preventDefault())
      remove.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (pos == null || !editor.isEditable) return
        const tr = editor.state.tr.delete(pos, pos + node.nodeSize).setMeta(REMOVE_ATTACHMENT, true)
        editor.view.dispatch(tr)
      })
      dom.append(a, remove)
      return { dom, stopEvent: (e: Event) => remove.contains(e.target as globalThis.Node) }
    }
  },
  addCommands() {
    return {
      setAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})
