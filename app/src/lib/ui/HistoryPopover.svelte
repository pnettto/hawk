<script lang="ts">
  import { onMount, tick } from 'svelte'
  import * as notesApi from '../../api/notes'
  import * as logsApi from '../../api/logs'
  import { notesStore } from '../../stores/notes'
  import { logsStore } from '../../stores/logs'
  import { showToast, showError } from '../../stores/toast'
  import type { SnapshotMeta, SnapshotKind } from '../../types/models'

  interface Props {
    kind: SnapshotKind
    entityId: string
    // Element to anchor the popover under. Required so we can position with
    // `position: fixed` and bypass any parent `overflow: hidden/auto` clipping.
    anchor: HTMLElement | null
    // Optional async work to run before listing versions — e.g. force a save
    // + snapshot so the popover always opens against fresh state. The popover
    // shows a loading state while this runs.
    prepare?: () => Promise<void>
    onRestore?: () => void
    onClose: () => void
  }
  let { kind, entityId, anchor, prepare, onRestore, onClose }: Props = $props()

  let versions = $state<SnapshotMeta[]>([])
  let loading = $state(true)
  let selected = $state<SnapshotMeta | null>(null)
  let previewText = $state<string>('')
  let previewLoading = $state(false)
  let restoring = $state(false)
  let popoverEl = $state<HTMLDivElement | null>(null)

  // Resolved on next tick after the popover renders, so we know its real width.
  let pos = $state<{ top: number; left: number } | null>(null)

  function computePos() {
    if (!anchor || !popoverEl) return
    const a = anchor.getBoundingClientRect()
    const pw = popoverEl.offsetWidth || 560
    const ph = popoverEl.offsetHeight || 320
    const margin = 8
    // Default: anchor below the icon, right edges aligned. Flip to align-left
    // if that overflows the viewport.
    let left = a.right - pw
    if (left < margin) left = a.left
    if (left + pw + margin > window.innerWidth) left = window.innerWidth - pw - margin
    if (left < margin) left = margin
    let top = a.bottom + 6
    // If too tall to fit below, flip above.
    if (top + ph + margin > window.innerHeight) {
      const flipped = a.top - ph - 6
      if (flipped >= margin) top = flipped
      else top = Math.max(margin, window.innerHeight - ph - margin)
    }
    pos = { top, left }
  }

  async function load() {
    loading = true
    try {
      if (prepare) {
        try { await prepare() } catch (e) { console.error('history prepare failed', e) }
      }
      if (kind === 'note') {
        versions = await notesApi.listNoteVersions(entityId)
      } else {
        const section = kind === 'day-notes' ? 'notes' : 'tasks'
        versions = await logsApi.listDayVersions(entityId, section)
      }
    } catch (e) {
      console.error('Failed to load versions:', e)
      versions = []
    } finally {
      loading = false
      await tick()
      computePos()
    }
  }

  function fmtTime(ms: number): string {
    const d = new Date(ms)
    const now = new Date()
    const diff = now.getTime() - ms
    const min = Math.floor(diff / 60000)
    if (min < 1) return 'just now'
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const day = Math.floor(hr / 24)
    if (day < 7) {
      return d.toLocaleDateString(undefined, { weekday: 'short' }) +
        ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  async function selectVersion(v: SnapshotMeta) {
    selected = v
    previewLoading = true
    previewText = ''
    try {
      if (kind === 'note') {
        const res = await notesApi.getNoteVersion(entityId, v.savedAt)
        previewText = stripMarkdown(res?.content?.content ?? '')
      } else {
        const section = kind === 'day-notes' ? 'notes' : 'tasks'
        const res = await logsApi.getDayVersion(entityId, section, v.savedAt)
        if (kind === 'day-notes') {
          previewText = stripMarkdown(res?.content?.notesMarkdown ?? '')
        } else {
          const entries = res?.content?.hourEntries ?? {}
          const lines: string[] = []
          // Sort by hour so the preview lists 9, 9-30, 10, 10-30 in order.
          const keys = Object.keys(entries).sort((a, b) => {
            const [ah, am] = a.split('-').map(Number)
            const [bh, bm] = b.split('-').map(Number)
            return (ah - bh) || ((am || 0) - (bm || 0))
          })
          // Comments are stored as contenteditable HTML — strip tags and
          // collapse whitespace so they read as plain text in the preview.
          const stripHtml = (s: string) =>
            s.replace(/<br\s*\/?>/gi, '\n')
              .replace(/<\/p>/gi, '\n')
              .replace(/<[^>]+>/g, '')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/[ \t]+\n/g, '\n')
              .replace(/\n{3,}/g, '\n\n')
              .trim()
          for (const hr of keys) {
            const e = entries[hr]
            const [h, m = 0] = hr.split('-').map(Number)
            const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
            const mark = e.checked ? '✓' : '·'
            const text = e.text ?? ''
            lines.push(`${mark} ${time}  ${text}`)
            const comment = stripHtml(e.comment ?? '')
            if (comment) {
              // Indent so the comment visually nests under its task line.
              for (const cline of comment.split('\n')) {
                lines.push(`        ${cline}`)
              }
            }
          }
          previewText = lines.join('\n') || '(empty)'
        }
      }
    } catch (e) {
      console.error('Failed to load version:', e)
      previewText = '(failed to load)'
    } finally {
      previewLoading = false
    }
  }

  async function restore() {
    if (!selected || restoring) return
    restoring = true
    let ok = false
    try {
      if (kind === 'note') {
        ok = await notesStore.restoreVersion(entityId, selected.savedAt)
      } else {
        const section = kind === 'day-notes' ? 'notes' : 'tasks'
        ok = await logsStore.restoreVersion(entityId, section, selected.savedAt)
      }
      if (ok) {
        showToast(`Restored from ${fmtTime(selected.savedAt)}`)
        onRestore?.()
        onClose()
      } else {
        showError('Restore failed.')
      }
    } finally {
      restoring = false
    }
  }

  onMount(async () => {
    // Position immediately based on initial size (loading state) so the popover
    // never flashes at 0,0; recomputed once the list has loaded.
    await tick()
    computePos()
    load()
  })

  function onWinResize() { computePos() }

  function onDocClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null
    if (!t) return
    if (t.closest('.history-popover') || t.closest('.history-toggle')) return
    onClose()
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }
  $effect(() => {
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onWinResize)
    window.addEventListener('scroll', onWinResize, true)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onWinResize)
      window.removeEventListener('scroll', onWinResize, true)
    }
  })

  // Strip markdown syntax so the preview reads as plain text. Cheap rules,
  // good enough for a "did I lose this content?" recognition view.
  function stripMarkdown(md: string): string {
    return md
      .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '• ')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/^---+$/gm, '────')
  }

  // Reparent into document.body so any ancestor with `transform`, `filter`,
  // or `perspective` can't trap our `position: fixed` in a new containing
  // block. Pure DOM move — Svelte's reactivity doesn't care.
  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return {
      destroy() {
        if (node.parentNode === document.body) document.body.removeChild(node)
      },
    }
  }
