<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { safeFlip } from '../../utils/safeFlip'
  import { notesStore, isDayDraft, noteLabel, dayLabel } from '../../stores/notes'
  import { formatDate } from '../../utils/date'
  import NotesFilter from './NotesFilter.svelte'
  import type { NoteMetadata } from '../../types/models'
  import {
    relativeTime,
    dateBucket,
    bucketLabels,
    bucketOrder,
    type DateBucket,
  } from '../utils/relativeTime'

  // Day notes sort and group by their day, everything else by last edit or
  // creation, whichever sort is picked.
  const dayTime = (n: NoteMetadata) => (n.day ? Date.parse(n.day + 'T12:00:00') : n.updatedAt || 0)
  let listTime = $derived(
    $notesStore.sort === 'added'
      ? (n: NoteMetadata) => n.createdAt || n.updatedAt || 0
      : (n: NoteMetadata) => n.updatedAt || n.createdAt || 0,
  )

  let visibleNotes = $derived.by<NoteMetadata[]>(() => {
    const { allNotes, filter } = $notesStore
    if (filter.kind === 'trash') {
      return allNotes
        .filter((n) => !!n.deletedAt)
        .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
    }
    const live = allNotes.filter((n) => !n.deletedAt && !isDayDraft(n))
    if (filter.kind === 'day') {
      return live
        .filter((n) => n.day)
        .sort((a, b) => dayTime(b) - dayTime(a) || (a.dayOrder ?? 0) - (b.dayOrder ?? 0))
    }
    const shown =
      filter.kind === 'tag'
        ? live.filter((n) => n.tags?.includes(filter.tag))
        : filter.kind === 'untagged'
          ? live.filter((n) => !n.tags?.length)
          : filter.kind === 'notepad'
            ? live.filter((n) => !n.day)
            : live
    return shown.sort((a, b) => listTime(b) - listTime(a))
  })

  let groups = $derived.by(() => {
    const { filter } = $notesStore
    if (filter.kind === 'trash') return null
    const now = Date.now()
    const map = new Map<DateBucket, NoteMetadata[]>()
    for (const n of visibleNotes) {
      const ts = filter.kind === 'day' ? dayTime(n) : listTime(n)
      const key = dateBucket(ts, now)
      const arr = map.get(key) ?? []
      arr.push(n)
      map.set(key, arr)
    }
    return bucketOrder
      .map((b) => ({ key: b, label: bucketLabels[b], items: map.get(b) ?? [] }))
      .filter((g) => g.items.length > 0)
  })

  // Tags worth showing on a row: the one being filtered on is implied.
  function rowTags(n: NoteMetadata): string[] {
    const f = $notesStore.filter
    return (n.tags ?? []).filter((t) => !(f.kind === 'tag' && f.tag === t)).slice(0, 3)
  }

  // Multi-select: "Select" in the header, or Cmd/Ctrl/Shift-click a row.
  let selecting = $state(false)
  let picked = $state(new Set<string>())
  let anchorId: string | null = null

  // A new view starts with nothing picked. Keyed by value: the store updates
  // on every edit, and that shouldn't drop the selection.
  let filterKey = $derived(JSON.stringify($notesStore.filter))
  $effect(() => {
    void filterKey
    untrack(stopSelecting)
  })

  function stopSelecting() {
    selecting = false
    picked = new Set()
    anchorId = null
  }

  function togglePick(id: string, range: boolean) {
    const next = new Set(picked)
    const ids = visibleNotes.map((n) => n.id)
    const a = anchorId ? ids.indexOf(anchorId) : -1
    const b = ids.indexOf(id)
    if (range && a !== -1 && b !== -1) {
      for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x)
    } else {
      if (next.has(id)) next.delete(id)
      else next.add(id)
      anchorId = id
    }
    picked = next
  }

  function onRowClick(e: MouseEvent, id: string) {
    if (selecting || e.metaKey || e.ctrlKey || e.shiftKey) {
      if (!selecting) {
        selecting = true
        // Start from the open note, so Cmd-click adds to it.
        const open = $notesStore.selectedNid
        if (open && open !== id && visibleNotes.some((n) => n.id === open)) {
          picked = new Set([open])
          anchorId = open
        }
      }
      togglePick(id, e.shiftKey)
      return
    }
    notesStore.selectNote(id)
  }

  function deletePicked() {
    notesStore.trashNotes([...picked])
    stopSelecting()
  }

  async function onCreate() {
    const { filter, allNotes } = $notesStore
    if (filter.kind === 'day') {
      const day = formatDate(new Date())
      const order = Math.max(-1, ...allNotes.filter((n) => n.day === day).map((n) => n.dayOrder ?? 0)) + 1
      notesStore.createNote({ day, dayOrder: order })
    } else {
      notesStore.createNote({ tag: filter.kind === 'tag' ? filter.tag : undefined })
    }
    await tick()
    document.querySelector<HTMLInputElement>('.editor-main .note-title')?.focus()
  }
