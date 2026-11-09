import { Node, mergeAttributes } from '@tiptap/core'

// Bodies are stored as markdown. Neither of these has a markdown form, so
// tiptap-markdown falls back to writing them as raw HTML blocks — the same
// way the YouTube embed round-trips.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    video: {
      setVideo: (attrs: { src: string }) => ReturnType
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
