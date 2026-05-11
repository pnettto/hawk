<script lang="ts">
  import { tick } from 'svelte'
  import { notesStore } from '../../stores/notes'
  import type { NoteMetadata } from '../../types/models'
  import {
    relativeTime,
    dateBucket,
    bucketLabels,
    bucketOrder,
    type DateBucket,
  } from '../utils/relativeTime'

  let isRenaming = $state(false)
  let renameValue = $state('')
  let isConfirmingDelete = $state(false)

  let visibleNotes = $derived.by<NoteMetadata[]>(() => {
    const s = $notesStore
    if (s.view === 'trash') {
      return s.allNotes
        .filter((n) => !!n.deletedAt)
        .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
    }
    if (s.view === 'all') {
      return s.allNotes
        .filter((n) => !n.deletedAt)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    }
    if (!s.selectedCid) return []
    return s.allNotes
      .filter((n) => n.cid === s.selectedCid && !n.deletedAt)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  })

  let groups = $derived.by(() => {
    const s = $notesStore
    if (s.view === 'trash') return null
    const now = Date.now()
    const map = new Map<DateBucket, NoteMetadata[]>()
    for (const n of visibleNotes) {
      const key = dateBucket(n.updatedAt || n.createdAt || now, now)
      const arr = map.get(key) ?? []
      arr.push(n)
      map.set(key, arr)
    }
    return bucketOrder
      .map((b) => ({ key: b, label: bucketLabels[b], items: map.get(b) ?? [] }))
      .filter((g) => g.items.length > 0)
  })

  let collectionsById = $derived.by(() => {
    const m = new Map<string, string>()
    for (const c of $notesStore.collections) m.set(c.id, c.name)
    return m
  })

  let header = $derived.by(() => {
    const s = $notesStore
    if (s.view === 'trash') return { title: 'Trash', subtitle: '' }
    if (s.view === 'all') return { title: 'All Notes', subtitle: '' }
    const name = collectionsById.get(s.selectedCid ?? '') ?? ''
    return { title: name || 'Notes', subtitle: '' }
  })

  function onCreate() {
    const s = $notesStore
    // In 'all' view with no selectedCid, fall back to first collection.
    if (!s.selectedCid && s.collections.length > 0) {
      notesStore.selectCollection(s.collections[0].id)
    }
    notesStore.createNote()
  }

  function canCreate(): boolean {
    const s = $notesStore
    if (s.view === 'trash') return false
    return s.collections.length > 0
  }

  let activeCollection = $derived.by(() => {
    const s = $notesStore
    if (s.view !== 'collection' || !s.selectedCid) return null
    return s.collections.find((c) => c.id === s.selectedCid) ?? null
  })

  let canManageCollection = $derived(activeCollection !== null)

  let activeNoteCount = $derived.by(() => {
    const s = $notesStore
    if (!activeCollection) return 0
    return s.allNotes.filter((n) => n.cid === activeCollection!.id && !n.deletedAt).length
  })

  async function startRename() {
    if (!activeCollection) return
    isConfirmingDelete = false
    renameValue = activeCollection.name
    isRenaming = true
    await tick()
    const el = document.querySelector<HTMLInputElement>('#col-rename-input')
    el?.focus()
    el?.select()
  }

  async function submitRename() {
    if (!isRenaming) return
    const target = activeCollection
    const name = renameValue.trim()
    isRenaming = false
    if (target && name && name !== target.name) {
      await notesStore.renameCollection(target.id, name)
    }
  }

  function cancelRename() {
    isRenaming = false
  }

  function startConfirmDelete() {
    if (!activeCollection) return
    isRenaming = false
    isConfirmingDelete = true
  }

  function cancelConfirmDelete() {
    isConfirmingDelete = false
  }

  function confirmDelete() {
    const target = activeCollection
    isConfirmingDelete = false
    if (target) notesStore.deleteCollection(target.id)
  }
</script>

