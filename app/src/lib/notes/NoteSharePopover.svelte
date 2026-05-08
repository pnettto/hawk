<script lang="ts">
  import { notesStore } from '../../stores/notes'
  import { apiOrigin } from '../../api/client'
  import type { Note } from '../../types/models'

  interface Props {
    note: Note
    onClose: () => void
  }
  let { note, onClose }: Props = $props()

  let copiedKind = $state<'page' | 'api' | null>(null)

  async function setShare(value: boolean) {
    notesStore.applyEdit(note.id, { isPublic: value })
    // Bypass the debounce so the share link is live immediately.
    await notesStore.saveNoteImmediate(note.id)
  }

  async function copy(text: string, kind: 'page' | 'api') {
    try {
      await navigator.clipboard.writeText(text)
      copiedKind = kind
      setTimeout(() => (copiedKind = null), 1500)
    } catch (e) {
      console.error('copy failed', e)
    }
  }

  let pageUrl = $derived(`${apiOrigin()}/shared/${note.id}`)
  let apiUrl = $derived(`${apiOrigin()}/api/public/notes/${note.id}`)
</script>

<div class="share-popover">
  <p class="hint">
    {note.isPublic
      ? 'Anyone with the link can view this note.'
      : 'Make this note public to share it.'}
  </p>

  {#if note.isPublic}
    <div class="grid">
      <label for="share-page">Public Page</label>
      <input id="share-page" class="share-link-input" readonly value={pageUrl} />
      <button class="btn-primary" class:copied={copiedKind === 'page'} onclick={() => copy(pageUrl, 'page')}>
        {copiedKind === 'page' ? '✓ Copied' : 'Copy'}
      </button>

      <label for="share-api">API Endpoint</label>
      <input id="share-api" class="share-link-input" readonly value={apiUrl} />
      <button class="btn-primary" class:copied={copiedKind === 'api'} onclick={() => copy(apiUrl, 'api')}>
        {copiedKind === 'api' ? '✓ Copied' : 'Copy'}
      </button>
    </div>
    <div class="actions">
      <button class="btn-secondary" onclick={() => { setShare(false); onClose() }}>
        Disable Sharing (Make Private)
      </button>
    </div>
  {:else}
    <div class="actions">
      <button class="btn-primary full" onclick={() => setShare(true)}>Enable Public Link</button>
    </div>
  {/if}
</div>

<style>
  .share-popover {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.5rem;
    background: var(--panel);
    border: 1px solid var(--line);
    padding: 1rem;
    border-radius: 8px;
    z-index: 100;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    width: 320px;
  }
  .hint {
    margin: 0 0 0.75rem 0;
    font-size: 0.85rem;
    color: var(--text);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  label {
    grid-column: 1 / -1;
    font-size: 0.75rem;
    color: var(--muted);
    margin-bottom: -0.25rem;
    margin-top: 0.5rem;
  }
  label:first-of-type { margin-top: 0; }
  .share-link-input {
    width: 100%;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--line);
    padding: 0.5rem;
    color: var(--text);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
  .actions {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--line);
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .btn-primary {
    background: var(--accent);
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    color: #000;
    font-weight: bold;
    cursor: pointer;
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .btn-primary.full { width: 100%; font-size: 0.8rem; }
  .btn-primary.copied { background: #00d68f; }
  .btn-secondary {
    background: none;
    border: 1px solid var(--line);
    padding: 0.5rem 1rem;
    border-radius: 6px;
    color: var(--text);
    cursor: pointer;
    width: 100%;
    font-size: 0.75rem;
  }
</style>
