<script lang="ts">
  import { onDestroy } from 'svelte'
  import { notesStore } from '../../stores/notes'
  import NoteSharePopover from './NoteSharePopover.svelte'
  import HistoryPopover from '../ui/HistoryPopover.svelte'
  import RichEditor from '../editor/RichEditor.svelte'
  import { bindSnapshotTriggers } from '../../utils/snapshotTriggers'
  import type { Note } from '../../types/models'

  let showSharePopover = $state(false)
  let showCollectionPicker = $state(false)
  let showHistoryPopover = $state(false)
  let editorEl = $state<HTMLDivElement | null>(null)
  let historyAnchorEl = $state<HTMLButtonElement | null>(null)
  let teardownTriggers: (() => void) | null = null

  function toggleHistory() {
    showHistoryPopover = !showHistoryPopover
  }

  // Run inside the popover before listing — captures the user's current state
  // so the very first popover open already has a snapshot to show.
  async function prepareHistory() {
    if (!currentNote) return
    await notesStore.triggerSnapshot(currentNote.id)
  }

  let currentNote = $derived.by(() => {
    const s = $notesStore
    if (!s.selectedNid) return null
    return (s.allNotes.find((n) => n.id === s.selectedNid) as Note | undefined) ?? null
  })

  let currentCollectionName = $derived.by(() => {
    if (!currentNote) return ''
    return $notesStore.collections.find((c) => c.id === currentNote.cid)?.name ?? ''
  })

  let otherCollections = $derived.by(() => {
    if (!currentNote) return []
    return $notesStore.collections.filter((c) => c.id !== currentNote.cid)
  })

  function moveToCollection(targetCid: string) {
    if (!currentNote) return
    notesStore.moveNote(currentNote.id, targetCid)
    showCollectionPicker = false
  }

  let title = $state('')
  let lastNid = ''
  $effect(() => {
    if (!currentNote) {
      lastNid = ''
      return
    }
    if (currentNote.id !== lastNid) {
      lastNid = currentNote.id
      title = currentNote.title ?? ''
      return
    }
    // Same note — adopt the title from the store (e.g. another device renamed
    // it). Content is read directly from the store via $derived below, so the
    // editor mounts with the loaded body on the same render the {#if} flips
    // from loading → loaded.
    if (currentNote.title !== undefined && currentNote.title !== title) {
      title = currentNote.title
    }
  })

  // Source of truth for the editor body is the store. Deriving (instead of
  // mirroring into local state via $effect) avoids a one-frame flash where
  // the RichEditor mounts before the effect runs and the empty-state
  // placeholder briefly shows.
  let editorValue = $derived(currentNote?.content ?? '')

  function onTitleInput() {
    if (!currentNote) return
    notesStore.applyEdit(currentNote.id, { title })
  }
  function onContentChange(markdown: string) {
    if (!currentNote) return
    notesStore.applyEdit(currentNote.id, { content: markdown })
  }
  function onEditorBlur() {
    if (!currentNote) return
    notesStore.commitPendingRemote(currentNote.id)
  }

  function onClickOutside(e: MouseEvent) {
    const t = e.target as HTMLElement | null
    if (!t) return
    if (showSharePopover && !t.closest('.share-popover') && !t.closest('.share-toggle')) {
      showSharePopover = false
    }
    if (showCollectionPicker && !t.closest('.collection-picker') && !t.closest('.collection-chip')) {
      showCollectionPicker = false
    }
  }

  $effect(() => {
    document.addEventListener('click', onClickOutside)
    return () => document.removeEventListener('click', onClickOutside)
  })

  // Re-bind snapshot triggers whenever the editor root or selected note changes.
  // Trigger fires on focusout/visibilitychange/beforeunload — see snapshotTriggers.ts.
  $effect(() => {
    teardownTriggers?.()
    teardownTriggers = null
    if (!editorEl || !currentNote) return
    const nid = currentNote.id
    teardownTriggers = bindSnapshotTriggers(editorEl, () => {
      notesStore.triggerSnapshot(nid)
    })
  })

  onDestroy(() => {
    teardownTriggers?.()
    teardownTriggers = null
  })
</script>

