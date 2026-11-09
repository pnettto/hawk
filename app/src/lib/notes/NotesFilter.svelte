<script lang="ts">
  import { tick } from 'svelte'
  import { notesStore, tagCounts, isDayDraft, type NotesFilter } from '../../stores/notes'

  // The Notepad list's view picker: All notes, Day Notes, one #tag, or Trash.

  let open = $state(false)
  let query = $state('')
  let sel = $state(0)
  let rootEl = $state<HTMLDivElement | null>(null)
  let inputEl = $state<HTMLInputElement | null>(null)

  let counts = $derived.by(() => {
    let all = 0
    let day = 0
    let trash = 0
    for (const n of $notesStore.allNotes) {
      if (n.deletedAt) trash++
      else if (!isDayDraft(n)) {
        all++
        if (n.day) day++
      }
    }
    return { all, day, trash, tags: tagCounts($notesStore.allNotes) }
  })

  type Item = { filter: NotesFilter; label: string; count: number; key: string }

  let items = $derived.by<Item[]>(() => {
    const q = query.trim().replace(/^#/, '').toLowerCase()
    const fixed: Item[] = [
      { filter: { kind: 'all' }, label: 'All notes', count: counts.all, key: 'all' },
      { filter: { kind: 'day' }, label: 'Day Notes', count: counts.day, key: 'day' },
    ]
    const tags: Item[] = counts.tags.map(([tag, count]) => ({
      filter: { kind: 'tag', tag },
      label: `#${tag}`,
      count,
      key: `tag:${tag}`,
    }))
    const trash: Item = { filter: { kind: 'trash' }, label: 'Trash', count: counts.trash, key: 'trash' }
    if (!q) return [...fixed, ...tags, trash]
    return [...fixed, ...tags, trash].filter((i) => i.label.toLowerCase().includes(q))
  })

  let current = $derived.by(() => {
    const f = $notesStore.filter
    if (f.kind === 'tag') return { label: `#${f.tag}`, count: counts.tags.find(([t]) => t === f.tag)?.[1] ?? 0 }
    if (f.kind === 'day') return { label: 'Day Notes', count: counts.day }
    if (f.kind === 'trash') return { label: 'Trash', count: counts.trash }
    return { label: 'All notes', count: counts.all }
  })

  const keyOf = (f: NotesFilter) => (f.kind === 'tag' ? `tag:${f.tag}` : f.kind)

  async function toggle() {
    open = !open
    if (!open) return
    query = ''
    sel = Math.max(0, items.findIndex((i) => i.key === keyOf($notesStore.filter)))
    await tick()
    inputEl?.focus()
    rootEl?.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' })
  }

  function pick(item: Item) {
    open = false
    notesStore.setFilter(item.filter)
    rootEl?.querySelector<HTMLElement>('.filter-btn')?.focus()
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing) return
    const n = items.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (n) sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
      tick().then(() => rootEl?.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' }))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items[sel]) pick(items[sel])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      open = false
      rootEl?.querySelector<HTMLElement>('.filter-btn')?.focus()
    }
  }

  $effect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootEl && !e.composedPath().includes(rootEl)) open = false
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  })
</script>

<div class="notes-filter" bind:this={rootEl}>
  <button
    type="button"
    class="filter-btn"
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={toggle}
  >
    <span class="filter-label">{current.label}</span>
    <span class="filter-count">{current.count}</span>
    <svg class="caret" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
  </button>

  {#if open}
    <div class="menu">
      <input
        bind:this={inputEl}
        bind:value={query}
        class="search"
        type="text"
        placeholder="Find a tag…"
        aria-label="Find a tag"
        oninput={() => (sel = 0)}
        onkeydown={onKeydown}
      />
      <div class="items" role="listbox" aria-label="Show">
        {#each items as item, i (item.key)}
          {#if item.filter.kind === 'tag' && (i === 0 || items[i - 1].filter.kind !== 'tag')}
            <div class="section">Tags</div>
          {:else if item.filter.kind === 'trash' && i > 0}
            <div class="divider" aria-hidden="true"></div>
          {/if}
          <button
            type="button"
            class="item"
            class:selected={i === sel}
            class:current={item.key === keyOf($notesStore.filter)}
            role="option"
            aria-selected={item.key === keyOf($notesStore.filter)}
            onmousemove={() => (sel = i)}
            onclick={() => pick(item)}
          >
            <span class="item-label">{item.label}</span>
            <span class="item-count">{item.count}</span>
          </button>
        {:else}
          <div class="none">No tag matches “{query}”.</div>
        {/each}
        {#if !query && counts.tags.length === 0}
          <div class="hint">Type <code>#word</code> in a note to tag it.</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .notes-filter { position: relative; min-width: 0; margin-left: -0.5rem; }
  .filter-btn {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
    max-width: 100%;
    padding: 4px 0.5rem;
    border: none;
    border-radius: 8px;
    background: none;
    color: var(--text);
    cursor: pointer;
    font-family: inherit;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .filter-btn:hover,
  .filter-btn[aria-expanded='true'] { background: var(--glass-dark); }
  .filter-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .filter-label {
    font-size: 1rem;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .filter-count {
    font-size: 0.75rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .caret { align-self: center; color: var(--muted); flex-shrink: 0; }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: var(--z-popover);
    width: 260px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-pop);
    animation: popIn var(--dur-pop) var(--ease-spring);
    transform-origin: top left;
    overflow: hidden;
  }
  .search {
    display: block;
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--text);
    font-family: inherit;
    font-size: 0.85rem;
    outline: none;
  }
  .search::placeholder { color: var(--muted); opacity: 0.7; }
  .items { max-height: min(360px, 60vh); overflow-y: auto; padding: 6px; }
  .section {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    padding: 8px 10px 4px;
  }
  .divider { height: 1px; background: var(--line); margin: 6px 4px; }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.85rem;
  }
  .item.selected { background: var(--glass); }
  .item.current .item-label { color: var(--accent); font-weight: 600; }
  .item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-count { font-size: 0.72rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .none,
  .hint { padding: 8px 10px; font-size: 0.8rem; color: var(--muted); }
  .hint code { font-family: var(--font-mono); font-size: 0.75rem; }
  @media (pointer: coarse) {
    .item { padding: 10px 12px; }
  }
</style>
