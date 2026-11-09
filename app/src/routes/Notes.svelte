<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { notesStore } from '../stores/notes'
  import CollectionRail from '../lib/notes/CollectionRail.svelte'
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
  <CollectionRail />
  <NotesColumn />
  <div class="editor-main">
    <NoteEditor />
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
    padding: 1rem 1.5rem 1rem 2rem;
    max-width: 900px;
    min-width: 0;
    overflow-y: auto;
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
       rail and notes column so the editor takes the full content area. */
    .notes-layout.has-selected-note :global(.rail),
    .notes-layout.has-selected-note :global(.notes-col) {
      display: none;
    }
    /* Conversely, hide the editor when no note is selected so the notes
       column is the only thing under the rail. */
    .notes-layout:not(.has-selected-note) .editor-main {
      display: none;
    }
  }
</style>
