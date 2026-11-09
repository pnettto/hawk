<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Editor, InputRule, Extension, createDocument } from '@tiptap/core'
  import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
  import type { EditorView } from '@tiptap/pm/view'
  import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
  import Placeholder from '@tiptap/extension-placeholder'
  import type { DocSession, EditorBridge } from '../../sync/docSession'
  import { uploadFile, publicFileUrl } from '../../api/files'
  import { showError, showToast } from '../../stores/toast'
  import type { AnchorRect } from '../utils/portal'
  import { looksLikeMarkdown, splitSoftBreaks } from './paste'
  import { contentExtensions } from './schema'
  import { filterBlocks, isYoutubeUrl, normalizeUrl, slashQuery, type BlockId, type BlockItem } from './blocks'
  import InsertMenu from './InsertMenu.svelte'
  import MediaPrompt from './MediaPrompt.svelte'
  import FormatBar from './FormatBar.svelte'

  interface Props {
    session: DocSession
    onBlur?: () => void
    placeholder?: string
    autofocus?: boolean
  }
  let { session, onBlur, placeholder = 'Write here…', autofocus = false }: Props = $props()

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

  const isVideoFile = (f: File) => f.type.startsWith('video/')
  const mediaFiles = (list: FileList | File[] | null | undefined) =>
    Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || isVideoFile(f))

  // Upload pasted/dropped/picked media to Files and insert it where the user
  // was. Positions are mapped through edits made while uploading.
  async function insertUploads(view: EditorView, files: File[], at: number) {
    const tracker = { pos: at }
    const follow = ({ transaction }: { transaction: Transaction }) => {
      tracker.pos = transaction.mapping.map(tracker.pos)
    }
    editor?.on('transaction', follow)
    const noun = files.every(isVideoFile) ? 'video' : files.some(isVideoFile) ? 'file' : 'image'
    const dismiss = showToast(files.length > 1 ? `Uploading ${files.length} ${noun}s…` : `Uploading ${noun}…`, {
      duration: 60_000,
    })
    try {
      for (const file of files) {
        const video = isVideoFile(file)
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
        const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? (video ? 'mp4' : 'png')
        const name = file.name && file.name !== 'image.png' ? file.name : `Pasted ${video ? 'video' : 'image'} ${stamp}.${ext}`
        const meta = await uploadFile(file, name, { inline: true })
        if (!editor || editor.isDestroyed) return
        const src = publicFileUrl(meta.id)
        const { nodes } = view.state.schema
        tracker.pos = placeBlock(view, video ? nodes.video.create({ src }) : nodes.image.create({ src, alt: '' }), tracker.pos)
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
  // 1. Image/video files → upload + insert.
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
              const media = mediaFiles(data.files)
              if (media.length) {
                event.preventDefault()
                void insertUploads(view, media, view.state.selection.from)
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
              const media = mediaFiles(event.dataTransfer?.files)
              if (!media.length) return false
              event.preventDefault()
              const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
              void insertUploads(view, media, hit?.pos ?? view.state.selection.from)
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

  // ---- floating UI -------------------------------------------------------
  // The "+" beside an empty line and "/" typed into one both open the insert
  // menu; a text selection gets the format bar; a table gets its own tools.

  type MenuState = { mode: 'slash' | 'gutter'; pos: number; query: string; sel: number; anchor: AnchorRect }
  type Marks = { bold: boolean; italic: boolean; link: boolean; h3: boolean }

  let menu = $state<MenuState | null>(null)
  let menuItems = $derived(menu ? filterBlocks(menu.query) : [])
  let media = $state<{ kind: 'image' | 'video'; pos: number; anchor: AnchorRect } | null>(null)
  let gutter = $state<{ top: number; pos: number } | null>(null)
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

    // "+" beside an empty line
    if (focused && dom && paraNode && paraNode.content.size === 0) {
      const top = dom.getBoundingClientRect().top - wrapper.getBoundingClientRect().top + (dom.offsetHeight - 26) / 2
      gutter = { top, pos: para! }
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
      if (menu?.mode === 'gutter') menu.pos = transaction.mapping.map(menu.pos)
    }
    refresh()
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
    }
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

  function handleKeyDown(_view: EditorView, e: KeyboardEvent): boolean {
    if (e.isComposing) return false
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
      },
      onTransaction,
      onFocus: refresh,
      onBlur: () => {
        refresh()
        onBlur?.()
      },
    })
    bridge = {
      getBody: getMarkdown,
      setBody: applyMarkdown,
      canApply: () => !!editor && !editor.view.composing,
    }
    session.attach(bridge)

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
      bind:this={gutterBtn}
      style:top="{gutter.top}px"
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
    query={menu.query}
    anchor={menu.anchor}
    onPick={pick}
    onHover={(i) => menu && (menu.sel = i)}
  />
{/if}

{#if media}
  <MediaPrompt kind={media.kind} anchor={media.anchor} onUrl={onMediaUrl} onFiles={onMediaFiles} onCancel={onMediaCancel} />
{/if}

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
  :global(.rich-editor .tiptap video) { max-height: 70vh; }
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
    left: -31px;
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
  @media (max-width: 760px) {
    /* No room in the margin: sit at the end of the empty line instead. */
    .gutter-add { left: auto; right: 0; }
  }
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