</script>

<div
  class="history-popover"
  bind:this={popoverEl}
  use:portal
  style:top={pos ? `${pos.top}px` : '-9999px'}
  style:left={pos ? `${pos.left}px` : '-9999px'}
  role="dialog"
  aria-label="Version history"
>
  <div class="header">
    <span class="title">History</span>
    <span class="hint">{loading ? '…' : `${versions.length} ${versions.length === 1 ? 'version' : 'versions'}`}</span>
  </div>

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if versions.length === 0}
    <div class="empty">No earlier versions yet. They'll appear here as you edit.</div>
  {:else}
    <div class="body">
      <ul class="list" role="listbox">
        {#each versions as v (v.savedAt)}
          <li>
            <button
              type="button"
              class="row"
              class:selected={selected?.savedAt === v.savedAt}
              onclick={() => selectVersion(v)}
            >
              <span class="time">{fmtTime(v.savedAt)}</span>
              <span class="preview">{v.preview || '(empty)'}</span>
            </button>
          </li>
        {/each}
      </ul>
      <div class="preview-pane">
        {#if !selected}
          <div class="preview-empty">Select a version to preview</div>
        {:else if previewLoading}
          <div class="preview-empty">Loading…</div>
        {:else}
          <pre class="preview-content mono">{previewText}</pre>
        {/if}
        {#if selected && !previewLoading}
          <div class="actions">
            <button class="btn-secondary" type="button" onclick={onClose}>Cancel</button>
            <button class="btn-primary" type="button" disabled={restoring} onclick={restore}>
              {restoring ? 'Restoring…' : 'Restore this version'}
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .history-popover {
    position: fixed;
    background: var(--panel, #2f343d);
    border: 1px solid var(--line, #3a3f47);
    padding: 0.75rem;
    border-radius: 10px;
    z-index: 1000;
    width: min(560px, 92vw);
    max-width: 92vw;
  }
  .header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0 0.25rem 0.5rem;
    border-bottom: 1px solid var(--line);
    margin-bottom: 0.5rem;
  }
  .title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
  }
  .hint {
    font-size: 0.7rem;
    color: var(--muted);
  }
  .empty {
    padding: 1rem;
    color: var(--muted);
    font-size: 0.85rem;
    text-align: center;
  }
  .body {
    display: grid;
    grid-template-columns: minmax(180px, 220px) 1fr;
    gap: 0.5rem;
    height: min(420px, 60vh);
    /* Children need explicit min-height: 0 so their inner `overflow: auto`
       actually scrolls instead of letting content push the popover taller. */
    overflow: hidden;
  }
  .body > * { min-height: 0; min-width: 0; }
  @media (max-width: 600px) {
    .body {
      grid-template-columns: 1fr;
    }
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    border-right: 1px solid var(--line);
    padding-right: 0.25rem;
  }
  @media (max-width: 600px) {
    .list { border-right: 0; max-height: 160px; }
  }
  .row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 4px;
    padding: 0.4rem 0.5rem;
    color: var(--text);
    cursor: pointer;
    font-family: inherit;
  }
  .row:hover {
    background: var(--glass-dark);
  }
  .row.selected {
    background: var(--glass);
  }
  .time {
    font-size: 0.75rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .preview {
    font-size: 0.8rem;
    color: var(--text);
    opacity: 0.85;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .preview-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .preview-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 0.85rem;
    font-style: italic;
  }
  .preview-content {
    flex: 1;
    overflow: auto;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--line);
    border-radius: 4px;
    font-size: 0.85rem;
    color: var(--text);
    line-height: 1.5;
  }
  .preview-content.mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    white-space: pre-wrap;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .btn-primary {
    background: var(--accent);
    border: none;
    padding: 0.4rem 0.85rem;
    border-radius: 6px;
    color: var(--on-accent);
    font-weight: bold;
    cursor: pointer;
    font-size: 0.75rem;
  }
  .btn-primary:disabled { opacity: 0.6; cursor: default; }
  .btn-secondary {
    background: none;
    border: 1px solid var(--line);
    padding: 0.4rem 0.85rem;
    border-radius: 6px;
    color: var(--text);
    cursor: pointer;
    font-size: 0.75rem;
  }
</style>
