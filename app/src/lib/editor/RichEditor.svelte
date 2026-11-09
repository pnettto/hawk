<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Editor, InputRule, Extension, createDocument } from '@tiptap/core'
  import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
  import type { EditorView } from '@tiptap/pm/view'
  import StarterKit from '@tiptap/starter-kit'
  import Placeholder from '@tiptap/extension-placeholder'
  import Link from '@tiptap/extension-link'
  import Image from '@tiptap/extension-image'
  import Youtube from '@tiptap/extension-youtube'
  import { Markdown } from 'tiptap-markdown'
  import type { DocSession, EditorBridge } from '../../sync/docSession'
  import { uploadFile, publicFileUrl } from '../../api/files'
  import { showError, showToast } from '../../stores/toast'
  import { looksLikeMarkdown, splitSoftBreaks } from './paste'

  interface Props {
    session: DocSession
    onBlur?: () => void
    placeholder?: string
    autofocus?: boolean
  }
  let { session, onBlur, placeholder = 'Write here…', autofocus = false }: Props = $props()

  let element: HTMLDivElement
  let editor: Editor | null = null
  let bridge: EditorBridge | null = null

  // Marks transactions that carry remote content so they don't echo back as
  // local edits (and stay out of the undo stack).
  const REMOTE = 'hawkRemote'

  // Custom input rules — kept identical to the legacy RichEditor so previously
  // saved notes round-trip the same way.
  const markdownLinkInputRule = new InputRule({
    find: /\[(.+?)\]\((.+?)\)\s$/,
    handler: ({ state, range, match }) => {
      const [, text, href] = match
      const { tr } = state
      const link = state.schema.marks.link
      if (link && href) {
        tr.replaceWith(range.from, range.to, state.schema.text(text, [link.create({ href })]))
        tr.insertText(' ')
      }
    },
  })

  const youtubeInputRule = new InputRule({
    find: /(?:^|\s)(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11}))\s$/,
    handler: ({ state, range, match }) => {
      const [, url, videoId] = match
      const { tr } = state
      if (videoId) {
        tr.replaceWith(range.from, range.to, state.schema.nodes.youtube.create({ src: url }))
      }
    },
  })

  const imageInputRule = new InputRule({
    find: /!\[(.+?)\]\((.+?)\)\s$/,
    handler: ({ state, range, match }) => {
      const [, alt, src] = match
      const { tr } = state
      if (src) {
        tr.replaceWith(range.from, range.to, state.schema.nodes.image.create({ src, alt }))
      }
    },
  })

  const CustomInputRules = Extension.create({
    name: 'customInputRules',
    addInputRules() {
      return [markdownLinkInputRule, youtubeInputRule, imageInputRule]
    },
  })

  function markdownToHtml(md: string): string {
    const parser = (editor?.storage as { markdown?: { parser?: { parse: (s: string) => string } } })
      ?.markdown?.parser
    return parser ? parser.parse(md) : md
  }

  // ---- images ----------------------------------------------------------

  const imageFiles = (list: FileList | null | undefined) =>
    Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))

  // Upload pasted/dropped images to Files and insert them where the user
  // pasted. Positions are mapped through edits made while uploading.
  async function insertImages(view: EditorView, files: File[], at: number) {
    const tracker = { pos: at }
    const follow = ({ transaction }: { transaction: Transaction }) => {
      tracker.pos = transaction.mapping.map(tracker.pos)
    }
    editor?.on('transaction', follow)
    const dismiss = showToast(files.length > 1 ? `Uploading ${files.length} images…` : 'Uploading image…', {
      duration: 60_000,
    })
    try {
      for (const file of files) {
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
        const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
        const name = file.name && file.name !== 'image.png' ? file.name : `Pasted image ${stamp}.${ext}`
        const meta = await uploadFile(file, name, { inline: true })
        if (!editor || editor.isDestroyed) return
        const node = view.state.schema.nodes.image.create({ src: publicFileUrl(meta.id), alt: '' })
        // Images are blocks: replace the paragraph if it's empty, otherwise
        // go right after it — never inside it.
        const { state } = view
        const rp = state.doc.resolve(Math.min(tracker.pos, state.doc.content.size))
        let tr = state.tr
        if (rp.parent.isTextblock && rp.depth > 0) {
          if (rp.parent.content.size === 0) tr = tr.replaceWith(rp.before(), rp.after(), node)
          else tr = tr.insert(rp.after(), node)
        } else {
          tr = tr.insert(rp.pos, node)
        }
        view.dispatch(tr)
        tracker.pos = tr.mapping.map(tracker.pos, 1)
      }
    } catch (e) {
      console.error('Image upload failed', e)
      showError(e instanceof Error ? e.message : 'Image upload failed.')
    } finally {
      dismiss()
      editor?.off('transaction', follow)
    }
  }

  // ---- paste -----------------------------------------------------------

  // Paste rules, in order:
  // 1. Image files → upload + insert.
  // 2. Copied from a ProseMirror editor (incl. this one) → default handling,
  //    which preserves the exact structure.
  // 3. Plain text that looks like markdown (also what VS Code & co. put on the
  //    clipboard next to a styled-HTML copy) → parse as markdown.
  // 4. Rich HTML (web pages, Docs) → default HTML paste, keeps links/lists.
  // 5. Plain text → default, one paragraph per line.
  const SmartPaste = Extension.create({
    name: 'smartPaste',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('smartPaste'),
          props: {
            handlePaste: (view, event) => {
              const data = event.clipboardData
              // Synthetic events from view.pasteHTML below have no clipboardData.
              if (!data) return false
              const images = imageFiles(data.files)
              if (images.length) {
                event.preventDefault()
                void insertImages(view, images, view.state.selection.from)
                return true
              }
              const html = data.getData('text/html')
              if (html && /data-pm-slice/.test(html)) return false
              const text = data.getData('text/plain')
              if (!text) return false
              const inCode = view.state.selection.$from.parent.type.spec.code
              if (inCode) return false
              const fromCodeEditor = !!html && /vscode|monaco|<meta[^>]+charset/i.test(html) && !/<(p|h[1-6]|li|a)\b/i.test(html)
              if (looksLikeMarkdown(text) && (!html || fromCodeEditor || !/<(a|strong|b|em|i|h[1-6]|li|img)\b/i.test(html))) {
                event.preventDefault()
                const rendered = markdownToHtml(splitSoftBreaks(text))
                if (!view.pasteHTML(rendered)) editor?.commands.insertContent(rendered)
                return true
              }
              return false
            },
            handleDrop: (view, event) => {
              const images = imageFiles(event.dataTransfer?.files)
              if (!images.length) return false
              event.preventDefault()
              const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
              void insertImages(view, images, hit?.pos ?? view.state.selection.from)
              return true
            },
          },
        }),
      ]
    },
  })

  function getMarkdown(): string {
    if (!editor) return ''
    // tiptap-markdown stores its serializer here; it isn't part of the typed editor surface.
    return (editor.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? ''
  }

  // ---- applying remote content -------------------------------------------

  function scrollParent(el: HTMLElement): HTMLElement | null {
    let node: HTMLElement | null = el.parentElement
    while (node) {
      const oy = getComputedStyle(node).overflowY
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node
      node = node.parentElement
    }
    return null
  }

  // The position whose on-screen spot should stay fixed: the caret when
  // focused, otherwise the text at the top of the viewport.
  function anchorPos(view: EditorView): number | null {
    if (view.hasFocus()) return view.state.selection.head
    const rect = view.dom.getBoundingClientRect()
    const top = Math.max(rect.top, 0) + 8
    if (top > rect.bottom) return null
    return view.posAtCoords({ left: rect.left + 16, top })?.pos ?? null
  }

  // Replace only the part of the document that actually changed, so the
  // selection maps through and nothing reflows above the caret. Then correct
  // any residual scroll drift around the anchor.
  function applyMarkdown(md: string) {
    if (!editor) return
    const { view } = editor
    const state = view.state
    let next
    try {
      next = createDocument(markdownToHtml(md), state.schema)
    } catch (e) {
      console.error('Failed to parse remote content', e)
      return
    }
    const start = state.doc.content.findDiffStart(next.content)
    if (start == null) return
    const end = state.doc.content.findDiffEnd(next.content)
    if (!end) return
    let { a: endA, b: endB } = end
    const overlap = start - Math.min(endA, endB)
    if (overlap > 0) {
      endA += overlap
      endB += overlap
    }

    const anchor = anchorPos(view)
    const before = anchor != null ? view.coordsAtPos(anchor).top : null

    const tr: Transaction = state.tr.replace(start, endA, next.slice(start, endB))
    tr.setMeta(REMOTE, true).setMeta('addToHistory', false)
    view.dispatch(tr)

    if (anchor != null && before != null) {
      const mapped = Math.min(tr.mapping.map(anchor), view.state.doc.content.size)
      const delta = view.coordsAtPos(mapped).top - before
      if (Math.abs(delta) > 1) {
        const sp = scrollParent(element)
        if (sp) sp.scrollTop += delta
        else window.scrollBy(0, delta)
      }
    }
  }

  onMount(() => {
    editor = new Editor({
      element,
      autofocus: autofocus ? 'end' : false,
      extensions: [
        StarterKit.configure({ link: false }),
        Placeholder.configure({ placeholder }),
        Markdown.configure({ transformPastedText: false, transformCopiedText: true }),
        Link.configure({
          openOnClick: true,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        }),
        // allowBase64 stays on so older notes with inline images still load.
        Image.configure({ inline: false, allowBase64: true }),
        Youtube.configure({ controls: true, nocookie: true, allowFullscreen: true }),
        CustomInputRules,
        SmartPaste,
      ],
      content: session.local().body,
      editorProps: {
        handleDOMEvents: {
          compositionend: () => {
            setTimeout(() => session.editorIdle(), 0)
            return false
          },
        },
      },
      onUpdate: ({ transaction }) => {
        if (transaction.getMeta(REMOTE)) return
        session.touch()
      },
      onBlur: () => {
        onBlur?.()
      },
    })
    bridge = {
      getBody: getMarkdown,
      setBody: applyMarkdown,
      canApply: () => !!editor && !editor.view.composing,
    }
    session.attach(bridge)
  })

  onDestroy(() => {
    if (bridge) session.detach(bridge)
    bridge = null
    editor?.destroy()
    editor = null
  })
</script>

<div bind:this={element} class="rich-editor"></div>

<style>
  .rich-editor {
    display: block;
    font-family: var(--font-content);
  }
  :global(.rich-editor .tiptap) {
    position: relative;
    min-height: 100px;
    padding-bottom: 20vh;
    border: none;
    box-shadow: none;
    font-size: 1rem;
    line-height: var(--lh);
    color: var(--text);
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    max-width: 70ch;
    caret-color: var(--accent);
  }
  :global(.rich-editor .tiptap:focus),
  :global(.rich-editor .tiptap.ProseMirror-focused) {
    outline: none;
    border: none;
    box-shadow: none;
  }
  :global(.rich-editor .tiptap ::selection) {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }
  :global(.rich-editor .tiptap a) {
    color: var(--accent) !important;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  :global(.rich-editor .tiptap > :first-child) { margin-top: 0; }
  :global(.rich-editor .tiptap p) { margin: 0.5rem 0; }
  :global(.rich-editor .tiptap img) {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: 12px;
    margin: 1.5rem auto;
  }
  :global(.rich-editor .tiptap img.ProseMirror-selectednode) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  :global(.rich-editor .tiptap iframe) {
    display: block;
    width: 100%;
    max-width: 800px;
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    border: none;
    margin: 1.5rem auto;
  }
  :global(.rich-editor .tiptap h1) { font-size: 2rem; font-weight: 800; margin: 1.5rem 0 0.8rem; line-height: 1.2; }
  :global(.rich-editor .tiptap h2) { font-size: 1.5rem; font-weight: 700; margin: 1.2rem 0 0.6rem; line-height: 1.3; }
  :global(.rich-editor .tiptap h3) { font-size: 1.2rem; font-weight: 600; margin: 1rem 0 0.5rem; line-height: 1.35; }
  :global(.rich-editor .tiptap ul),
  :global(.rich-editor .tiptap ol) { padding-left: 1.5rem; margin: 0.5rem 0; }
  :global(.rich-editor .tiptap li p) { margin: 0.2rem 0; }
  :global(.rich-editor .tiptap hr) {
    border: none;
    border-top: 1px solid var(--line);
    margin: 1.5rem 0;
  }
  :global(.rich-editor .tiptap blockquote) {
    border-left: 3px solid var(--accent);
    margin: 1rem 0;
    padding-left: 1rem;
    font-style: italic;
    color: var(--muted);
  }
  :global(.rich-editor .tiptap code) {
    background: var(--glass);
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.85em;
  }
  :global(.rich-editor .tiptap pre) {
    background: color-mix(in srgb, var(--text) 7%, var(--bg));
    border: 1px solid var(--line);
    padding: 1rem;
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    color: var(--text);
    overflow-x: auto;
    white-space: pre;
  }
  :global(.rich-editor .tiptap pre code) { background: none; padding: 0; color: inherit; }
  :global(.rich-editor .tiptap p.is-editor-empty:first-child::before) {
    color: var(--muted);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
    opacity: 0.4;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  :global(.rich-editor .tiptap.ProseMirror-focused p.is-editor-empty:first-child::before) {
    opacity: 0.25;
  }
</style>
