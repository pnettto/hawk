<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Editor, InputRule, Extension } from '@tiptap/core'
  import StarterKit from '@tiptap/starter-kit'
  import Placeholder from '@tiptap/extension-placeholder'
  import Link from '@tiptap/extension-link'
  import Image from '@tiptap/extension-image'
  import Youtube from '@tiptap/extension-youtube'
  import { Markdown } from 'tiptap-markdown'

  interface Props {
    value: string
    onChange?: (markdown: string) => void
    placeholder?: string
    autofocus?: boolean
  }
  let { value, onChange, placeholder = 'Write here...', autofocus = false }: Props = $props()

  let element: HTMLDivElement
  let editor: Editor | null = null

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

  function getMarkdown(): string {
    if (!editor) return ''
    // tiptap-markdown stores its serializer here; it isn't part of the typed editor surface.
    return (editor.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? ''
  }

  onMount(() => {
    editor = new Editor({
      element,
      autofocus: autofocus ? 'start' : false,
      extensions: [
        StarterKit,
        Placeholder.configure({ placeholder }),
        Markdown,
        Link.configure({
          openOnClick: true,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        }),
        Image.configure({ inline: false, allowBase64: true }),
        Youtube.configure({ controls: true, nocookie: true, allowFullscreen: true }),
        CustomInputRules,
      ],
      content: value,
      onUpdate: () => {
        onChange?.(getMarkdown())
      },
    })
  })

  // Mirror external value changes into the editor — but only when they truly
  // diverge from what the user is already seeing, to avoid reset-cursor flicker
  // and re-flow when round-trip serialization isn't byte-identical.
  $effect(() => {
    if (!editor) return
    const next = value || ''
    const cur = getMarkdown() || ''
    if (cur === next) return
    if (cur.replace(/\s+$/, '') === next.replace(/\s+$/, '')) return
    editor.commands.setContent(next)
  })

  onDestroy(() => {
    editor?.destroy()
    editor = null
  })
</script>

<div bind:this={element} class="rich-editor"></div>

<style>
  .rich-editor {
    display: block;
    font-family: var(--font-sans);
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
    max-width: 70ch;
  }
  :global(.rich-editor .tiptap:focus),
  :global(.rich-editor .tiptap.ProseMirror-focused) {
    outline: none;
    border: none;
    box-shadow: none;
  }
  :global(.rich-editor .tiptap a) {
    color: var(--accent) !important;
    text-decoration: underline;
    cursor: pointer;
  }
  :global(.rich-editor .tiptap p) { margin: 0.5rem 0; }
  :global(.rich-editor .tiptap img) {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: 12px;
    margin: 1.5rem auto;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }
  :global(.rich-editor .tiptap iframe) {
    display: block;
    width: 100%;
    max-width: 800px;
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    border: none;
    margin: 1.5rem auto;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }
  :global(.rich-editor .tiptap h1) { font-size: 2.5rem; font-weight: 800; margin: 1.5rem 0 0.8rem; line-height: 1.2; }
  :global(.rich-editor .tiptap h2) { font-size: 1.8rem; font-weight: 700; margin: 1.2rem 0 0.6rem; line-height: 1.3; }
  :global(.rich-editor .tiptap h3) { font-size: 1.4rem; font-weight: 600; margin: 1rem 0 0.5rem; }
  :global(.rich-editor .tiptap ul),
  :global(.rich-editor .tiptap ol) { padding-left: 1.5rem; margin: 0.5rem 0; }
  :global(.rich-editor .tiptap blockquote) {
    border-left: 3px solid var(--accent);
    margin: 1rem 0;
    padding-left: 1rem;
    font-style: italic;
    color: var(--muted);
  }
  :global(.rich-editor .tiptap code) {
    background: rgba(255, 255, 255, 0.1);
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.85em;
  }
  :global(.rich-editor .tiptap pre) {
    background: #0d1117;
    padding: 1rem;
    border-radius: 8px;
    font-family: var(--font-mono);
    color: #e6edf3;
    overflow-x: auto;
  }
  :global(.rich-editor .tiptap pre code) { background: none; padding: 0; color: inherit; }
  :global(.rich-editor .tiptap p.is-editor-empty:first-child::before) {
    color: var(--muted);
    content: attr(data-placeholder);
    position: absolute;
    pointer-events: none;
    opacity: 0.4;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  :global(.rich-editor .tiptap.ProseMirror-focused p.is-editor-empty:first-child::before) {
    opacity: 0.25;
  }
</style>
