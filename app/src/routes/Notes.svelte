<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { notesStore } from '../stores/notes'
  import NotesColumn from '../lib/notes/NotesColumn.svelte'
  import NoteEditor from '../lib/notes/NoteEditor.svelte'

  onMount(() => {
    notesStore.load()
  })

  // Refresh on focus, flushing local edits first. When the page is hidden
  // or closed, write drafts and fire keepalive saves.
  $effect(() => {
    const onFocus = () => notesStore.refresh()
    const onHide = () => {
      if (document.visibilityState === 'hidden') notesStore.flushOnHide()
    }
    const onPageHide = () => notesStore.flushOnHide()
    globalThis.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onHide)
    globalThis.addEventListener('pagehide', onPageHide)
    return () => {
      globalThis.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onHide)
      globalThis.removeEventListener('pagehide', onPageHide)
    }
  })

  // Flush any pending typing if the user navigates away.
  onDestroy(() => {
    notesStore.flushSaves()
  })

  // The pinned cover takes the whole workspace until a note is opened.
  let cover = $derived($notesStore.filter.kind === 'pinned' && !$notesStore.selectedNid)
</script>

<div class="notes-layout" class:has-selected-note={$notesStore.selectedNid !== null} class:cover>
  <NotesColumn />
  <div class="editor-main">
    {#if $notesStore.selectedNid}
      {#key $notesStore.selectedNid}
        <NoteEditor nid={$notesStore.selectedNid} onDelete={() => $notesStore.selectedNid && notesStore.trashNote($notesStore.selectedNid)} />
      {/key}
    {:else}
      <div class="empty-state">Select or create a note</div>
    {/if}
  </div>
</div>

<style>
  .notes-layout {
    display: flex;
    align-items: stretch;
    flex: 1;
    min-height: 0;
    height: 100%;
    border-radius: var(--r-md);
    background: var(--bg);
    overflow: hidden;
  }
  .editor-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 0;
    min-width: 0;
    overflow-y: auto;
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
  /* Cover page: the pinned grid spans the workspace, with no empty editor
     pane beside it, until a card opens a note. */
  .notes-layout.cover :global(.notes-col) {
    width: 100%;
    border-right: none;
  }
  .notes-layout.cover .editor-main { display: none; }
  .notes-layout.cover :global(.pin-grid) {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    padding: 0.75rem;
  }
  .notes-layout.cover :global(.pin-card) { min-height: 120px; }
  @media (max-width: 900px) {
    .notes-layout {
      flex-direction: column;
    }
    /* One pane at a time: no divider to draw. */
    .notes-layout :global(.notes-col) {
      border-right: none;
    }
    .editor-main {
      padding: 0;
    }
    .notes-layout.cover :global(.pin-grid) {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 10px;
      padding: 0.5rem;
    }
    /* Master-detail navigation on mobile: when a note is selected, hide the
       notes column so the editor takes the full content area. */
    .notes-layout.has-selected-note :global(.notes-col) {
      display: none;
    }
    /* Conversely, hide the editor when no note is selected. */
    .notes-layout:not(.has-selected-note) .editor-main {
      display: none;
    }
  }
</style>
