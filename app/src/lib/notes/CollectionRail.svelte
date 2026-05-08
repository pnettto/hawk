<script lang="ts">
  import { tick } from 'svelte'
  import { notesStore } from '../../stores/notes'

  let isCreating = $state(false)
  let newName = $state('')

  let counts = $derived.by(() => {
    const s = $notesStore
    const active = new Map<string, number>()
    let trashed = 0
    let allActive = 0
    for (const n of s.allNotes) {
      if (n.deletedAt) {
        trashed += 1
      } else {
        allActive += 1
        active.set(n.cid, (active.get(n.cid) ?? 0) + 1)
      }
    }
    return { active, trashed, allActive }
  })

  async function startCreate() {
    isCreating = true
    newName = ''
    await tick()
    document.querySelector<HTMLInputElement>('#rail-create-input')?.focus()
  }

  async function submitCreate() {
    if (!isCreating) return
    const name = newName.trim()
    isCreating = false
    newName = ''
    if (name) await notesStore.createCollection(name)
  }

  function onRailRowKeydown(e: KeyboardEvent, action: () => void) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      action()
    }
  }
</script>

<aside class="rail">
  <nav class="rail-section">
    <div class="rail-row pseudo"
      class:active={$notesStore.view === 'all'}
      role="button"
      tabindex="0"
      onclick={() => notesStore.selectAllNotes()}
      onkeydown={(e) => onRailRowKeydown(e, () => notesStore.selectAllNotes())}
    >
      <span class="dot" aria-hidden="true">◇</span>
      <span class="rail-label">All Notes</span>
      <span class="rail-count">{counts.allActive}</span>
    </div>
  </nav>

  <div class="rail-divider" aria-hidden="true"></div>

  <nav class="rail-section grow">
    <div class="rail-section-header">Collections</div>
    {#each $notesStore.collections as coll (coll.id)}
      <div
        class="rail-row"
        class:active={$notesStore.view === 'collection' && $notesStore.selectedCid === coll.id}
        role="button"
        tabindex="0"
        onclick={() => notesStore.selectCollection(coll.id)}
        onkeydown={(e) => onRailRowKeydown(e, () => notesStore.selectCollection(coll.id))}
      >
        <span class="dot" aria-hidden="true">●</span>
        <span class="rail-label">{coll.name}</span>
        <span class="rail-count">{counts.active.get(coll.id) ?? 0}</span>
      </div>
    {/each}

    {#if isCreating}
      <form class="rail-rename" onsubmit={(e) => { e.preventDefault(); submitCreate() }}>
        <input
          id="rail-create-input"
          type="text"
          placeholder="Collection name…"
          bind:value={newName}
          onblur={submitCreate}
          onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); isCreating = false; newName = '' } }}
        />
      </form>
    {:else}
      <button class="rail-new" onclick={startCreate}>
        <span aria-hidden="true">+</span>
        <span>New collection</span>
      </button>
    {/if}
  </nav>

  <div class="rail-divider" aria-hidden="true"></div>

  <nav class="rail-section">
    <div class="rail-row pseudo"
      class:active={$notesStore.view === 'trash'}
      role="button"
      tabindex="0"
      onclick={() => notesStore.selectTrash()}
      onkeydown={(e) => onRailRowKeydown(e, () => notesStore.selectTrash())}
    >
      <span class="dot" aria-hidden="true">⌫</span>
      <span class="rail-label">Trash</span>
      <span class="rail-count">{counts.trashed}</span>
    </div>
  </nav>
</aside>

<style>
  .rail {
    width: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 1rem 0.5rem;
    gap: 0.5rem;
    font-family: var(--font-ui, inherit);
    font-size: 0.9rem;
  }
  .rail-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rail-section.grow {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .rail-section-header {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    opacity: 0.7;
    padding: 0.5rem 0.75rem 0.25rem;
  }
  .rail-divider {
    height: 1px;
    background: var(--line);
    opacity: 0.5;
    margin: 0.25rem 0.5rem;
  }
  .rail-row {
    position: relative;
    display: grid;
    grid-template-columns: 18px 1fr auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    cursor: pointer;
    color: var(--muted);
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .rail-row:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.04);
  }
  .rail-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .rail-row.active {
    color: var(--text);
    background: rgba(230, 184, 77, 0.1);
  }
  .rail-row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .dot {
    font-size: 0.7rem;
    color: var(--muted);
    opacity: 0.6;
    text-align: center;
  }
  .rail-row.active .dot { color: var(--accent); opacity: 1; }
  .rail-row.pseudo .dot { font-size: 0.85rem; }
  .rail-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .rail-count {
    font-size: 0.7rem;
    color: var(--muted);
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
  }

  .rail-rename {
    padding: 0;
    margin: 2px 0;
  }
  .rail-rename input {
    width: 100%;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--accent);
    border-radius: 8px;
    color: var(--text);
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    font-family: inherit;
    outline: none;
  }
  .rail-new {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    margin-top: 0.5rem;
    background: none;
    border: 1px dashed var(--line);
    border-radius: 8px;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.85rem;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  .rail-new:hover {
    border-color: var(--accent);
    color: var(--text);
    background: rgba(255, 255, 255, 0.03);
  }
  .rail-new span:first-child {
    font-size: 1rem;
    line-height: 1;
  }

  @media (max-width: 900px) {
    .rail {
      width: 100%;
      flex-direction: row;
      flex-wrap: nowrap;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 0.5rem 0.75rem;
      gap: 0.4rem;
      border-bottom: 1px solid var(--line);
      flex-shrink: 0;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .rail::-webkit-scrollbar { display: none; }
    .rail-section { flex-direction: row; gap: 0.4rem; align-items: center; }
    .rail-section.grow { flex: 0 0 auto; overflow: visible; min-height: auto; flex-direction: row; }
    .rail-section-header { display: none; }
    .rail-divider {
      display: block;
      width: 1px;
      height: 22px;
      margin: 0 0.25rem;
      background: var(--line);
      opacity: 0.5;
      flex-shrink: 0;
    }
    .rail-row {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 0.85rem;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.025);
      white-space: nowrap;
      width: auto;
      max-width: none;
      min-height: 36px;
    }
    .rail-row.active {
      background: rgba(230, 184, 77, 0.15);
      border-color: var(--accent);
      color: var(--text);
    }
    .rail-row.active::before { display: none; }
    .rail-row .dot { display: none; }
    .rail-row.pseudo .dot { display: inline; font-size: 0.85rem; }
    .rail-label { font-size: 0.9rem; }
    .rail-new {
      flex: 0 0 auto;
      margin-top: 0;
      padding: 0.5rem 0.85rem;
      border-radius: 999px;
      white-space: nowrap;
      min-height: 36px;
    }
    .rail-rename { flex: 0 0 auto; padding: 0; margin: 0; }
    .rail-rename input {
      width: 180px;
      padding: 0.45rem 0.75rem;
      font-size: 0.9rem;
    }
  }
</style>
