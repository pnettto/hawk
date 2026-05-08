<script lang="ts">
  import { tick } from 'svelte'
  import { notesStore } from '../../stores/notes'
  import type { NoteMetadata } from '../../types/models'

  let confirmingDeleteCid = $state<string | null>(null)
  let confirmingPermDeleteNid = $state<string | null>(null)
  let confirmingEmptyTrash = $state(false)
  let isCreatingCollection = $state(false)
  let newCollectionName = $state('')

  let activeNotes = $derived.by(() => {
    const s = $notesStore
    if (!s.selectedCid) return [] as NoteMetadata[]
    return s.allNotes
      .filter((n) => String(n.cid) === String(s.selectedCid) && !n.deletedAt)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  })

  let trashNotes = $derived.by(() => {
    const s = $notesStore
    if (!s.selectedCid) return [] as NoteMetadata[]
    return s.allNotes
      .filter((n) => String(n.cid) === String(s.selectedCid) && !!n.deletedAt)
      .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
  })

  async function startCreateCollection() {
    isCreatingCollection = true
    newCollectionName = ''
    await tick()
    document.querySelector<HTMLInputElement>('#inline-create-input')?.focus()
  }

  async function submitCreateCollection() {
    const name = newCollectionName.trim()
    isCreatingCollection = false
    if (name) await notesStore.createCollection(name)
    newCollectionName = ''
  }

  function onSelectCollection(e: Event) {
    const cid = (e.target as HTMLSelectElement).value
    notesStore.selectCollection(cid)
  }

  function startConfirmDelete(cid: string) {
    confirmingDeleteCid = cid
  }

  async function confirmDelete(cid: string) {
    confirmingDeleteCid = null
    await notesStore.deleteCollection(cid)
  }

  function startEmptyTrash() {
    if (!confirmingEmptyTrash) {
      confirmingEmptyTrash = true
      return
    }
    confirmingEmptyTrash = false
    notesStore.emptyTrash()
  }

  function startPermDelete(nid: string) {
    if (confirmingPermDeleteNid !== nid) {
      confirmingPermDeleteNid = nid
      return
    }
    confirmingPermDeleteNid = null
    notesStore.permanentlyDeleteNote(nid)
  }
</script>