<section class="notes-col">
  <header class="col-header" class:editing={isRenaming || isConfirmingDelete}>
    {#if isRenaming && activeCollection}
      <form class="header-rename" onsubmit={(e) => { e.preventDefault(); submitRename() }}>
        <input
          id="col-rename-input"
          type="text"
          class="rename-input"
          bind:value={renameValue}
          onblur={submitRename}
          onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancelRename() } }}
        />
        <button type="button" class="text-action" onmousedown={(e) => e.preventDefault()} onclick={cancelRename}>Cancel</button>
      </form>
    {:else if isConfirmingDelete && activeCollection}
      <div class="header-confirm">
        <div class="confirm-message">
          <span class="confirm-title">Delete "{activeCollection.name}"?</span>
          {#if activeNoteCount > 0}
            <span class="confirm-sub">
              {activeNoteCount} {activeNoteCount === 1 ? 'note' : 'notes'} will be lost.
            </span>
          {/if}
        </div>
        <div class="col-actions">
          <button type="button" class="text-action" onclick={cancelConfirmDelete}>Cancel</button>
          <button type="button" class="text-action danger strong" onclick={confirmDelete}>Delete</button>
        </div>
      </div>
    {:else}
      <div class="col-title-wrap">
        <h2 class="col-title">{header.title}</h2>
        <span class="col-count">{visibleNotes.length}</span>
      </div>
      <div class="col-actions">
        {#if canManageCollection}
          <button class="icon-btn ghost" title="Rename collection" aria-label="Rename collection" onclick={startRename}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M11 2.2l2.8 2.8-8.4 8.4H2.6v-2.8l8.4-8.4z"/>
              <path d="M10 3.2l2.8 2.8"/>
            </svg>
          </button>
          <button class="icon-btn ghost danger" title="Delete collection" aria-label="Delete collection" onclick={startConfirmDelete}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2.5 4.5h11"/>
              <path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/>
              <path d="M3.7 4.5l.7 9.3a1 1 0 0 0 1 .9h5.2a1 1 0 0 0 1-.9l.7-9.3"/>
              <path d="M6.5 7.5v4M9.5 7.5v4"/>
            </svg>
          </button>
        {/if}
        {#if $notesStore.view === 'trash'}
          {#if visibleNotes.length > 0}
            <button class="text-action danger" onclick={() => notesStore.emptyTrash()}>Empty trash</button>
          {/if}
        {:else if canCreate()}
          <button class="icon-btn primary" title="New note" aria-label="New note" onclick={onCreate}>+</button>
        {/if}
      </div>
    {/if}
  </header>

  <div class="col-list">
    {#if visibleNotes.length === 0}
      <div class="empty">
        {#if !$notesStore.loaded}
          <div class="empty-headline">Loading…</div>
        {:else if $notesStore.view === 'trash'}
          <div class="empty-headline">Trash is empty</div>
          <div class="empty-sub">Notes you delete will rest here.</div>
        {:else if $notesStore.collections.length === 0}
          <div class="empty-headline">No collections yet</div>
          <div class="empty-sub">Create one in the rail to get started.</div>
        {:else}
          <div class="empty-headline">No notes here</div>
          <div class="empty-sub">Hit + above to start writing.</div>
        {/if}
      </div>
    {:else if $notesStore.view === 'trash'}
      <div class="rows">
        {#each visibleNotes as n (n.id)}
          <div class="row trash-row">
            <div class="row-body">
              <div class="row-title">{n.title || 'Untitled'}</div>
              {#if n.preview}
                <div class="row-preview">{n.preview}</div>
              {/if}
              <div class="row-meta">
                <span>{relativeTime(n.deletedAt ?? n.updatedAt)}</span>
                {#if collectionsById.get(n.cid)}
                  <span class="meta-dot" aria-hidden="true">·</span>
                  <span class="row-tag">{collectionsById.get(n.cid)}</span>
                {/if}
              </div>
            </div>
            <div class="row-actions">
              <button
                class="row-action"
                title="Restore"
                aria-label="Restore note"
                onclick={() => notesStore.restoreNote(n.id)}
              >↺</button>
              <button
                class="row-action danger"
                title="Delete forever"
                aria-label="Delete forever"
                onclick={() => notesStore.permanentlyDeleteNote(n.id)}
              >×</button>
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
              class:active={n.id === $notesStore.selectedNid}
              role="button"
              tabindex="0"
              onclick={() => notesStore.selectNote(n.id)}
              onkeydown={(e) => { if (e.key === 'Enter') notesStore.selectNote(n.id) }}
            >
              <div class="row-body">
                <div class="row-title">{n.title || 'Untitled'}</div>
                {#if n.preview}
                  <div class="row-preview">{n.preview}</div>
                {:else}
                  <div class="row-preview muted">No content yet</div>
                {/if}
                <div class="row-meta">
                  <span>{relativeTime(n.updatedAt)}</span>
                  {#if $notesStore.view === 'all' && collectionsById.get(n.cid)}
                    <span class="meta-dot" aria-hidden="true">·</span>
                    <span class="row-tag">{collectionsById.get(n.cid)}</span>
                  {/if}
                </div>
              </div>
              <button
                class="row-action danger row-delete"
                title="Move to trash"
                aria-label="Move to trash"
                onclick={(e) => { e.stopPropagation(); notesStore.trashNote(n.id) }}
              >×</button>
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
  .col-title-wrap { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; }
  .col-title {
    font-size: 1rem;
    font-weight: 700;
    margin: 0;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .col-count {
    font-size: 0.75rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .col-actions { display: flex; gap: 0.4rem; align-items: center; }

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
  .icon-btn.ghost { border-color: transparent; }
  .icon-btn.ghost:hover { border-color: var(--line); }
  .icon-btn.ghost.danger:hover { color: var(--danger); border-color: var(--danger); background: var(--danger-bg); }
  .icon-btn svg { width: 16px; height: 16px; display: block; }

  .header-rename {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }
  .rename-input {
    flex: 1;
    min-width: 0;
    background: var(--input-bg);
    border: 1px solid var(--accent);
    border-radius: 8px;
    color: var(--text);
    font-family: inherit;
    font-size: 1rem;
    font-weight: 700;
    padding: 6px 10px;
    outline: none;
  }

  .header-confirm {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex: 1;
    min-width: 0;
  }
  .confirm-message {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }
  .confirm-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .confirm-sub {
    font-size: 0.72rem;
    color: var(--muted);
    opacity: 0.85;
  }
  .text-action.strong { font-weight: 700; }
  .text-action {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.78rem;
    padding: 6px 8px;
    border-radius: 6px;
    transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }
  .text-action:hover { color: var(--text); background: var(--glass-dark); }
  .text-action.danger:hover { color: var(--danger); background: var(--danger-bg); }

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
  .row-tag {
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--glass-dark);
    font-size: 0.68rem;
  }

  .row-actions { display: flex; gap: 2px; align-items: flex-start; }
  .row-action {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 1rem;
    line-height: 1;
    transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }
  .row-action:hover { color: var(--text); background: var(--glass); }
  .row-action.danger:hover { color: var(--danger); background: var(--danger-bg); }
  .row-delete {
    opacity: 0;
    align-self: center;
    transition: opacity var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }
  .row:hover .row-delete,
  .row:focus-within .row-delete { opacity: 0.65; }
  .row:hover .row-delete:hover { opacity: 1; }
  @media (hover: none) {
    .row-delete { opacity: 0.5; }
  }

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
    .col-title { font-size: 1.05rem; }
    .row { padding: 0.6rem 0.75rem; }
    .row-delete { opacity: 0.5; }
    .row-action { padding: 8px 10px; font-size: 1.1rem; }
  }
</style>
