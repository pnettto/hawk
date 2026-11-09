<script lang="ts">
  import { tick } from 'svelte'
  import { fade } from 'svelte/transition'
  import { appStore } from '../../stores/app'
  import { logsStore, sortNotes, DEFAULT_NOTE_ID } from '../../stores/logs'
  import { preferencesStore } from '../../stores/preferences'
  import { formatDate } from '../../utils/date'
  import RichEditor from '../editor/RichEditor.svelte'
  import HistoryPopover from '../ui/HistoryPopover.svelte'
  import type { DayNote } from '../../types/models'

  let dateStr = $derived(formatDate($appStore.selectedDate))
  let loaded = $derived(dateStr in $logsStore.byDate)
  let view = $derived($preferencesStore.dayNotesView)

  // A day always shows at least one note. Until something is typed it only
  // exists locally, under a fixed id (see DEFAULT_NOTE_ID).
  let notes: DayNote[] = $derived.by(() => {
    const list = sortNotes($logsStore.byDate[dateStr]?.notes ?? [])
    return list.length
      ? list
      : [{ id: DEFAULT_NOTE_ID, title: '', markdown: '', order: 0, rev: 0, updatedAt: 0 }]
  })

  const label = (n: DayNote, i: number) => n.title.trim() || (notes.length > 1 ? `Note ${i + 1}` : 'Note')

  // Active tab, remembered per day for the session.
  let activeByDate = $state<Record<string, string>>({})
  let activeId = $derived.by(() => {
    const want = activeByDate[dateStr]
    return notes.some((n) => n.id === want) ? want : notes[0].id
  })
  let activeIndex = $derived(notes.findIndex((n) => n.id === activeId))
  const select = (id: string) => (activeByDate = { ...activeByDate, [dateStr]: id })

  async function addNote() {
    const id = logsStore.addNote(dateStr)
    select(id)
    await tick()
    if (view === 'tabs') startRename(id)
    else document.querySelector<HTMLInputElement>(`[data-note-title="${id}"]`)?.focus()
  }

  function removeNote(id: string) {
    const idx = notes.findIndex((n) => n.id === id)
    const fallback = notes[idx - 1] ?? notes[idx + 1]
    if (fallback) select(fallback.id)
    logsStore.deleteNote(dateStr, id)
  }

  // ---- tab rename ----------------------------------------------------------

  let renaming = $state<string | null>(null)
  let renameValue = $state('')

  async function startRename(id: string) {
    const n = notes.find((x) => x.id === id)
    renaming = id
    renameValue = n?.title ?? ''
    await tick()
    const el = document.querySelector<HTMLInputElement>('.tab-rename')
    el?.focus()
    el?.select()
  }

  function commitRename() {
    if (!renaming) return
    const id = renaming
    renaming = null
    const n = notes.find((x) => x.id === id)
    if (n && n.title !== renameValue.trim()) logsStore.renameNote(dateStr, id, renameValue.trim())
  }

  function onTabKeydown(e: KeyboardEvent, i: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = notes[(i + (e.key === 'ArrowRight' ? 1 : -1) + notes.length) % notes.length]
      select(next.id)
      tick().then(() => document.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus())
    } else if (e.key === 'F2' || (e.key === 'Enter' && e.altKey)) {
      e.preventDefault()
      startRename(notes[i].id)
    }
  }

  // ---- history -------------------------------------------------------------

  let historyFor = $state<string | null>(null)
  let historyAnchor = $state<HTMLElement | null>(null)

  function openHistory(e: MouseEvent, id: string) {
    historyAnchor = e.currentTarget as HTMLElement
    historyFor = historyFor === id ? null : id
  }

  // Checkpoint a note's history when focus leaves it.
  function checkpoint(node: HTMLElement, key: { date: string; id: string }) {
    let cur = key
    const onOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (next && node.contains(next)) return
      setTimeout(() => void logsStore.noteSession(cur.date, cur.id).flush({ snapshot: true }), 0)
    }
    node.addEventListener('focusout', onOut)
    return {
      update(k: { date: string; id: string }) {
        cur = k
      },
      destroy() {
        node.removeEventListener('focusout', onOut)
      },
    }
  }