<aside class="sidebar">
  <div class="panel-section">
    <div class="panel-header">
      <span>Library</span>
      <button class="btn-icon-tiny" title="New Collection" onclick={startCreateCollection}>+</button>
    </div>
    <div class="row">
      <select class="dropdown-nav" value={$notesStore.selectedCid ?? ''} onchange={onSelectCollection}>
        {#each $notesStore.collections as coll}
          <option value={coll.id}>{coll.name}</option>
        {/each}
      </select>
      {#if $notesStore.selectedCid}
        <button
          class="btn-icon-tiny"
          title="Delete collection"
          onclick={() => startConfirmDelete($notesStore.selectedCid!)}
        >×</button>
      {/if}
    </div>

    {#if isCreatingCollection}
      <form class="inline-create" onsubmit={(e) => { e.preventDefault(); submitCreateCollection() }}>
        <input
          id="inline-create-input"
          type="text"
          placeholder="Collection Name..."
          bind:value={newCollectionName}
          onblur={submitCreateCollection}
          onkeydown={(e) => { if (e.key === 'Escape') { isCreatingCollection = false; newCollectionName = '' } }}
        />
      </form>
    {/if}

    {#if confirmingDeleteCid}
      <div class="list-item confirming">
        <span class="confirm-msg">Delete collection?</span>
        <div class="confirm-actions">
          <button class="confirm-btn-text yes" onclick={() => confirmDelete(confirmingDeleteCid!)}>Yes</button>
          <button class="confirm-btn-text no" onclick={() => (confirmingDeleteCid = null)}>No</button>
        </div>
      </div>
    {/if}
  </div>

  <div class="panel-section list-pane">
    <div class="panel-header">
      <span>{$notesStore.showTrash ? 'Trash' : 'Notes'}</span>
      <div class="row">
        {#if $notesStore.showTrash}
          {#if confirmingEmptyTrash}
            <button class="confirm-btn-text yes" onclick={startEmptyTrash}>Empty?</button>
            <button class="confirm-btn-text no" onclick={() => (confirmingEmptyTrash = false)}>Cancel</button>
          {:else}
            <button class="btn-icon-tiny" title="Empty Trash" onclick={startEmptyTrash}>🧹</button>
          {/if}
        {:else}
          <button class="btn-icon-tiny" title="New Note" onclick={() => notesStore.createNote()}>+</button>
        {/if}
        <button
          class="btn-icon-tiny"
          class:active={$notesStore.showTrash}
          title="View Trash"
          onclick={() => notesStore.toggleTrash()}>🗑️</button>
      </div>
    </div>

    <div class="item-list">
      {#if $notesStore.showTrash}
        {#each trashNotes as n (n.id)}
          {#if confirmingPermDeleteNid === n.id}
            <div class="list-item confirming">
              <span class="confirm-msg">Delete forever?</span>
              <div class="confirm-actions">
                <button class="confirm-btn-text yes" onclick={() => startPermDelete(n.id)}>Yes</button>
                <button class="confirm-btn-text no" onclick={() => (confirmingPermDeleteNid = null)}>No</button>
              </div>
            </div>
          {:else}
            <div class="list-item trash-item">
              <span class="title-text">{n.title || 'Untitled'}</span>
              <div class="row">
                <button class="btn-icon-tiny restore" title="Restore" onclick={() => notesStore.restoreNote(n.id)}>↺</button>
                <button class="btn-icon-tiny perm-delete" title="Delete Permanently" onclick={() => (confirmingPermDeleteNid = n.id)}>×</button>
              </div>
            </div>
          {/if}
        {/each}
        {#if trashNotes.length === 0}
          <div class="empty-state small">Trash is empty</div>
        {/if}
      {:else}
        {#each activeNotes as n (n.id)}
          <div
            class="list-item note-item"
            class:active={n.id === $notesStore.selectedNid}
            role="button"
            tabindex="0"
            onclick={() => notesStore.selectNote(n.id)}
            onkeydown={(e) => { if (e.key === 'Enter') notesStore.selectNote(n.id) }}
          >
            <span class="title-text">{n.title || 'Untitled'}</span>
            <button
              class="btn-icon-tiny delete-note-btn"
              onclick={(e) => { e.stopPropagation(); notesStore.trashNote(n.id) }}
            >×</button>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</aside>

<style>
  .sidebar {
    width: 260px;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .panel-section { padding: 1.25rem 1rem; }
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.15rem;
    color: var(--muted);
    margin-bottom: 0.75rem;
  }
  .row { display: flex; gap: 0.25rem; align-items: flex-start; }
  .list-pane { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .item-list {
    flex: 1;
    overflow-y: auto;
    font-size: 1rem;
  }
  .list-item {
    cursor: pointer;
    border-radius: 8px;
    margin-bottom: 2px;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--muted);
    padding: 0.25rem 0.5rem;
  }
  .list-item:hover { color: var(--text); }
  .list-item.active { color: var(--accent); }
  .trash-item { font-style: italic; opacity: 0.8; }
  .delete-note-btn {
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .list-item:hover .delete-note-btn,
  .list-item:focus-within .delete-note-btn { opacity: 0.5; }
  .list-item:hover .delete-note-btn:hover { opacity: 1; color: #ff4444; }
  @media (hover: none) {
    .delete-note-btn { opacity: 0.5; }
  }
  .restore { font-size: 1.1rem !important; }
  .restore:hover { color: var(--accent) !important; }
  .perm-delete:hover { color: #ff4444; }
  .btn-icon-tiny {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 1.2rem;
    padding: 8px 12px;
    border-radius: 6px;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
    line-height: 1;
  }
  .btn-icon-tiny:hover { background: rgba(255, 255, 255, 0.1); color: var(--text); }
  .btn-icon-tiny.active { color: var(--accent); background: rgba(255, 255, 255, 0.05); }
  .empty-state.small { padding: 1rem; font-size: 0.8rem; color: var(--muted); font-style: italic; opacity: 0.5; text-align: center; }
  .confirming { gap: 0.5rem; padding: 0.4rem 0.5rem; }
  .confirm-msg { font-size: 0.8rem; color: #ff4444; font-weight: bold; }
  .confirm-actions { display: flex; gap: 0.75rem; }
  .confirm-btn-text {
    background: none;
    border: none;
    color: var(--text);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    opacity: 0.8;
  }
  .confirm-btn-text:hover { opacity: 1; background: rgba(255, 255, 255, 0.1); }
  .confirm-btn-text.yes { color: #ff4444; font-weight: 800; }
  .inline-create { padding: 0.4rem 0; }
  .inline-create input {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: var(--text);
    padding: 0.6rem 0.8rem;
    font-size: 0.9rem;
    font-family: inherit;
    outline: none;
  }
  .dropdown-nav {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 0.6rem 1rem;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.95rem;
    outline: none;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.75rem center;
    background-size: 1rem;
    margin-bottom: 0.5rem;
    transition: border-color 0.2s;
    flex: 1;
  }
  .dropdown-nav:focus { border-color: var(--accent); }
  .title-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 900px) {
    .sidebar { width: 100%; }
  }
</style>
