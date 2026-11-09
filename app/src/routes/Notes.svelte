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
</script>

<div class="notes-layout" class:has-selected-note={$notesStore.selectedNid !== null}>
  <NotesColumn />
  <div class="editor-main">
    {#if $notesStore.selectedNid}
      {#key $notesStore.selectedNid}
        <NoteEditor nid={$notesStore.selectedNid} />
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
  }
  .editor-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    /* Left room for the editor's "+" gutter button. */
    padding: 1rem 1.5rem 1rem 3.5rem;
    max-width: 960px;
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
  @media (max-width: 900px) {
    .notes-layout {
      flex-direction: column;
    }
    .editor-main {
      padding: 0.75rem 1rem 1rem;
      max-width: none;
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