{#if currentNote}
<div class="editor-root" bind:this={editorEl}>
  <div class="editor-header">
    <button
      type="button"
      class="mobile-back"
      aria-label="Back to notes"
      onclick={() => notesStore.clearSelectedNote()}
    >
      <span aria-hidden="true">←</span>
    </button>
    <input type="text" class="note-title" bind:value={title} oninput={onTitleInput} />
    <div class="header-actions">
      {#if currentCollectionName}
        <div class="collection-wrap">
          <button
            type="button"
            class="collection-chip"
            onclick={() => (showCollectionPicker = !showCollectionPicker)}
            title="Move to another collection"
          >
            <span class="chip-icon" aria-hidden="true">●</span>
            <span class="chip-name">{currentCollectionName}</span>
            <span class="chip-caret" aria-hidden="true">▾</span>
          </button>
          {#if showCollectionPicker}
            <div class="collection-picker">
              <div class="picker-header">Move to</div>
              {#if otherCollections.length === 0}
                <div class="picker-empty">No other collections</div>
              {:else}
                {#each otherCollections as c (c.id)}
                  <button class="picker-item" onclick={() => moveToCollection(c.id)}>
                    <span class="dot" aria-hidden="true">●</span>
                    <span>{c.name}</span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {/if}
      <div class="history-wrap">
        <button
          type="button"
          class="history-toggle icon-btn"
          aria-label="Version history"
          title="Version history"
          bind:this={historyAnchorEl}
          onclick={toggleHistory}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l3 2" />
          </svg>
        </button>
        {#if showHistoryPopover}
          <HistoryPopover
            kind="note"
            entityId={currentNote.id}
            anchor={historyAnchorEl}
            prepare={prepareHistory}
            onClose={() => (showHistoryPopover = false)}
          />
        {/if}
      </div>
      <div class="share-wrap">
        <button
          type="button"
          class="share-toggle share-btn"
          class:active={currentNote.isPublic}
          onclick={() => (showSharePopover = !showSharePopover)}
        >
          {currentNote.isPublic ? 'Public' : 'Share'}
        </button>
        {#if showSharePopover}
          <NoteSharePopover note={currentNote} onClose={() => (showSharePopover = false)} />
        {/if}
      </div>
    </div>
  </div>

  {#if currentNote.content === undefined}
    <div class="editor-loading">Loading…</div>
  {:else}
    {#key currentNote.id}
      <RichEditor value={editorValue} onChange={onContentChange} onBlur={onEditorBlur} />
    {/key}
  {/if}
</div>
{:else}
  <div class="empty-state">
    {$notesStore.selectedCid ? 'Select or create a note' : 'Choose or create a collection'}
  </div>
{/if}

<style>
  .editor-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .mobile-back {
    display: none;
    background: none;
    border: 1px solid var(--line);
    color: var(--text);
    cursor: pointer;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    line-height: 1;
    flex-shrink: 0;
    transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }
  .mobile-back:hover { background: rgba(255, 255, 255, 0.06); border-color: var(--accent); }
  .note-title {
    background: none;
    border: none;
    color: var(--text);
    font-size: 2.5rem;
    width: 100%;
    outline: none;
    font-weight: 800;
    opacity: 0.95;
    font-family: inherit;
  }
  .header-actions { display: flex; align-items: center; gap: 0.5rem; }
  .collection-wrap { position: relative; }
  .collection-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 5px 12px;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8rem;
    white-space: nowrap;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .collection-chip:hover { color: var(--text); border-color: var(--accent); background: rgba(255, 255, 255, 0.07); }
  .chip-icon { color: var(--accent); font-size: 0.55rem; }
  .chip-name { font-weight: 500; }
  .chip-caret { font-size: 0.7rem; opacity: 0.6; }
  .collection-picker {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 50;
    min-width: 200px;
    max-height: 280px;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .picker-header {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    opacity: 0.7;
    padding: 6px 10px 4px;
  }
  .picker-empty {
    padding: 6px 10px 10px;
    font-size: 0.8rem;
    color: var(--muted);
    opacity: 0.6;
    font-style: italic;
  }
  .picker-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.85rem;
    padding: 7px 10px;
    border-radius: 6px;
    text-align: left;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .picker-item:hover { background: rgba(255, 255, 255, 0.06); }
  .picker-item .dot { color: var(--accent); font-size: 0.55rem; }

  .editor-root { display: contents; }
  .history-wrap { position: relative; }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
    color: var(--muted);
    cursor: pointer;
    opacity: 0.7;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }
  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--accent);
    color: var(--text);
    opacity: 1;
  }
  .icon-btn:disabled { opacity: 0.4; cursor: default; }
  .share-wrap { position: relative; }
  .share-btn {
    font-size: 0.8rem;
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .share-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--accent);
  }
  .share-btn.active {
    background: rgba(0, 255, 136, 0.1);
    border-color: #00ff88;
    color: #00ff88;
  }
  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-style: italic;
    opacity: 0.5;
    padding: 4rem 2rem;
  }
  .editor-loading {
    color: var(--muted);
    font-style: italic;
    opacity: 0.4;
    padding: 0.5rem 0;
    font-size: 1rem;
    line-height: var(--lh);
  }
  @media (max-width: 900px) {
    .mobile-back { display: inline-flex; }
    .editor-header { gap: 0.5rem; margin-bottom: 1rem; }
  }
  @media (max-width: 600px) {
    .note-title {
      font-size: 1.8rem;
    }
  }
</style>