</script>

<section class="notes-col" class:selecting>
  <header class="col-header">
    <NotesFilter />
    <div class="col-actions">
      {#if $notesStore.filter.kind === 'trash'}
        {#if visibleNotes.length > 0}
          <button class="text-action danger" onclick={() => notesStore.emptyTrash()}>Empty trash</button>
        {/if}
      {:else if selecting}
        <button class="text-action danger" disabled={picked.size === 0} onclick={deletePicked}>
          Delete{picked.size ? ` ${picked.size}` : ''}
        </button>
        <button class="text-action" onclick={stopSelecting}>Done</button>
      {:else}
        {#if visibleNotes.length > 0}
          <button class="text-action" onclick={() => (selecting = true)}>Select</button>
        {/if}
        <button class="icon-btn primary" title="New note" aria-label="New note" onclick={onCreate}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
        </button>
      {/if}
    </div>
  </header>

  <div class="col-list">
    {#if visibleNotes.length === 0}
      <div class="empty">
        {#if !$notesStore.loaded}
          <div class="empty-headline">Loading…</div>
        {:else if $notesStore.filter.kind === 'trash'}
          <div class="empty-headline">Trash is empty</div>
          <div class="empty-sub">Notes you delete will rest here.</div>
        {:else if $notesStore.filter.kind === 'day'}
          <div class="empty-headline">No journal notes yet</div>
          <div class="empty-sub">Notes you write in Journal land here.</div>
        {:else}
          <div class="empty-headline">No notes here</div>
          <div class="empty-sub">Hit + above to start writing.</div>
        {/if}
      </div>
    {:else if $notesStore.filter.kind === 'trash'}
      <div class="rows">
        {#each visibleNotes as n (n.id)}
          <div class="row trash-row">
            <div class="row-body">
              <div class="row-title">{noteLabel(n)}</div>
              {#if n.preview}
                <div class="row-preview">{n.preview}</div>
              {/if}
              <div class="row-meta">
                <span>{relativeTime(n.deletedAt ?? n.updatedAt)}</span>
                {#if n.day}
                  <span class="meta-dot" aria-hidden="true">·</span>
                  <span class="row-tag">Day note</span>
                {/if}
              </div>
            </div>
            <div class="row-actions">
              <button
                class="row-action"
                title="Restore"
                aria-label="Restore note"
                onclick={() => notesStore.restoreNote(n.id)}
              ><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.5L3 6M3 3v3h3"/></svg></button>
              <button
                class="row-action danger"
                title="Delete forever"
                aria-label="Delete forever"
                onclick={() => notesStore.permanentlyDeleteNote(n.id)}
              ><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></button>
            </div>
          </div>
        {/each}
      </div>
    {:else if groups}
      {#each groups as group (group.key)}
        <div class="group-header">{group.label}</div>
        <div class="rows">
          {#each group.items as n (n.id)}
            <div
              class="row"
              class:active={!selecting && n.id === $notesStore.selectedNid}
              class:picked={picked.has(n.id)}
              role="button"
              aria-pressed={selecting ? picked.has(n.id) : undefined}
              tabindex="0"
              animate:safeFlip={{ duration: 180 }}
              onmousedown={(e) => {
                // Keep Shift-click from highlighting text.
                if (e.shiftKey) e.preventDefault()
              }}
              onclick={(e) => onRowClick(e, n.id)}
              onkeydown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  if (selecting) togglePick(n.id, e.shiftKey)
                  else notesStore.selectNote(n.id)
                } else if (e.key === 'Escape' && selecting) {
                  stopSelecting()
                }
              }}
            >
              {#if selecting}
                <span class="check" aria-hidden="true">
                  {#if picked.has(n.id)}
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                  {/if}
                </span>
              {/if}
              <div class="row-body">
                <div class="row-title">{noteLabel(n)}</div>
                {#if n.preview}
                  <div class="row-preview">{n.preview}</div>
                {:else}
                  <div class="row-preview muted">No content yet</div>
                {/if}
                <div class="row-meta">
                  {#if n.day && n.title.trim() && $notesStore.filter.kind !== 'day'}
                    <span class="row-tag day">{dayLabel(n.day)}</span>
                  {:else}
                    <span>{relativeTime($notesStore.filter.kind === 'day' ? n.updatedAt : listTime(n))}</span>
                  {/if}
                  {#each rowTags(n) as t (t)}
                    <span class="row-tag">#{t}</span>
                  {/each}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
</section>

<style>
  .notes-col {
    width: 340px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--line);
    border-right: 1px solid var(--line);
    background: var(--glass-dark);
    min-height: 0;
    font-family: var(--font-ui, inherit);
  }
  .col-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1rem 0.75rem;
    border-bottom: 1px solid var(--line);
    gap: 0.75rem;
  }
  .col-actions { display: flex; gap: 0.4rem; align-items: center; min-height: 32px; }

  .icon-btn {
    background: none;
    border: 1px solid var(--line);
    color: var(--muted);
    cursor: pointer;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    font-size: 1.1rem;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .icon-btn:hover {
    background: var(--glass);
    color: var(--text);
    border-color: var(--accent);
  }
  .icon-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .icon-btn.primary { color: var(--text); }
  .icon-btn svg { width: 15px; height: 15px; display: block; }

  .text-action {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.78rem;
    padding: 6px 8px;
    border-radius: 6px;
    white-space: nowrap;
    transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }
  .text-action:hover { color: var(--text); background: var(--glass-dark); }
  .text-action.danger:hover:not(:disabled) { color: var(--danger); background: var(--danger-bg); }
  .text-action:disabled { opacity: 0.4; cursor: default; }
  .text-action:disabled:hover { background: none; color: var(--muted); }

  .col-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0.5rem 1rem;
    min-height: 0;
  }

  .group-header {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    padding: 0.85rem 0.75rem 0.4rem;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.65rem 0.75rem;
    border-radius: 10px;
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-out);
    animation: row-in var(--dur-base) var(--ease-out);
  }
  .row:hover { background: var(--glass-dark); }
  .row:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .row.active {
    background: var(--glass);
  }
  .row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }

  .row-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .row-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row.active .row-title { color: var(--text); }
  .row-preview {
    font-size: 0.82rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.35;
  }
  .row-preview.muted { opacity: 0.5; font-style: italic; }
  .row-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    color: var(--muted);
    margin-top: 2px;
  }
  .meta-dot { opacity: 0.6; }
  .row-meta { min-width: 0; overflow: hidden; }
  .row-tag {
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--glass-dark);
    font-size: 0.68rem;
    white-space: nowrap;
  }
  .row-tag.day { color: var(--accent); }

  .row-actions { display: flex; gap: 2px; align-items: flex-start; }
  .row-action {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    width: 28px;
    height: 28px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }
  .row-action:hover { color: var(--text); background: var(--glass); }
  .row-action.danger:hover { color: var(--danger); background: var(--danger-bg); }
  .row.picked { background: var(--glass); }
  .selecting .row { user-select: none; }
  .check {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-top: 3px;
    border: 1.5px solid var(--line);
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text);
    transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }
  .row.picked .check { background: var(--accent); border-color: var(--accent); }
  .check svg { width: 12px; height: 12px; display: block; }

  .trash-row { font-style: normal; }
  .trash-row .row-title { opacity: 0.85; }

  .empty {
    text-align: center;
    padding: 3rem 1.5rem;
    color: var(--muted);
  }
  .empty-headline { font-size: 0.95rem; opacity: 0.7; }
  .empty-sub { font-size: 0.8rem; opacity: 0.5; margin-top: 0.4rem; }

  @keyframes row-in {
    from { opacity: 0; transform: translateY(2px); }
    to { opacity: 1; transform: none; }
  }

  @media (max-width: 900px) {
    .notes-col {
      width: 100%;
      border: none;
      flex: 1;
      min-height: 0;
    }
    .col-header { padding: 0.6rem 0.75rem; gap: 0.4rem; }
    .col-list { padding: 0.5rem; }
    .col-actions { gap: 0.25rem; }
    /* Generous tap targets on touch — 40px square. */
    .icon-btn { width: 40px; height: 40px; }
    .icon-btn svg { width: 18px; height: 18px; }
    .text-action { padding: 10px 12px; font-size: 0.85rem; }
    .row { padding: 0.6rem 0.75rem; }
    .row-action { width: 40px; height: 40px; }
  }
</style>
