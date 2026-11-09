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
    await notesStore.triggerSnapshot(currentNote.id, true)
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
  let titleInputEl = $state<HTMLInputElement | null>(null)
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
    // it). Skip while the user is typing here — applyEdit updates the store on
    // every keystroke, which re-runs this effect; if currentNote hasn't yet
    // re-derived the new title, we'd clobber what the user just typed.
    if (typeof document !== 'undefined' && document.activeElement === titleInputEl) return
    if (currentNote.title !== undefined && currentNote.title !== title) {
      title = currentNote.title
    }
  })

  // The sync session owns the body once it's loaded; the editor talks to it
  // directly (see sync/docSession.ts).
  let session = $derived(
    currentNote && currentNote.content !== undefined ? notesStore.sessionFor(currentNote.id) : null,
  )

  function onTitleInput() {
    if (!currentNote) return
    notesStore.setTitle(currentNote.id, title)
  }
  // Tab or Enter in the title moves into the body.
  function onTitleKeydown(e: KeyboardEvent) {
    if (e.isComposing) return
    if (!((e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter')) return
    const pm = editorEl?.querySelector<HTMLElement>('.tiptap')
    if (!pm) return
    e.preventDefault()
    pm.focus()
  }

  // composedPath, not target.closest: clicking "Enable public link"
  // re-renders the popover and detaches the clicked node, which used to read
  // as an outside click and close the popover before the link appeared.
  function onClickOutside(e: MouseEvent) {
    const inside = (sel: string) =>
      e.composedPath().some((n) => n instanceof Element && n.matches(sel))
    if (showSharePopover && !inside('.share-popover, .share-toggle')) showSharePopover = false
    if (showCollectionPicker && !inside('.collection-picker, .collection-chip')) {
      showCollectionPicker = false
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    if (showSharePopover) {
      showSharePopover = false
      document.querySelector<HTMLElement>('.share-toggle')?.focus()
    }
    if (showCollectionPicker) {
      showCollectionPicker = false
      document.querySelector<HTMLElement>('.collection-chip')?.focus()
    }
  }

  $effect(() => {
    document.addEventListener('click', onClickOutside)
    document.addEventListener('keydown', onKeydown)
    return () => {
      document.removeEventListener('click', onClickOutside)
      document.removeEventListener('keydown', onKeydown)
    }
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
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 8H3.5M7.5 4L3.5 8l4 4" /></svg>
    </button>
    <input
      type="text"
      class="note-title"
      placeholder="Untitled"
      aria-label="Note title"
      bind:this={titleInputEl}
      bind:value={title}
      oninput={onTitleInput}
      onkeydown={onTitleKeydown}
    />
    <div class="header-actions">
      {#if currentCollectionName}
        <div class="collection-wrap">
          <button
            type="button"
            class="collection-chip"
            onclick={() => (showCollectionPicker = !showCollectionPicker)}
            title="Move to another collection"
            aria-haspopup="menu"
            aria-expanded={showCollectionPicker}
          >
            <span class="chip-icon" aria-hidden="true"></span>
            <span class="chip-name">{currentCollectionName}</span>
            <svg class="chip-caret" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
          </button>
          {#if showCollectionPicker}
            <div class="collection-picker">
              <div class="picker-header">Move to</div>
              {#if otherCollections.length === 0}
                <div class="picker-empty">No other collections</div>
              {:else}
                {#each otherCollections as c (c.id)}
                  <button class="picker-item" onclick={() => moveToCollection(c.id)}>
                    <span class="dot" aria-hidden="true"></span>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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
          aria-haspopup="dialog"
          aria-expanded={showSharePopover}
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

  {#if !session}
    <div class="editor-loading" aria-busy="true">
      <span class="skeleton-line" style:width="72%"></span>
      <span class="skeleton-line" style:width="88%"></span>
      <span class="skeleton-line" style:width="54%"></span>
    </div>
  {:else}
    {#key currentNote.id}
      <RichEditor {session} />
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
  .mobile-back:hover { background: var(--glass-dark); border-color: var(--accent); }
  .note-title {
    padding: 0;
    flex: 1;
    background: none;
    border: none;
    color: var(--text);
    font-size: 2.5rem;
    width: 100%;
    outline: none;
    font-weight: 800;
    font-family: inherit;
    min-width: 0;
    text-overflow: ellipsis;
  }
  .note-title::placeholder { color: var(--muted); opacity: 0.35; }
  .note-title:hover,
  .note-title:focus { background: none; }
  .header-actions { display: flex; align-items: center; gap: 0.5rem; }
  .collection-wrap { position: relative; }
  .collection-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--glass-dark);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    height: 30px;
    padding: 0 12px;
    color: var(--muted);
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: 0.8125rem;
    white-space: nowrap;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .collection-chip:hover { color: var(--text); border-color: var(--accent); background: var(--glass); }
  .chip-icon,
  .picker-item .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
  .chip-name { font-weight: 500; max-width: 10rem; overflow: hidden; text-overflow: ellipsis; }
  .chip-caret { opacity: 0.6; }
  .collection-picker {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: var(--z-popover);
    min-width: 200px;
    max-height: 280px;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    padding: 6px;
    box-shadow: var(--shadow-pop);
    font-family: var(--font-ui);
    animation: popIn var(--dur-pop) var(--ease-spring);
    transform-origin: top right;
  }
  .picker-header {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    padding: 6px 10px 4px;
  }
  .picker-empty {
    padding: 6px 10px 10px;
    font-size: 0.8rem;
    color: var(--muted);
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
  .picker-item:hover { background: var(--glass); }


  .editor-root { display: contents; }
  .history-wrap { position: relative; }
  .history-toggle { width: 30px; height: 30px; }
  .share-wrap { position: relative; }
  .share-btn {
    font-family: var(--font-ui);
    font-size: 0.8125rem;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--glass-dark);
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .share-btn:hover {
    background: var(--glass);
    border-color: var(--accent);
  }
  .share-btn.active {
    background: var(--glass);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 500;
  }
  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 0.875rem;
    opacity: 0.6;
    padding: 4rem 2rem;
  }
  .editor-loading {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 0.6rem 0;
    max-width: 70ch;
  }
  @media (max-width: 900px) {
    .mobile-back { display: inline-flex; }
    .editor-header { gap: 0.5rem; margin-bottom: 1rem; }
  }
  @media (max-width: 600px) {
    /* Title gets its own full-width line under the controls. */
    .editor-header { flex-wrap: wrap; row-gap: 0.75rem; }
    .note-title { order: 3; flex-basis: 100%; font-size: 1.8rem; }
    .header-actions { margin-left: auto; }
  }
</style>
