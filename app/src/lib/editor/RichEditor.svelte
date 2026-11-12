<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { Editor, InputRule, Extension, createDocument } from '@tiptap/core'
  import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
  import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
  import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
  import Placeholder from '@tiptap/extension-placeholder'
  import type { DocSession, EditorBridge } from '../../sync/docSession'
  import { uploadFile, publicFileUrl } from '../../api/files'
  import { showError, showToast } from '../../stores/toast'
  import { confirm } from '../../stores/confirm'
  import { filesStore } from '../../stores/files'
  import { authStore } from '../../stores/auth'
  import type { AnchorRect } from '../utils/portal'
  import { bulletsToMarkdown, looksLikeMarkdown, normalizePastedHtml, splitSoftBreaks } from './paste'
  import { TAG_TYPING_RE } from '../notes/tags'
  import { contentExtensions } from './schema'
  import { REMOVE_ATTACHMENT, attachmentFileId } from './nodes'
  import { filterBlocks, isYoutubeUrl, normalizeUrl, slashQuery, type BlockId, type BlockItem } from './blocks'
  import InsertMenu from './InsertMenu.svelte'
  import MediaPrompt from './MediaPrompt.svelte'
  import MapPrompt from './MapPrompt.svelte'
  import FormatBar from './FormatBar.svelte'
  import { openMapPrompt } from './mapPrompt'

  interface Props {
    session: DocSession
    onBlur?: () => void
    placeholder?: string
    autofocus?: boolean
    // Existing tags, most used first — offered when typing "#".
    tags?: string[]
  }
  let { session, onBlur, placeholder = 'Write here…', autofocus = false, tags = [] }: Props = $props()

  let wrapper: HTMLDivElement
  let element: HTMLDivElement
  let gutterBtn = $state<HTMLButtonElement | null>(null)
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

  // ---- tags --------------------------------------------------------------
  // #words are tags (see lib/notes/tags.ts). They're plain text in the
  // document; this only paints them.

  const TAG_IN_TEXT = /(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_\-/]*)/gu

  function tagDecorations(doc: PMNode): DecorationSet {
    const decos: Decoration[] = []
    doc.descendants((node, pos) => {
      if (node.type.spec.code) return false
      if (!node.isText || node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return
      for (const m of node.text!.matchAll(TAG_IN_TEXT)) {
        if (!/\p{L}/u.test(m[2])) continue
        const from = pos + m.index! + m[1].length
        decos.push(Decoration.inline(from, from + 1 + m[2].length, { class: 'hawk-tag' }))
      }
    })
    return DecorationSet.create(doc, decos)
  }

  const TagHighlight = Extension.create({
    name: 'tagHighlight',
    addProseMirrorPlugins() {
      const key = new PluginKey<DecorationSet>('tagHighlight')
      return [
        new Plugin<DecorationSet>({
          key,
          state: {
            init: (_, { doc }) => tagDecorations(doc),
            apply: (tr, old) => (tr.docChanged ? tagDecorations(tr.doc) : old),
          },
          props: {
            decorations: (state) => key.getState(state),
          },
        }),
      ]
    },
  })

  function markdownToHtml(md: string): string {
    const parser = (editor?.storage as { markdown?: { parser?: { parse: (s: string) => string } } })
      ?.markdown?.parser
    return parser ? parser.parse(md) : md
  }

  // ---- block placement ---------------------------------------------------

  // Images, videos and tables are blocks: replace the paragraph at `at` if
  // it's empty, otherwise go right after it — never inside it. Keeps a
  // paragraph below a block that would otherwise end the document, so
  // there's always somewhere to keep typing. Returns the position just
  // after the inserted node.
  function placeBlock(view: EditorView, node: PMNode, at: number, opts: { caretAfter?: boolean } = {}): number {
    const { state } = view
    const rp = state.doc.resolve(Math.min(at, state.doc.content.size))
    let tr = state.tr
    let end: number
    if (rp.parent.isTextblock && rp.depth > 0) {
      if (rp.parent.content.size === 0) {
        tr = tr.replaceWith(rp.before(), rp.after(), node)
        end = tr.mapping.map(rp.before(), -1) + node.nodeSize
      } else {
        tr = tr.insert(rp.after(), node)
        end = tr.mapping.map(rp.after(), -1) + node.nodeSize
      }
    } else {
      tr = tr.insert(rp.pos, node)
      end = tr.mapping.map(rp.pos, -1) + node.nodeSize
    }
    if (end === tr.doc.content.size) tr = tr.insert(end, state.schema.nodes.paragraph.create())
    if (opts.caretAfter) tr = tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1)))
    view.dispatch(tr.scrollIntoView())
    return end
  }

  function ensureTrailingParagraph() {
    if (!editor) return
    const { state, view } = editor
    if (state.doc.lastChild?.isTextblock) return
    view.dispatch(state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create()))
  }

  // ---- uploads -----------------------------------------------------------

  const isImageFile = (f: File) => f.type.startsWith('image/')
  const isVideoFile = (f: File) => f.type.startsWith('video/')
  const fileList = (list: FileList | File[] | null | undefined) => Array.from(list ?? [])

  // Upload pasted/dropped/picked files to Files (under Note media) and insert
  // them where the user was: images and videos inline, anything else as an
  // attachment. Positions are mapped through edits made while uploading.
  async function insertUploads(view: EditorView, files: File[], at: number) {
    const tracker = { pos: at }
    const follow = ({ transaction }: { transaction: Transaction }) => {
      tracker.pos = transaction.mapping.map(tracker.pos)
    }
    editor?.on('transaction', follow)
    const noun = files.every(isImageFile) ? 'image' : files.every(isVideoFile) ? 'video' : 'file'
    const dismiss = showToast(files.length > 1 ? `Uploading ${files.length} ${noun}s…` : `Uploading ${noun}…`, {
      duration: 60_000,
    })
    try {
      for (const file of files) {
        const kind = isImageFile(file) ? 'image' : isVideoFile(file) ? 'video' : 'file'
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
        const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? (kind === 'video' ? 'mp4' : kind === 'image' ? 'png' : 'bin')
        const name = file.name && file.name !== 'image.png' ? file.name : `Pasted ${kind} ${stamp}.${ext}`
        const meta = await uploadFile(file, name, { inline: true })
        if (!editor || editor.isDestroyed) return
        const src = publicFileUrl(meta.id)
        const { nodes } = view.state.schema
        const node =
          kind === 'image'
            ? nodes.image.create({ src, alt: '' })
            : kind === 'video'
              ? nodes.video.create({ src })
              : nodes.attachment.create({ href: src, name: meta.name, size: meta.size })
        tracker.pos = placeBlock(view, node, tracker.pos)
      }
    } catch (e) {
      console.error('Upload failed', e)
      showError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      dismiss()
      editor?.off('transaction', follow)
    }
  }

  // ---- paste -----------------------------------------------------------

  // Paste rules, in order:
  // 1. Files → upload + insert (images/videos inline, others as attachments).
  // 2. Plain text that looks like markdown, unless the HTML beside it has
  //    real structure (VS Code & co., chat boxes and other ProseMirror
  //    editors holding literal **markdown**, "•" bullet text) → parse as
  //    markdown, then tidy like rich HTML (a lone bold line becomes a
  //    subheading).
  // 3. Copied from a ProseMirror editor (incl. this one) → default handling,
  //    which preserves the exact structure.
  // 4. Rich HTML (web pages, Docs, Word, Notes, mail) → rewritten into
  //    paragraphs, headings, lists and marks (see normalizePastedHtml).
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
              const files = fileList(data.files)
              if (files.length) {
                event.preventDefault()
                void insertUploads(view, files, view.state.selection.from)
                return true
              }
              const html = data.getData('text/html')
              const text = bulletsToMarkdown(data.getData('text/plain'))
              const inCode = view.state.selection.$from.parent.type.spec.code
              if (inCode) return false
              const fromCodeEditor = !!html && /vscode|monaco|<meta[^>]+charset/i.test(html) && !/<(p|h[1-6]|li|a)\b/i.test(html)
              // HTML that carries real structure. Without it (a code editor, a
              // textarea, a chat box holding literal **markdown**), the text
              // is the better source.
              const structured = !!html && /<(a|strong|b|em|i|h[1-6]|li|img|table|pre|code|blockquote)\b/i.test(html)
              if (text && looksLikeMarkdown(text) && (!html || fromCodeEditor || !structured)) {
                event.preventDefault()
                const rendered = normalizePastedHtml(markdownToHtml(splitSoftBreaks(text)))
                if (!view.pasteHTML(rendered)) editor?.commands.insertContent(rendered)
                return true
              }
              if (html && /data-pm-slice/.test(html)) return false
              if (html && !fromCodeEditor) {
                event.preventDefault()
                // pasteHTML fires a synthetic paste without clipboardData,
                // which the check at the top hands to the default handler.
                const clean = normalizePastedHtml(html)
                if (!view.pasteHTML(clean)) editor?.commands.insertContent(clean)
                return true
              }
              return false
            },
            handleDrop: (view, event) => {
              const files = fileList(event.dataTransfer?.files)
              if (!files.length) return false
              event.preventDefault()
              const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
              void insertUploads(view, files, hit?.pos ?? view.state.selection.from)
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
    const md = (editor.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? ''
    // Leading blank lines don't survive a reload anyway; dropping them keeps
    // the line padTagOnlyBody adds from counting as an edit.
    return md.replace(/^\n+/, '')
  }

  const TAG_LINE = /^\s*(#[^\s#]+\s*)+$/u

  // A body that's only tags (a new note made under a tag filter) opens with
  // an empty line above them to write in. Local-only: not an edit, not undoable.
  function padTagOnlyBody() {
    if (!editor) return
    const { state, view } = editor
    let tagsOnly = state.doc.childCount > 0
    state.doc.forEach((n) => {
      if (n.type.name !== 'paragraph' || !TAG_LINE.test(n.textContent)) tagsOnly = false
    })
    if (!tagsOnly) return
    const tr = state.tr.insert(0, state.schema.nodes.paragraph.create())
    view.dispatch(tr.setMeta(REMOTE, true).setMeta('addToHistory', false))
  }

  // ---- floating UI -------------------------------------------------------
  // The "+" beside an empty line and "/" typed into one both open the insert
  // menu; a text selection gets the format bar; a table gets its own tools.

  type MenuState = { mode: 'slash' | 'gutter'; pos: number; query: string; sel: number; anchor: AnchorRect }
  type Marks = { bold: boolean; italic: boolean; link: boolean; h3: boolean }

  let menu = $state<MenuState | null>(null)
  let menuItems = $derived(menu ? filterBlocks(menu.query) : [])
  // "#" typed: existing tags to complete. `from` is the "#" position.
  let tagMenu = $state<{ from: number; query: string; sel: number; anchor: AnchorRect } | null>(null)
  let tagItems = $derived.by(() => {
    if (!tagMenu) return []
    const q = tagMenu.query.toLowerCase()
    const starts = tags.filter((t) => t.startsWith(q))
    const contains = q ? tags.filter((t) => !t.startsWith(q) && t.includes(q)) : []
    return [...starts, ...contains].slice(0, 8).map((t) => ({ id: t, label: `#${t}` }))
  })
  // "#" position whose menu was dismissed with Esc.
  let tagDismissed = -1
  let media = $state<{ kind: 'image' | 'video'; pos: number; anchor: AnchorRect } | null>(null)
  // `inline`: no room in the left margin, so it sits at the end of the line.
  let gutter = $state<{ top: number; pos: number; inline: boolean; right: number } | null>(null)
  // Margin the "+" needs left of the text: its 26px plus breathing room.
  const GUTTER_ROOM = 48
  let fmt = $state<{ anchor: AnchorRect; active: Marks } | null>(null)
  // Non-null while the format bar's link field is open.
  let linkHref = $state<string | null>(null)
  let tableBar = $state<{ top: number; right: number } | null>(null)
  // "pos:text" of a "/" line whose menu was dismissed with Esc, so it stays
  // closed until the line changes.
  let slashDismissed = ''
  const narrow = window.matchMedia?.('(max-width: 760px)')

  const rectOf = (el: Element): AnchorRect => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
  }

  function blockDom(pos: number): HTMLElement | null {
    const dom = editor?.view.nodeDOM(pos)
    return dom instanceof HTMLElement ? dom : null
  }

  function depthOf(rp: ResolvedPos, type: string): number {
    for (let d = rp.depth; d > 0; d--) if (rp.node(d).type.name === type) return d
    return -1
  }

  function selectionRect(): AnchorRect {
    const { view, state } = editor!
    const a = view.coordsAtPos(state.selection.from)
    const b = view.coordsAtPos(state.selection.to)
    const box = view.dom.getBoundingClientRect()
    const oneLine = Math.abs(a.top - b.top) < 4
    return {
      top: Math.min(a.top, b.top),
      bottom: Math.max(a.bottom, b.bottom),
      left: oneLine ? a.left : box.left,
      right: oneLine ? b.right : box.left + Math.min(box.width, 600),
    }
  }

  function activeMarks(): Marks {
    const e = editor!
    return {
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      link: e.isActive('link'),
      h3: e.isActive('heading', { level: 3 }),
    }
  }

  function refresh() {
    if (!editor || editor.isDestroyed) return
    const { view, state } = editor
    const sel = state.selection
    const at = sel.$from
    const focused = view.hasFocus()
    // The top-level paragraph holding the caret, if that's where it is.
    const para = sel.empty && at.depth === 1 && at.parent.type.name === 'paragraph' ? at.before() : null
    const paraNode = para !== null ? at.parent : null

    // "/" menu
    const text = paraNode?.textContent ?? ''
    const query = paraNode && at.parentOffset === paraNode.content.size ? slashQuery(text) : null
    const dom = para !== null ? blockDom(para) : null
    if (query === null) slashDismissed = ''
    if (query !== null && focused && dom && `${para}:${text}` !== slashDismissed) {
      const keep = menu?.mode === 'slash' && menu.pos === para ? menu.sel : 0
      menu = { mode: 'slash', pos: para!, query, sel: Math.min(keep, Math.max(0, filterBlocks(query).length - 1)), anchor: rectOf(dom) }
    } else if (menu?.mode === 'slash') {
      menu = null
    }
    // A menu opened from "+" closes once its line is left or typed into.
    if (menu?.mode === 'gutter' && (para !== menu.pos || paraNode!.content.size > 0)) menu = null

    // "#" tag completion
    const before = sel.empty && focused && !at.parent.type.spec.code && !at.marks().some((m) => m.type.name === 'code')
      ? TAG_TYPING_RE.exec(at.parent.textBetween(Math.max(0, at.parentOffset - 60), at.parentOffset, undefined, '\ufffc'))
      : null
    if (before) {
      const from = at.pos - before[1].length - 1
      if (from !== tagDismissed) {
        const c = view.coordsAtPos(from)
        const keep = tagMenu?.from === from ? tagMenu.sel : 0
        tagMenu = { from, query: before[1], sel: keep, anchor: { top: c.top, bottom: c.bottom, left: c.left, right: c.right } }
      } else {
        tagMenu = null
      }
    } else {
      tagMenu = null
      tagDismissed = -1
    }

    // "+" beside an empty line
    if (focused && dom && paraNode && paraNode.content.size === 0) {
      const top = dom.getBoundingClientRect().top - wrapper.getBoundingClientRect().top + (dom.offsetHeight - 26) / 2
      const wr = wrapper.getBoundingClientRect()
      const inline = !!narrow?.matches || wr.left < GUTTER_ROOM
      gutter = { top, pos: para!, inline, right: wr.right - dom.getBoundingClientRect().right }
    } else if (menu?.mode !== 'gutter') {
      gutter = null
    }

    // Format bar (left alone while its link field has focus)
    if (linkHref === null) {
      const show =
        focused &&
        sel instanceof TextSelection &&
        !sel.empty &&
        !at.parent.type.spec.code &&
        state.doc.textBetween(sel.from, sel.to, ' ').trim() !== ''
      fmt = show ? { anchor: selectionRect(), active: activeMarks() } : null
    }

    // Table tools
    const td = depthOf(at, 'table')
    const table = td > 0 && focused ? blockDom(at.before(td)) : null
    if (table) {
      const wr = wrapper.getBoundingClientRect()
      const r = table.getBoundingClientRect()
      tableBar = { top: r.top - wr.top, right: r.right - wr.left }
    } else {
      tableBar = null
    }
  }

  function onTransaction({ transaction }: { transaction: Transaction }) {
    if (transaction.docChanged) {
      if (media) media.pos = transaction.mapping.map(media.pos)
      if (attachPos !== null) attachPos = transaction.mapping.map(attachPos)
      if (mapPos !== null) mapPos = transaction.mapping.map(mapPos)
      if (menu?.mode === 'gutter') menu.pos = transaction.mapping.map(menu.pos)
    }
    // Focus changes can fire while Svelte is mid-render (an editor that had
    // focus being torn down by a {#key}), where state writes are forbidden.
    if (transaction.getMeta('focus') || transaction.getMeta('blur')) queueMicrotask(refresh)
    else refresh()
  }

  // Keep fixed-position popovers attached to their spot while scrolling.
  function onScroll() {
    if (!editor || editor.isDestroyed) return
    if (menu) {
      const dom = menu.mode === 'gutter' ? gutterBtn : blockDom(menu.pos)
      if (dom) menu.anchor = rectOf(dom)
    }
    if (media) {
      const dom = blockDom(media.pos)
      if (dom) media.anchor = rectOf(dom)
    }
    if (fmt) fmt.anchor = selectionRect()
  }

  function onDocMouseDown(e: MouseEvent) {
    const inside = (sel: string) => e.composedPath().some((n) => n instanceof Element && n.matches(sel))
    if (menu && !inside('.insert-menu, .gutter-add')) menu = null
    if (tagMenu && !inside('.insert-menu')) {
      tagDismissed = tagMenu.from
      tagMenu = null
    }
    if (linkHref !== null && !inside('.fmtbar')) {
      linkHref = null
      fmt = null
    }
  }

  // ---- insert menu -------------------------------------------------------

  function closeMenu(dismiss = false) {
    if (dismiss && menu?.mode === 'slash' && editor) {
      slashDismissed = `${menu.pos}:${editor.state.doc.nodeAt(menu.pos)?.textContent ?? ''}`
    }
    menu = null
  }

  function onGutterClick() {
    if (!gutter || !gutterBtn) return
    if (menu) {
      menu = null
      return
    }
    menu = { mode: 'gutter', pos: gutter.pos, query: '', sel: 0, anchor: rectOf(gutterBtn) }
  }

  function pickTag(tag: string) {
    const m = tagMenu
    tagMenu = null
    if (!m || !editor) return
    const { view } = editor
    const to = view.state.selection.from
    view.dispatch(view.state.tr.insertText(`#${tag} `, m.from, to).scrollIntoView())
    view.focus()
  }

  // Put the caret at the start of the body, from the title. A note that
  // opens with its tag line (new notes in a tag view) gets an empty line
  // above it to write in.
  export function focusBody() {
    if (!editor) return
    const { state, view } = editor
    const first = state.doc.firstChild
    const tagLine = first?.type.name === 'paragraph' && TAG_LINE.test(first.textContent)
    if (tagLine) {
      const tr = state.tr.insert(0, state.schema.nodes.paragraph.create())
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 1)))
    } else {
      view.dispatch(state.tr.setSelection(TextSelection.atStart(state.doc)))
    }
    view.focus()
  }

  function pick(item: BlockItem) {
    const m = menu
    menu = null
    if (!m || !editor) return
    const node = editor.state.doc.nodeAt(m.pos)
    if (!node || node.type.name !== 'paragraph') return
    const chain = editor.chain().focus()
    if (m.mode === 'slash') chain.deleteRange({ from: m.pos + 1, to: m.pos + 1 + node.content.size })
    chain.setTextSelection(m.pos + 1).run()
    applyBlock(item.id, m.pos)
  }

  function applyBlock(id: BlockId, pos: number) {
    if (!editor) return
    const chain = editor.chain().focus()
    switch (id) {
      case 'h3':
        chain.setHeading({ level: 3 }).run()
        break
      case 'p':
        chain.setParagraph().run()
        break
      case 'lead':
        chain.setNode('lead').run()
        break
      case 'ul':
        chain.toggleBulletList().run()
        break
      case 'ol':
        chain.toggleOrderedList().run()
        break
      case 'todo':
        chain.toggleTaskList().run()
        break
      case 'table':
        chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        ensureTrailingParagraph()
        break
      case 'image':
      case 'video': {
        const dom = blockDom(pos)
        if (dom) media = { kind: id, pos, anchor: rectOf(dom) }
        break
      }
      case 'map':
        mapPos = pos
        openMapPrompt({
          title: 'Add a map',
          submitLabel: 'Insert map',
          source: '',
          onSave: (source) => {
            if (!editor) return
            const at = mapPos ?? pos
            mapPos = null
            editor.commands.focus()
            placeBlock(editor.view, editor.state.schema.nodes.mapBlock.create({ source }), at + 1, {
              caretAfter: true,
            })
          },
          onCancel: () => (mapPos = null),
        })
        break
      case 'file':
        attachPos = pos
        attachInput?.click()
        break
    }
  }

  // Position of the line the map prompt was opened from; mapped through edits
  // made while it's open.
  let mapPos: number | null = null

  // ---- attach file -------------------------------------------------------

  let attachInput = $state<HTMLInputElement | null>(null)
  // Block the picker was opened from; mapped through edits like `media.pos`.
  let attachPos: number | null = null

  function onAttachPicked() {
    const files = fileList(attachInput?.files)
    const pos = attachPos
    attachPos = null
    if (attachInput) attachInput.value = ''
    if (!files.length || pos === null || !editor) return
    editor.commands.focus()
    void insertUploads(editor.view, files, pos + 1)
  }

  // ---- image / video prompt ----------------------------------------------

  function onMediaUrl(raw: string) {
    const m = media
    media = null
    if (!m || !editor) return
    const src = normalizeUrl(raw)
    const { nodes } = editor.state.schema
    const node =
      m.kind === 'image'
        ? nodes.image.create({ src, alt: '' })
        : isYoutubeUrl(src)
          ? nodes.youtube.create({ src })
          : nodes.video.create({ src })
    editor.commands.focus()
    placeBlock(editor.view, node, m.pos + 1, { caretAfter: true })
  }

  function onMediaFiles(files: File[]) {
    const m = media
    media = null
    if (!m || !editor) return
    const wanted = files.filter((f) => f.type.startsWith(`${m.kind}/`))
    if (!wanted.length) {
      showError(m.kind === 'image' ? 'That file isn’t an image.' : 'That file isn’t a video.')
      return
    }
    editor.commands.focus()
    void insertUploads(editor.view, wanted, m.pos + 1)
  }

  function onMediaCancel() {
    media = null
    editor?.commands.focus()
  }

  // ---- format bar --------------------------------------------------------

  function openLink() {
    if (!editor) return
    if (editor.state.selection.empty) {
      if (!editor.isActive('link')) {
        showToast('Select some text first, then add a link.')
        return
      }
      editor.chain().extendMarkRange('link').run()
    }
    fmt = { anchor: selectionRect(), active: activeMarks() }
    linkHref = (editor.getAttributes('link').href as string | undefined) ?? ''
  }

  function applyLink(raw: string) {
    linkHref = null
    if (!editor) return
    const href = normalizeUrl(raw)
    const chain = editor.chain().focus().extendMarkRange('link')
    if (href) chain.setLink({ href }).run()
    else chain.unsetLink().run()
  }

  function removeLink() {
    linkHref = null
    editor?.chain().focus().extendMarkRange('link').unsetLink().run()
  }

  function cancelLink() {
    linkHref = null
    editor?.commands.focus()
  }

  // ---- tables ------------------------------------------------------------

  type TableAct = 'row+' | 'row-' | 'col+' | 'col-' | 'del'

  function tableAction(act: TableAct) {
    if (!editor) return
    const at = editor.state.selection.$from
    const d = depthOf(at, 'table')
    if (d < 0) return
    const table = at.node(d)
    const chain = editor.chain().focus()
    if (act === 'row+') chain.addRowAfter().run()
    else if (act === 'col+') chain.addColumnAfter().run()
    else if (act === 'row-') {
      const hasHeader = table.firstChild?.firstChild?.type.name === 'tableHeader'
      if (table.childCount - (hasHeader ? 1 : 0) <= 1) {
        showToast('A table needs at least one row.')
        return
      }
      if (hasHeader && at.index(d) === 0) {
        // Caret is in the header row: drop the last row instead.
        let pos = at.before(d) + 1
        for (let r = 0; r < table.childCount - 1; r++) pos += table.child(r).nodeSize
        chain.setTextSelection(pos + 3)
      }
      chain.deleteRow().run()
    } else if (act === 'col-') {
      if ((table.firstChild?.childCount ?? 0) <= 1) {
        showToast('A table needs at least one column.')
        return
      }
      chain.deleteColumn().run()
    } else {
      chain.deleteTable().run()
      showToast('Table deleted', { action: 'Undo', onAction: () => editor?.chain().focus().undo().run() })
    }
  }

  // Enter in a cell moves to the cell below (adding a row at the bottom), so
  // cells stay single-paragraph and the table keeps saving as plain markdown.
  // Shift+Enter still breaks the line.
  function tableEnter(): boolean {
    if (!editor) return false
    const at = editor.state.selection.$from
    const d = depthOf(at, 'table')
    if (d < 0) return false
    const row = at.index(d)
    const col = at.index(d + 1)
    if (row + 1 >= at.node(d).childCount) editor.commands.addRowAfter()
    const { state } = editor
    const tablePos = state.selection.$from.before(d)
    const table = state.doc.nodeAt(tablePos)!
    let pos = tablePos + 1
    for (let r = 0; r <= row; r++) pos += table.child(r).nodeSize
    const next = table.child(row + 1)
    pos += 1
    for (let c = 0; c < Math.min(col, next.childCount - 1); c++) pos += next.child(c).nodeSize
    const cell = next.child(Math.min(col, next.childCount - 1))
    editor.commands.setTextSelection(pos + cell.nodeSize - 2)
    return true
  }

  // ---- keyboard / mouse --------------------------------------------------

  // ---- removed attachments --------------------------------------------------
  // Taking an attachment out of a note (its ✕, or Backspace/Delete) asks
  // whether to delete the stored file too. Cut, drag and remote edits don't.

  let deleteKeyDown = false

  function attachedFiles(doc: PMNode): Map<string, string> {
    const out = new Map<string, string>()
    doc.descendants((n) => {
      if (n.type.name !== 'attachment') return
      const id = attachmentFileId(n.attrs.href)
      if (id) out.set(id, n.attrs.name)
    })
    return out
  }

  async function offerFileDelete(tr: Transaction) {
    if (get(authStore).isGuest) return
    const after = attachedFiles(tr.doc)
    const gone = [...attachedFiles(tr.before)].filter(([id]) => !after.has(id))
    if (!gone.length) return
    const one = gone.length === 1
    const ok = await confirm({
      title: one ? `Also delete “${gone[0][1]}” from Files?` : `Also delete these ${gone.length} files from Files?`,
      message: 'This can’t be undone.',
      confirmLabel: one ? 'Delete file' : 'Delete files',
      cancelLabel: 'Keep in Files',
      danger: true,
      focusCancel: true,
    })
    if (ok) await filesStore.purge(gone.map(([id]) => id))
  }

  function handleKeyDown(_view: EditorView, e: KeyboardEvent): boolean {
    if (e.isComposing) return false
    if (e.key === 'Backspace' || e.key === 'Delete') {
      // Read by onUpdate for the transaction this key produces, synchronously.
      deleteKeyDown = true
      queueMicrotask(() => (deleteKeyDown = false))
    }
    if (tagMenu && tagItems.length) {
      const n = tagItems.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        tagMenu.sel = (tagMenu.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        pickTag(tagItems[Math.min(tagMenu.sel, n - 1)].id)
        return true
      }
      if (e.key === 'Escape') {
        tagDismissed = tagMenu.from
        tagMenu = null
        return true
      }
    }
    if (menu) {
      const n = menuItems.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (n) menu.sel = (menu.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (!n) {
          closeMenu(true)
          return false
        }
        pick(menuItems[menu.sel])
        return true
      }
      if (e.key === 'Escape') {
        closeMenu(true)
        return true
      }
    }
    const mod = e.metaKey || e.ctrlKey
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      openLink()
      return true
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey) return tableEnter()
    return false
  }

  // A click below a trailing image/table/video starts a new paragraph there.
  function handleMouseDown(view: EditorView, e: MouseEvent): boolean {
    const { state } = view
    const last = state.doc.lastChild
    if (!last || last.isTextblock || e.button !== 0) return false
    const end = state.doc.content.size
    const dom = blockDom(end - last.nodeSize)
    if (!dom || e.clientY <= dom.getBoundingClientRect().bottom) return false
    e.preventDefault()
    const tr = state.tr.insert(end, state.schema.nodes.paragraph.create())
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)))
    view.focus()
    return true
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
        ...contentExtensions(),
        Placeholder.configure({
          // The empty-document text always shows; per-line hints only on the
          // focused line (see the CSS).
          placeholder: ({ editor: e, node }) => {
            if (node.type.name === 'heading') return 'Subheading'
            if (node.type.name === 'lead') return 'Lead paragraph'
            if (e.isEmpty) return placeholder
            // Shorter on phones, where the "+" sits at the end of the line.
            return narrow?.matches ? 'Type / for blocks' : 'Type / for blocks, or just write'
          },
        }),
        CustomInputRules,
        SmartPaste,
        TagHighlight,
      ],
      content: session.local().body,
      editorProps: {
        handleKeyDown,
        handleDOMEvents: {
          mousedown: handleMouseDown,
          compositionend: () => {
            setTimeout(() => session.editorIdle(), 0)
            return false
          },
        },
      },
      onUpdate: ({ transaction }) => {
        if (transaction.getMeta(REMOTE)) return
        session.touch()
        if (transaction.getMeta(REMOVE_ATTACHMENT) || deleteKeyDown) void offerFileDelete(transaction)
      },
      onTransaction,
      onFocus: () => queueMicrotask(refresh),
      onBlur: () => {
        queueMicrotask(refresh)
        onBlur?.()
      },
    })
    bridge = {
      getBody: getMarkdown,
      setBody: applyMarkdown,
      canApply: () => !!editor && !editor.view.composing,
    }
    session.attach(bridge)
    padTagOnlyBody()

    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    document.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('resize', refresh)
  })

  onDestroy(() => {
    document.removeEventListener('scroll', onScroll, { capture: true })
    document.removeEventListener('mousedown', onDocMouseDown)
    window.removeEventListener('resize', refresh)
    if (bridge) session.detach(bridge)
    bridge = null
    editor?.destroy()
    editor = null
  })
