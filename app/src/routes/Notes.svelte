<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { notesStore } from '../stores/notes'
  import NoteList from '../lib/notes/NoteList.svelte'
  import NoteEditor from '../lib/notes/NoteEditor.svelte'

  onMount(() => {
    notesStore.load()
  })

  // Refresh on focus, flushing local edits first.
  $effect(() => {
    const onFocus = () => notesStore.refresh()
    globalThis.addEventListener('focus', onFocus)
    return () => globalThis.removeEventListener('focus', onFocus)
  })

  // Flush any pending typing if the user navigates away.
  onDestroy(() => {
    notesStore.flushSaves()
  })
</script>

<div class="notes-layout">
  <NoteList />
  <div class="editor-main">
    <NoteEditor />
  </div>
</div>

<style>
  .notes-layout {
    display: flex;
    gap: 2rem;
    align-items: stretch;
  }
  .editor-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem 0;
    max-width: 800px;
    width: 100%;
  }
  @media (max-width: 900px) {
    .notes-layout {
      flex-direction: column;
      gap: 1.5rem;
    }
  }
</style>
