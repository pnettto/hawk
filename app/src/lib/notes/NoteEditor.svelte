<script lang="ts">
  import { notesStore } from '../../stores/notes'
  import NoteSharePopover from './NoteSharePopover.svelte'
  import RichEditor from '../editor/RichEditor.svelte'
  import type { Note } from '../../types/models'

  let showSharePopover = $state(false)

  let currentNote = $derived.by(() => {
    const s = $notesStore
    if (!s.selectedNid) return null
    return (s.allNotes.find((n) => n.id === s.selectedNid) as Note | undefined) ?? null
  })

  let title = $state('')
  let content = $state('')
  let lastNid = ''
  $effect(() => {
    if (!currentNote) {
      lastNid = ''
      return
    }
    if (currentNote.id !== lastNid) {
      lastNid = currentNote.id
      title = currentNote.title ?? ''
      content = currentNote.content ?? ''
    } else {
      // External update (e.g. fetched full content after select) — rehydrate content
      // only if the editor hasn't diverged.
      if (currentNote.content !== undefined && content === '' && currentNote.content) {
        content = currentNote.content
      }
    }
  })

  function onTitleInput() {
    if (!currentNote) return
    notesStore.applyEdit(currentNote.id, { title })
  }
  function onContentChange(markdown: string) {
    if (!currentNote) return
    content = markdown
    notesStore.applyEdit(currentNote.id, { content: markdown })
  }

  function onClickOutside(e: MouseEvent) {
    if (!showSharePopover) return
    const t = e.target as HTMLElement | null
    if (!t) return
    if (t.closest('.share-popover') || t.closest('.share-toggle')) return
    showSharePopover = false
  }

  $effect(() => {
    document.addEventListener('click', onClickOutside)
    return () => document.removeEventListener('click', onClickOutside)
  })
</script>

{#if currentNote}
  <div class="editor-header">
    <input type="text" class="note-title" bind:value={title} oninput={onTitleInput} />
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

  {#key currentNote.id}
    <RichEditor value={content} onChange={onContentChange} />
  {/key}
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
  @media (max-width: 600px) {
    .note-title {
      font-size: 1.8rem;
    }
  }
</style>