</script>

<div class="rich-editor" bind:this={wrapper}>
  <div bind:this={element}></div>

  {#if gutter}
    <button
      type="button"
      class="gutter-add"
      class:open={menu?.mode === 'gutter'}
      class:inline={gutter.inline}
      bind:this={gutterBtn}
      style:top="{gutter.top}px"
      style:right={gutter.inline ? `${gutter.right}px` : null}
      aria-label="Insert block"
      aria-haspopup="listbox"
      aria-expanded={menu?.mode === 'gutter'}
      title="Insert block"
      onmousedown={(e) => e.preventDefault()}
      onclick={onGutterClick}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
    </button>
  {/if}

  {#if tableBar}
    <div
      class="table-tools"
      role="toolbar"
      aria-label="Table"
      tabindex="-1"
      style:top="{tableBar.top}px"
      style:left="{tableBar.right}px"
      onmousedown={(e) => e.preventDefault()}
    >
      <button type="button" onclick={() => tableAction('row+')}>+ Row</button>
      <button type="button" onclick={() => tableAction('row-')}>− Row</button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" onclick={() => tableAction('col+')}>+ Column</button>
      <button type="button" onclick={() => tableAction('col-')}>− Column</button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" class="danger" onclick={() => tableAction('del')}>Delete</button>
    </div>
  {/if}
</div>

{#if menu}
  <InsertMenu
    items={menuItems}
    selected={menu.sel}
    anchor={menu.anchor}
    empty="No block matches “{menu.query}”. Press Esc to keep typing."
    onPick={(i) => pick(menuItems[i])}
    onHover={(i) => menu && (menu.sel = i)}
  />
{:else if tagMenu && tagItems.length}
  <InsertMenu
    items={tagItems}
    selected={Math.min(tagMenu.sel, tagItems.length - 1)}
    anchor={tagMenu.anchor}
    label="Tags"
    compact
    onPick={(i) => pickTag(tagItems[i].id)}
    onHover={(i) => tagMenu && (tagMenu.sel = i)}
  />
{/if}

<input bind:this={attachInput} type="file" hidden multiple onchange={onAttachPicked} />

{#if media}
  <MediaPrompt kind={media.kind} anchor={media.anchor} onUrl={onMediaUrl} onFiles={onMediaFiles} onCancel={onMediaCancel} />
{/if}

<MapPrompt />

{#if fmt}
  <FormatBar
    anchor={fmt.anchor}
    active={fmt.active}
    {linkHref}
    onBold={() => editor?.chain().focus().toggleBold().run()}
    onItalic={() => editor?.chain().focus().toggleItalic().run()}
    onHeading={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
    onLink={openLink}
    onLinkApply={applyLink}
    onLinkRemove={removeLink}
    onLinkCancel={cancelLink}
  />
{/if}

<style>
  .rich-editor {
    position: relative;
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
  :global(.rich-editor .tiptap p.lead) { font-size: 1.2rem; line-height: 1.55; margin: 0.6rem 0 0.9rem; }
  :global(.rich-editor .tiptap img) {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: 12px;
    margin: 1.5rem auto;
  }
  :global(.rich-editor .tiptap img.ProseMirror-selectednode),
  :global(.rich-editor .tiptap video.ProseMirror-selectednode),
  :global(.rich-editor .tiptap div[data-youtube-video].ProseMirror-selectednode iframe) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  :global(.rich-editor .tiptap iframe),
  :global(.rich-editor .tiptap video) {
    display: block;
    width: 100%;
    max-width: 800px;
    border-radius: 12px;
    border: none;
    margin: 1.5rem auto;
    background: #000;
  }
  :global(.rich-editor .tiptap iframe) { aspect-ratio: 16 / 9; }

  /* Maps: Leaflet inside a fenced ```map block. */
  :global(.rich-editor .tiptap .note-map) {
    position: relative;
    margin: 1.5rem 0;
    font-family: var(--font-ui);
  }
  :global(.rich-editor .tiptap .note-map-title) {
    min-height: 1.6rem;
    margin-bottom: 0.45rem;
    padding-right: 11rem;
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.6;
  }
  :global(.rich-editor .tiptap .note-map-canvas) {
    height: clamp(240px, 45vh, 420px);
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--glass);
    isolation: isolate;
  }
  :global(.rich-editor .tiptap .note-map.ProseMirror-selectednode .note-map-canvas) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  :global(.rich-editor .tiptap .note-map-actions) {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 1001;
    display: flex;
    gap: 6px;
  }
  :global(.rich-editor .tiptap .note-map-button) {
    height: 26px;
    padding: 0 9px;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--panel);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 0.75rem;
    cursor: pointer;
    box-shadow: var(--shadow-pop);
  }
  :global(.rich-editor .tiptap .note-map-button:hover),
  :global(.rich-editor .tiptap .note-map-button:focus-visible) { border-color: var(--accent); }
  :global(.rich-editor .tiptap .note-map-empty) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    min-height: 140px;
    padding: 1rem;
    border: 1px dashed var(--line);
    border-radius: 12px;
    background: var(--glass);
  }
  :global(.rich-editor .tiptap .note-map-empty p) { margin: 0; color: var(--muted); font-size: 0.85rem; }
  :global(.rich-editor .tiptap .note-map-empty .note-map-button) { box-shadow: none; }
  /* Full screen: the map fills the viewport, Escape or the button leaves. */
  :global(.rich-editor .tiptap .note-map.is-fullscreen) {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0.75rem;
    background: var(--bg);
  }
  :global(.rich-editor .tiptap .note-map.is-fullscreen .note-map-canvas) {
    flex: 1;
    height: auto;
  }
  :global(body.note-map-fullscreen) { overflow: hidden; }
  :global(.rich-editor .tiptap .note-map-error) {
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--line));
    border-radius: var(--r-sm);
    background: var(--danger-bg);
    color: var(--danger);
    font-family: var(--font-ui);
    font-size: 0.85rem;
    line-height: 1.45;
  }
  :global(.rich-editor .tiptap .note-map-marker) { color: var(--accent); filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.35)); }
  :global(.rich-editor .tiptap .note-map-marker-dot) { fill: var(--panel); }
  :global(.note-map .leaflet-popup-content-wrapper),
  :global(.note-map .leaflet-popup-tip) {
    background: var(--panel);
    color: var(--text);
  }
  :global(.note-map .leaflet-popup-content) { margin: 10px 12px; font-family: var(--font-ui); font-size: 0.82rem; line-height: 1.4; }
  :global(.note-map-popup-name) { display: block; margin-bottom: 3px; font-size: 0.9rem; }
  :global(.note-map-popup-address) { margin: 0 0 4px; color: var(--muted); }
  :global(.note-map-popup-link) { display: block; margin-top: 4px; color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  :global(.note-map .leaflet-control-attribution) { font-family: var(--font-ui); font-size: 10px; }
  :global(.rich-editor .tiptap .attachment) { display: flex; align-items: center; gap: 4px; margin: 0.75rem 0; }
  :global(.rich-editor .tiptap .attachment-remove) {
    flex: none;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }
  :global(.rich-editor .tiptap .attachment-remove svg) { width: 13px; height: 13px; }
  :global(.rich-editor .tiptap .attachment:hover .attachment-remove),
  :global(.rich-editor .tiptap .attachment.ProseMirror-selectednode .attachment-remove),
  :global(.rich-editor .tiptap .attachment-remove:focus-visible) { opacity: 1; }
  :global(.rich-editor .tiptap .attachment-remove:hover) { color: var(--danger); background: var(--danger-bg); }
  @media (hover: none) {
    :global(.rich-editor .tiptap .attachment-remove) { opacity: 1; }
  }
  :global(.rich-editor .tiptap .attachment a) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--glass);
    color: var(--text) !important;
    font-family: var(--font-ui);
    font-size: 0.875rem;
    text-decoration: none;
  }
  :global(.rich-editor .tiptap .attachment a:hover) { border-color: var(--accent); }
  :global(.rich-editor .tiptap .attachment.ProseMirror-selectednode a) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  :global(.rich-editor .tiptap .attachment-icon) {
    flex: none;
    width: 16px;
    height: 16px;
    background: var(--accent);
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M13.5 7.5l-5.6 5.6a3.4 3.4 0 01-4.8-4.8l5.9-5.9a2.2 2.2 0 013.2 3.2l-5.9 5.9a1.1 1.1 0 01-1.6-1.6l5.4-5.4' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M13.5 7.5l-5.6 5.6a3.4 3.4 0 01-4.8-4.8l5.9-5.9a2.2 2.2 0 013.2 3.2l-5.9 5.9a1.1 1.1 0 01-1.6-1.6l5.4-5.4' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
  }
  :global(.rich-editor .tiptap .attachment-name) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  :global(.rich-editor .tiptap .attachment-size) { flex: none; color: var(--muted); font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  :global(.rich-editor .tiptap video) { max-height: 70vh; }
  :global(.rich-editor .tiptap h1) { font-size: 2rem; font-weight: 800; margin: 1.5rem 0 0.8rem; line-height: 1.2; }
  :global(.rich-editor .tiptap h2) { font-size: 1.5rem; font-weight: 700; margin: 1.2rem 0 0.6rem; line-height: 1.3; }
  :global(.rich-editor .tiptap h3) { font-size: 1.2rem; font-weight: 600; margin: 1rem 0 0.5rem; line-height: 1.35; }
  :global(.rich-editor .tiptap ul),
  :global(.rich-editor .tiptap ol) { padding-left: 1.5rem; margin: 0.5rem 0; }
  :global(.rich-editor .tiptap li p) { margin: 0.2rem 0; }

  /* Checklists — same check as Journal tasks. */
  :global(.rich-editor .tiptap ul[data-type='taskList']) { list-style: none; padding-left: 0; }
  :global(.rich-editor .tiptap ul[data-type='taskList'] ul[data-type='taskList']) { padding-left: 1.6rem; margin: 0; }
  :global(.rich-editor .tiptap ul[data-type='taskList'] > li) { display: flex; align-items: flex-start; gap: 0.35rem; }
  :global(.rich-editor .tiptap ul[data-type='taskList'] > li > label) {
    position: relative;
    flex-shrink: 0;
    width: 1.5rem;
    height: calc(var(--lh) * 1em);
    margin-top: 0.2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    user-select: none;
  }
  :global(.rich-editor .tiptap ul[data-type='taskList'] > li > label input) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  :global(.rich-editor .tiptap ul[data-type='taskList'] > li > label span) {
    position: relative;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--muted) 55%, transparent);
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  :global(.rich-editor .tiptap ul[data-type='taskList'] > li > label span::after) {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--on-accent);
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 80% no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 80% no-repeat;
    opacity: 0;
    transform: scale(0.6);
    transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-base) var(--ease-bounce);
  }
  :global(.rich-editor .tiptap ul[data-type='taskList'] > li > label:hover span) { border-color: var(--accent); }
  :global(.rich-editor .tiptap ul[data-type='taskList'] > li > label input:focus-visible + span) { outline: 2px solid var(--accent); outline-offset: 2px; }
  :global(.rich-editor .tiptap ul[data-type='taskList'] > li[data-checked='true'] > label span) { background: var(--accent); border-color: var(--accent); }
  :global(.rich-editor .tiptap ul[data-type='taskList'] > li[data-checked='true'] > label span::after) { opacity: 1; transform: none; }
  :global(.rich-editor .tiptap ul[data-type='taskList'] > li > div) { flex: 1; min-width: 0; }
  :global(.rich-editor .tiptap ul[data-type='taskList'] > li[data-checked='true'] > div > p) {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--muted) 60%, transparent);
  }

  :global(.rich-editor .tiptap .hawk-tag) {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-radius: 4px;
    padding: 0 0.15em;
    margin: 0 -0.15em;
  }
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
  :global(.rich-editor .tiptap table) {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    margin: 1.25rem 0;
    font-size: 0.92rem;
  }
  :global(.rich-editor .tiptap th),
  :global(.rich-editor .tiptap td) {
    position: relative;
    border: 1px solid var(--line);
    padding: 0.4rem 0.6rem;
    vertical-align: top;
    text-align: left;
  }
  :global(.rich-editor .tiptap th) { background: var(--glass-dark); font-weight: 600; }
  :global(.rich-editor .tiptap th p),
  :global(.rich-editor .tiptap td p) { margin: 0; }
  :global(.rich-editor .tiptap .selectedCell::after) {
    content: '';
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    pointer-events: none;
  }

  /* Placeholders: the empty-document text, and a hint on the focused empty line. */
  :global(.rich-editor .tiptap .is-editor-empty:first-child::before),
  :global(.rich-editor .tiptap.ProseMirror-focused .is-empty::before) {
    color: var(--muted);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
    opacity: 0.4;
    font-style: normal;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  :global(.rich-editor .tiptap.ProseMirror-focused .is-empty::before) { opacity: 0.3; }
  :global(.rich-editor .tiptap.ProseMirror-focused .is-editor-empty:first-child::before) { opacity: 0.25; }

  .gutter-add {
    position: absolute;
    left: -38px;
    z-index: 2;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 50%;
    background: var(--glass-dark);
    color: var(--muted);
    cursor: pointer;
    animation: fadeIn var(--dur-fast) var(--ease-out);
    transition:
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }
  .gutter-add svg { width: 14px; height: 14px; }
  .gutter-add:hover,
  .gutter-add.open { color: var(--accent); border-color: var(--accent); }
  .gutter-add.open { transform: rotate(45deg); }
  /* No room in the margin: sit at the end of the empty line instead. */
  .gutter-add.inline { left: auto; }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .table-tools {
    position: absolute;
    z-index: 3;
    transform: translate(-100%, calc(-100% - 6px));
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-pop);
    font-family: var(--font-ui);
    white-space: nowrap;
    animation: fadeIn var(--dur-fast) var(--ease-out);
  }
  .table-tools button {
    height: 26px;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
  }
  .table-tools button:hover { background: var(--glass-dark); }
  .table-tools button.danger { color: var(--danger); }
  .table-tools button.danger:hover { background: var(--danger-bg); }
  .table-tools .sep { width: 1px; align-self: stretch; margin: 3px 2px; background: var(--line); }
  @media (max-width: 760px) {
    .table-tools { left: 0 !important; transform: translateY(calc(-100% - 6px)); max-width: 100%; overflow-x: auto; }
  }
</style>
