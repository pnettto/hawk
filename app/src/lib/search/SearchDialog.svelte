<script lang="ts">
  import { tick } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { searchStore, loadRecent, rememberQuery } from '../../stores/search'
  import { notesStore } from '../../stores/notes'
  import { logsStore } from '../../stores/logs'
  import { appStore } from '../../stores/app'
  import { navigate } from '../../router/sync'
  import type { SearchKind } from '../../api/search'
  import type { NoteHit, Range, TaskHit } from './match'
  import { LOCK_ICON } from '../notes/hiddenMenu'

  type Item = { type: 'note'; hit: NoteHit } | { type: 'task'; hit: TaskHit }

  const KINDS: { value: SearchKind; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'notes', label: 'Notes' },
    { value: 'tasks', label: 'Tasks' },
  ]

  let inputEl = $state<HTMLInputElement | null>(null)
  let listEl = $state<HTMLElement | null>(null)
  let active = $state(0)
  let recent = $state<string[]>([])
  let showLoading = $state(false)

  let s = $derived($searchStore)
  // Narrow values, so effects rerun only when these change, not on every
  // store update.
  let isOpen = $derived($searchStore.open)
  let loading = $derived($searchStore.loading)
  let results = $derived($searchStore.results)
  let notes = $derived(s.results?.notes ?? [])
  let tasks = $derived(s.results?.tasks ?? [])
  let items: Item[] = $derived([
    ...notes.map((hit): Item => ({ type: 'note', hit })),
    ...tasks.map((hit): Item => ({ type: 'task', hit })),
  ])
  let typed = $derived(s.query.trim() !== '')

  // Opening: save pending edits so they're searchable, focus the input, and
  // put focus back where it was on close.
  $effect(() => {
    if (!isOpen) return
    const opener = document.activeElement as HTMLElement | null
    recent = loadRecent()
    active = 0
    logsStore.flushOnHide()
    void notesStore.flushSaves().finally(() => searchStore.refresh())
    void tick().then(() => inputEl?.select())
    return () => opener?.focus?.()
  })

  // A quiet loading state, only once a request has run for a while.
  $effect(() => {
    if (!loading) {
      showLoading = false
      return
    }
    const t = setTimeout(() => (showLoading = true), 300)
    return () => clearTimeout(t)
  })

  // New results: start at the top.
  $effect(() => {
    void results
    active = 0
  })

  function close() {
    searchStore.close()
  }

  function open(item: Item, { dayOnly = false } = {}) {
    rememberQuery(s.query)
    close()
    if (item.type === 'note') {
      const h = item.hit
      if (h.day) {
        appStore.setFocusDayNote(h.id)
        navigate({ page: 'journal', date: h.day, tab: 'notes' })
      } else {
        navigate({ page: 'notes', nid: h.id })
      }
    } else {
      const h = item.hit
      navigate({ page: 'journal', date: h.date, tab: 'tasks', ...(dayOnly ? {} : { task: h.id }) })
    }
  }

  async function move(delta: number) {
    if (!items.length) return
    active = (active + delta + items.length) % items.length
    await tick()
    listEl?.querySelector(`#search-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      void move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      void move(-1)
    } else if (e.key === 'Enter' && !e.isComposing) {
      const item = items[active]
      if (!item) return
      e.preventDefault()
      open(item, { dayOnly: e.metaKey || e.ctrlKey })
    }
  }

  function useRecent(q: string) {
    searchStore.setQuery(q)
    inputEl?.focus()
  }

  // Text cut into plain and <mark> parts.
  function parts(text: string, ranges: Range[]) {
    const out: { text: string; mark: boolean }[] = []
    let at = 0
    for (const [a, b] of ranges) {
      if (a > at) out.push({ text: text.slice(at, a), mark: false })
      out.push({ text: text.slice(a, b), mark: true })
      at = b
    }
    if (at < text.length) out.push({ text: text.slice(at), mark: false })
    return out
  }

  const taskMeta = (h: TaskHit) =>
    [taskDate(h.date), h.time, h.parentText && `in ${h.parentText}`].filter(Boolean).join(' · ')
  const toDate = (d: string) => new Date(d + 'T12:00:00')
  const dayLabel = (d: string) => toDate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const taskDate = (d: string) =>
    toDate(d).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(d.slice(0, 4) === String(new Date().getFullYear()) ? {} : { year: 'numeric' }),
    })
</script>

{#snippet marked(text: string, ranges: Range[])}
  {#each parts(text, ranges) as p, i (i)}{#if p.mark}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}
{/snippet}

{#if s.open}
  <div class="search-layer" transition:fade={{ duration: 120 }}>
    <button type="button" class="scrim" aria-label="Close search" tabindex="-1" onclick={close}></button>
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      tabindex="-1"
      onkeydown={onKey}
      transition:scale={{ start: 0.98, duration: 160, easing: cubicOut }}
    >
      <div class="head">
        <svg class="glass" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" />
        </svg>
        <input
          bind:this={inputEl}
          type="search"
          placeholder="Search notes and tasks"
          aria-label="Search notes and tasks"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="search-results"
          aria-activedescendant={items.length ? `search-opt-${active}` : undefined}
          autocomplete="off"
          spellcheck="false"
          value={s.query}
          oninput={(e) => searchStore.setQuery(e.currentTarget.value)}
        />
        {#if showLoading}<span class="spinner" aria-label="Searching"></span>{/if}
        <button type="button" class="close" onclick={close}>Close</button>
      </div>
      <div class="segmented" role="radiogroup" aria-label="Search in">
        {#each KINDS as k (k.value)}
          <button
            type="button"
            role="radio"
            aria-checked={s.kind === k.value}
            onclick={() => {
              searchStore.setKind(k.value)
              inputEl?.focus()
            }}>{k.label}</button
          >
        {/each}
      </div>

      <div class="body" bind:this={listEl}>
        {#if !typed}
          {#if recent.length}
            <div class="group-label">Recent</div>
            <ul class="recent">
              {#each recent as q (q)}
                <li><button type="button" onclick={() => useRecent(q)}>{q}</button></li>
              {/each}
            </ul>
          {/if}
          <p class="hint">Use #tag to filter by tag and "quotes" for an exact phrase.</p>
        {:else if s.error}
          <p class="state">Couldn’t search right now.</p>
        {:else if s.results && !items.length}
          <p class="state">Nothing matches “{s.query.trim()}”</p>
        {:else if s.results}
          <div id="search-results" role="listbox" aria-label="Results">
            {#if notes.length}
              <div class="group-label" role="presentation">Notes</div>
            {/if}
            {#each items as item, i (item.type + (item.type === 'task' ? item.hit.date : '') + item.hit.id)}
              {#if item.type === 'task' && i === notes.length}
                <div class="group-label" role="presentation">Tasks</div>
              {/if}
              <div
                id="search-opt-{i}"
                role="option"
                tabindex="-1"
                aria-selected={i === active}
                class="row"
                class:active={i === active}
                onpointermove={() => (active = i)}
                onclick={(e) => open(item, { dayOnly: e.metaKey || e.ctrlKey })}
                onkeydown={() => {}}
              >
                {#if item.type === 'note'}
                  {@const h = item.hit}
                  <div class="line">
                    {#if h.hidden}
                      <svg class="lock" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-label="Hidden">
                        {#each LOCK_ICON as d (d)}<path {d} />{/each}
                      </svg>
                    {/if}
                    <span class="title">
                      {#if h.title.trim()}{@render marked(h.title, h.titleMatches)}{:else}Untitled{/if}
                    </span>
                    {#if h.day}<span class="meta">Day note · {dayLabel(h.day)}</span>{/if}
                  </div>
                  {#if h.snippet}
                    <div class="snippet">{@render marked(h.snippet, h.snippetMatches)}</div>
                  {/if}
                  {#if h.tags.length}
                    <div class="tags">
                      {#each h.tags.slice(0, 3) as t (t)}<span class="tag">#{t}</span>{/each}
                    </div>
                  {/if}
                {:else}
                  {@const h = item.hit}
                  <div class="line">
                    <span class="check" class:done={h.done} aria-label={h.done ? 'Done' : 'Open'}></span>
                    <span class="title" class:done-text={h.done}>{@render marked(h.text, h.textMatches)}</span>
                  </div>
                  <div class="meta task-meta">
                    {taskMeta(h)}
                  </div>
                  {#if h.comment}
                    <div class="snippet">{@render marked(h.comment, h.commentMatches)}</div>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
          {#if s.results.truncated}
            <p class="hint">Showing the best matches. Add a word to narrow it down.</p>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .search-layer {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    font-family: var(--font-ui);
  }
  .scrim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: var(--scrim);
    cursor: default;
  }
  .dialog {
    position: relative;
    width: min(620px, calc(100vw - 2rem));
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
    outline: none;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.6rem 0.4rem 0.8rem;
  }
  .glass { width: 15px; height: 15px; color: var(--muted); flex-shrink: 0; opacity: 0.7; }
  input {
    flex: 1;
    min-width: 0;
    height: var(--h-md);
    padding: 0 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--input-bg);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
  }
  input::placeholder { color: var(--input-placeholder); }
  input:focus-visible { outline: none; border-color: var(--accent); }
  input::-webkit-search-cancel-button { display: none; }
  .close {
    background: none;
    border: 0;
    color: var(--muted);
    font: inherit;
    font-size: 0.75rem;
    padding: 0.35rem 0.5rem;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .close:hover { color: var(--text); background: var(--glass-dark); }
  .close:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--glass);
    border-top-color: var(--muted);
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .segmented {
    display: inline-flex;
    align-self: flex-start;
    margin: 0 0.8rem 0.5rem;
    padding: 2px;
    border-radius: var(--r-md);
    background: var(--glass-dark);
  }
  .segmented button {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.75rem;
    padding: 0.3rem 0.8rem;
    border-radius: var(--r-sm);
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .segmented button:hover { color: var(--text); }
  .segmented button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .segmented button[aria-checked='true'] { color: var(--accent); background: var(--glass); }
  .body {
    overflow-y: auto;
    border-top: 1px solid var(--border-subtle);
    padding: 0.3rem 0.4rem 0.5rem;
    min-height: 4rem;
  }
  .group-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    opacity: 0.7;
    padding: 0.6rem 0.5rem 0.3rem;
  }
  .row {
    padding: 0.45rem 0.5rem;
    border-radius: var(--r-sm);
    cursor: pointer;
    color: var(--text);
  }
  .row.active { background: var(--glass-dark); }
  .line { display: flex; align-items: center; gap: 0.45rem; min-width: 0; }
  .title {
    font-size: 0.88rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .done-text { color: var(--muted); text-decoration: line-through; }
  .meta { font-size: 0.72rem; color: var(--muted); opacity: 0.8; white-space: nowrap; }
  .task-meta { padding-left: 1.3rem; margin-top: 0.1rem; }
  .snippet {
    font-size: 0.78rem;
    color: var(--muted);
    margin-top: 0.15rem;
    line-height: 1.45;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .line + .snippet, .task-meta + .snippet { padding-left: 0; }
  .tags { display: flex; gap: 0.3rem; margin-top: 0.25rem; }
  .tag {
    font-size: 0.68rem;
    color: var(--muted);
    background: var(--glass-dark);
    border-radius: var(--r-xs);
    padding: 0.05rem 0.35rem;
  }
  .lock { width: 13px; height: 13px; color: var(--muted); flex-shrink: 0; }
  .check {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid var(--muted);
    flex-shrink: 0;
    opacity: 0.8;
  }
  .check.done { background: var(--accent); border-color: var(--accent); }
  mark {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    color: inherit;
    border-radius: 2px;
  }
  .recent { list-style: none; margin: 0; padding: 0; }
  .recent button {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    padding: 0.4rem 0.5rem;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .recent button:hover { background: var(--glass-dark); }
  .recent button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .hint, .state {
    font-size: 0.78rem;
    color: var(--muted);
    padding: 0.6rem 0.5rem;
    margin: 0;
  }
  .state { padding: 1.2rem 0.5rem; text-align: center; }
  @media (max-width: 600px) {
    .search-layer { padding-top: 0; }
    .dialog {
      width: 100vw;
      height: 100dvh;
      max-height: none;
      border: 0;
      border-radius: 0;
    }
    .body { flex: 1; }
  }
  @media (pointer: coarse) {
    .row { padding: 0.65rem 0.5rem; }
    .recent button { min-height: 40px; }
  }
</style>
