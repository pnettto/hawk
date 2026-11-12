<script lang="ts">
  import { tick } from 'svelte'
  import { notesStore, tagCounts, isDayDraft, type NotesFilter, type NotesSort } from '../../stores/notes'

  // The Notepad list's view picker: All notes, Notepad notes, Journal notes,
  // untagged notes, one #tag, or Trash, plus the sort order for views
  // that are listed by date.

  let open = $state(false)
  let sel = $state(0)
  let rootEl = $state<HTMLDivElement | null>(null)
  let menuEl = $state<HTMLDivElement | null>(null)

  let counts = $derived.by(() => {
    let all = 0
    let notepad = 0
    let day = 0
    let trash = 0
    let untagged = 0
    for (const n of $notesStore.allNotes) {
      if (n.deletedAt) trash++
      else if (!isDayDraft(n)) {
        all++
        if (n.day) day++
        else notepad++
        if (!n.tags?.length) untagged++
      }
    }
    return { all, notepad, day, trash, untagged, tags: tagCounts($notesStore.allNotes) }
  })

  type Item =
    | { filter: NotesFilter; label: string; count: number; key: string }
    | { sort: NotesSort; label: string; key: string }

  // Journal notes sort by day and Trash by deletion, so only the others offer a sort.
  let sortable = $derived(
    $notesStore.filter.kind === 'all' ||
      $notesStore.filter.kind === 'notepad' ||
      $notesStore.filter.kind === 'tag' ||
      $notesStore.filter.kind === 'untagged',
  )

  let items = $derived.by<Item[]>(() => {
    const fixed: Item[] = [
      { filter: { kind: 'all' }, label: 'All notes', count: counts.all, key: 'all' },
      { filter: { kind: 'notepad' }, label: 'Notepad notes', count: counts.notepad, key: 'notepad' },
      { filter: { kind: 'day' }, label: 'Journal notes', count: counts.day, key: 'day' },
      { filter: { kind: 'untagged' }, label: 'Not tagged', count: counts.untagged, key: 'untagged' },
    ]
    const tags: Item[] = counts.tags.map(([tag, count]) => ({
      filter: { kind: 'tag', tag },
      label: `#${tag}`,
      count,
      key: `tag:${tag}`,
    }))
    const trash: Item = { filter: { kind: 'trash' }, label: 'Trash', count: counts.trash, key: 'trash' }
    const sorts: Item[] = sortable
      ? [
          { sort: 'changed', label: 'Last changed', key: 'sort:changed' },
          { sort: 'added', label: 'Date added', key: 'sort:added' },
        ]
      : []
    return [...fixed, ...tags, trash, ...sorts]
  })

  const kindOf = (item: Item) => ('sort' in item ? 'sort' : item.filter.kind)

  const isCurrent = (item: Item) =>
    'sort' in item ? item.sort === $notesStore.sort : item.key === keyOf($notesStore.filter)

  let current = $derived.by(() => {
    const f = $notesStore.filter
    if (f.kind === 'tag') return { label: `#${f.tag}`, count: counts.tags.find(([t]) => t === f.tag)?.[1] ?? 0 }
    if (f.kind === 'notepad') return { label: 'Notepad notes', count: counts.notepad }
    if (f.kind === 'untagged') return { label: 'Not tagged', count: counts.untagged }
    if (f.kind === 'day') return { label: 'Journal notes', count: counts.day }
    if (f.kind === 'trash') return { label: 'Trash', count: counts.trash }
    return { label: 'All notes', count: counts.all }
  })

  const keyOf = (f: NotesFilter) => (f.kind === 'tag' ? `tag:${f.tag}` : f.kind)

  async function toggle() {
    open = !open
    if (!open) return
    sel = Math.max(0, items.findIndex((i) => i.key === keyOf($notesStore.filter)))
    await tick()
    menuEl?.focus()
    rootEl?.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' })
  }

  function pick(item: Item) {
    open = false
    if ('sort' in item) notesStore.setSort(item.sort)
    else notesStore.setFilter(item.filter)
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
      <div class="items" role="listbox" aria-label="Show" tabindex="-1" bind:this={menuEl} onkeydown={onKeydown}>
        {#each items as item, i (item.key)}
          {#if kindOf(item) === 'trash'}
            {#if counts.tags.length === 0}
              <div class="hint">Type <code>#word</code> in a note to tag it.</div>
            {/if}
            <div class="divider" aria-hidden="true"></div>
          {:else if 'sort' in item && i > 0 && kindOf(items[i - 1]) !== 'sort'}
            <div class="divider" aria-hidden="true"></div>
            <div class="section">Sort by</div>
          {/if}
          <button
            type="button"
            class="item"
            class:selected={i === sel}
            class:current={isCurrent(item)}
            role="option"
            aria-selected={isCurrent(item)}
            tabindex="-1"
            onmousemove={() => (sel = i)}
            onclick={() => pick(item)}
          >
            <span class="item-label">{item.label}</span>
            {#if 'count' in item}
              <span class="item-count">{item.count}</span>
            {/if}
          </button>
        {/each}
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
  .items:focus { outline: none; }
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
  .hint { padding: 8px 10px; font-size: 0.8rem; color: var(--muted); }
  .hint code { font-family: var(--font-mono); font-size: 0.75rem; }
  @media (pointer: coarse) {
    .item { padding: 10px 12px; }
  }
</style>