</script>

{#snippet historyButton(id: string)}
  <button
    type="button"
    class="icon-btn ghost history-toggle"
    title="Version history"
    aria-label="Version history"
    onclick={(e) => openHistory(e, id)}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  </button>
{/snippet}

{#snippet deleteButton(id: string)}
  <button
    type="button"
    class="icon-btn ghost danger"
    title="Delete note"
    aria-label="Delete note"
    onclick={() => removeNote(id)}
  >
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
    </svg>
  </button>
{/snippet}

<section class="day-notes" aria-label="Day notes">
  <div class="bar">
    {#if view === 'tabs'}
      <div class="tabs" role="tablist" aria-label="Notes">
        {#each notes as n, i (n.id)}
          {#if renaming === n.id}
            <input
              class="tab tab-rename"
              bind:value={renameValue}
              placeholder={label(n, i)}
              aria-label="Note name"
              onblur={commitRename}
              onkeydown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') renaming = null
              }}
              size={Math.max(6, renameValue.length + 1)}
            />
          {:else}
            <button
              type="button"
              class="tab"
              role="tab"
              data-tab={n.id}
              aria-selected={n.id === activeId}
              tabindex={n.id === activeId ? 0 : -1}
              title="Double-click to rename"
              onclick={() => select(n.id)}
              ondblclick={() => startRename(n.id)}
              onkeydown={(e) => onTabKeydown(e, i)}
            >
              {label(n, i)}
            </button>
          {/if}
        {/each}
        <button type="button" class="tab add-tab" onclick={addNote} title="New note" aria-label="New note">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
        </button>
      </div>
    {:else}
      <span class="count">{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span>
    {/if}

    <div class="bar-actions">
      {#if view === 'tabs'}
        {#if notes.length > 1}
          <button
            type="button"
            class="icon-btn ghost"
            title="Rename note"
            aria-label="Rename note"
            onclick={() => startRename(activeId)}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />
            </svg>
          </button>
          {@render deleteButton(activeId)}
        {/if}
        {@render historyButton(activeId)}
      {/if}
      <div class="view-toggle" role="radiogroup" aria-label="Layout">
        <button
          type="button"
          role="radio"
          aria-checked={view === 'tabs'}
          title="Tabs"
          aria-label="Tabs"
          onclick={() => preferencesStore.setDayNotesView('tabs')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 5.5h12v8H2z" /><path d="M2 5.5V3h5v2.5" />
          </svg>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={view === 'list'}
          title="List"
          aria-label="List"
          onclick={() => preferencesStore.setDayNotesView('list')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
          </svg>
        </button>
      </div>
    </div>
  </div>

  {#if !loaded}
    <div class="skeleton" aria-busy="true">
      <span class="skeleton-line" style:width="70%"></span>
      <span class="skeleton-line" style:width="85%"></span>
      <span class="skeleton-line" style:width="50%"></span>
    </div>
  {:else if view === 'tabs'}
    {#key `${dateStr}/${activeId}`}
      <div class="note" role="tabpanel" aria-label={label(notes[activeIndex], activeIndex)} use:checkpoint={{ date: dateStr, id: activeId }} in:fade={{ duration: 120 }}>
        <RichEditor session={logsStore.noteSession(dateStr, activeId)} placeholder="Notes for the day…" />
      </div>
    {/key}
  {:else}
    {#key dateStr}
      <div class="stack">
        {#each notes as n, i (n.id)}
          <article class="note stacked" use:checkpoint={{ date: dateStr, id: n.id }} transition:fade={{ duration: 140 }}>
            <header class="note-head">
              <span class="pill" aria-hidden="true">{i + 1}</span>
              <input
                class="note-title"
                data-note-title={n.id}
                value={n.title}
                placeholder={label({ ...n, title: '' }, i)}
                aria-label="Note title"
                oninput={(e) => logsStore.renameNote(dateStr, n.id, e.currentTarget.value)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' && !e.isComposing) {
                    e.preventDefault()
                    e.currentTarget.closest('.note')?.querySelector<HTMLElement>('.tiptap')?.focus()
                  }
                }}
              />
              <div class="note-actions">
                {@render historyButton(n.id)}
                {#if notes.length > 1}{@render deleteButton(n.id)}{/if}
              </div>
            </header>
            <RichEditor session={logsStore.noteSession(dateStr, n.id)} placeholder="Write…" />
          </article>
        {/each}
        <button type="button" class="add-note" onclick={addNote}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
          Add note
        </button>
      </div>
    {/key}
  {/if}

  {#if historyFor}
    <HistoryPopover
      kind="day-notes"
      entityId={dateStr}
      noteId={historyFor}
      anchor={historyAnchor}
      prepare={() => logsStore.noteSession(dateStr, historyFor!).flush({ snapshot: true, force: true })}
      onClose={() => (historyFor = null)}
    />
  {/if}
</section>

<style>
  .day-notes { margin-top: 0.25rem; }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 32px;
    margin-bottom: 1.25rem;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    /* Room for focus rings inside the scroller. */
    padding: 3px;
    margin: -3px;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    flex-shrink: 0;
    height: 28px;
    max-width: 14rem;
    padding: 0 0.8rem;
    border: 1px solid transparent;
    border-radius: 999px;
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 0.8125rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .tab:hover { color: var(--text); background: var(--glass-dark); }
  .tab[aria-selected='true'] { color: var(--accent); background: var(--glass); }
  .tab-rename {
    cursor: text;
    color: var(--text);
    background: var(--input-bg-strong);
    border-color: var(--accent);
    outline: none;
    max-width: 16rem;
  }
  .add-tab {
    width: 28px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .add-tab svg { width: 14px; height: 14px; }
  .count {
    font-family: var(--font-ui);
    font-size: 0.6875rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    opacity: 0.7;
  }
  .bar-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }
  .view-toggle {
    display: inline-flex;
    padding: 2px;
    margin-left: 0.25rem;
    border-radius: 999px;
    background: var(--glass-dark);
  }
  .view-toggle button {
    width: 28px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--muted);
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .view-toggle button svg { width: 14px; height: 14px; }
  .view-toggle button:hover { color: var(--text); }
  .view-toggle button[aria-checked='true'] { background: var(--glass); color: var(--accent); }

  .stack { display: flex; flex-direction: column; }
  .stacked + .stacked {
    border-top: 1px solid var(--line);
    padding-top: 1.5rem;
  }
  .stacked :global(.rich-editor .tiptap) {
    min-height: 3rem;
    padding-bottom: 1.5rem;
  }
  .note-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
  }
  .pill {
    flex-shrink: 0;
    min-width: 1.5rem;
    height: 1.5rem;
    padding: 0 0.4rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: var(--glass);
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
  }
  .note-title {
    flex: 1;
    min-width: 0;
    border: 0;
    padding: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 1.1rem;
    font-weight: 700;
    outline: none;
  }
  .note-title:hover,
  .note-title:focus { background: none; }
  .note-title::placeholder { color: var(--muted); opacity: 0.45; font-weight: 600; }
  .note-actions {
    display: flex;
    gap: 0.15rem;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .stacked:hover .note-actions,
  .stacked:focus-within .note-actions { opacity: 1; }
  @media (hover: none) {
    .note-actions { opacity: 1; }
  }
  .add-note {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.5rem;
    margin-bottom: 3rem;
    padding: 0.45rem 0.85rem;
    border: 1px dashed var(--line);
    border-radius: 999px;
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 0.8125rem;
    cursor: pointer;
    transition:
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  .add-note svg { width: 13px; height: 13px; }
  .add-note:hover { color: var(--text); border-color: var(--accent); background: var(--glass-dark); }
  .skeleton { display: flex; flex-direction: column; gap: 0.9rem; padding: 0.6rem 0; max-width: 70ch; }
</style>
