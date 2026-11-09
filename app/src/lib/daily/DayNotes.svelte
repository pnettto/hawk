<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fade } from 'svelte/transition'
  import { appStore } from '../../stores/app'
  import { notesStore, sortDayNotes } from '../../stores/notes'
  import { preferencesStore } from '../../stores/preferences'
  import { formatDate } from '../../utils/date'
  import { showError } from '../../stores/toast'
  import NoteEditor from '../notes/NoteEditor.svelte'
  import type { Note, NoteMetadata } from '../../types/models'

  // A day's notes are regular notes with `day` set — the same ones Notepad
  // lists under Day Notes, edited with the same editor.

  let dateStr = $derived(formatDate($appStore.selectedDate))
  let loaded = $derived($notesStore.loaded)
  let view = $derived($preferencesStore.dayNotesView)

  onMount(() => {
    if (!$notesStore.loaded) void notesStore.load()
  })

  // A day always shows at least one note. Until something is typed it only
  // exists locally (see notesStore.ensureDayDraft).
  $effect(() => {
    if (loaded) notesStore.ensureDayDraft(dateStr)
  })

  let notes: NoteMetadata[] = $derived(
    sortDayNotes($notesStore.allNotes.filter((n) => n.day === dateStr && !n.deletedAt)),
  )

  const label = (n: NoteMetadata, i: number) => n.title.trim() || (notes.length > 1 ? `Note ${i + 1}` : 'Note')

  // Active tab, remembered per day for the session.
  let activeByDate = $state<Record<string, string>>({})
  let activeId = $derived.by(() => {
    const want = activeByDate[dateStr]
    return notes.some((n) => n.id === want) ? want : notes[0]?.id
  })
  const select = (id: string) => (activeByDate = { ...activeByDate, [dateStr]: id })

  async function addNote() {
    const order = Math.max(0, ...notes.map((n) => n.dayOrder ?? 0)) + 1
    const id = notesStore.createNote({ day: dateStr, dayOrder: order, select: false })
    select(id)
    await tick()
    if (view === 'tabs') startRename(id)
    else document.querySelector<HTMLInputElement>(`[data-nid="${id}"] .note-title`)?.focus()
  }

  // ---- tab rename ----------------------------------------------------------

  let renaming = $state<string | null>(null)
  let renameValue = $state('')

  async function startRename(id: string) {
    renaming = id
    renameValue = notes.find((n) => n.id === id)?.title ?? ''
    await tick()
    const el = document.querySelector<HTMLInputElement>('.tab-rename')
    el?.focus()
    el?.select()
  }

  function commitRename() {
    if (!renaming) return
    const id = renaming
    renaming = null
    const title = renameValue.trim()
    if (notes.find((n) => n.id === id)?.title !== title) notesStore.setTitle(id, title)
  }

  function removeNote(id: string) {
    const idx = notes.findIndex((n) => n.id === id)
    const fallback = notes[idx - 1] ?? notes[idx + 1]
    if (fallback) select(fallback.id)
    notesStore.trashNote(id)
  }

  const deleteFor = (id: string) => (notes.length > 1 ? () => removeNote(id) : undefined)

  // ---- copy ----------------------------------------------------------------

  // Tabs: the open note. List: every note of the day, titled when there are
  // several.
  let copied = $state(false)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  async function copyNotes() {
    const picked = view === 'tabs' ? notes.filter((n) => n.id === activeId) : notes
    await Promise.all(picked.map((n) => notesStore.loadBody(n.id)))
    const body = (id: string) => (($notesStore.allNotes.find((x) => x.id === id) as Note | undefined)?.content ?? '').trim()
    const text =
      picked.length === 1
        ? body(picked[0].id)
        : picked
            .map((n) => [`## ${label(n, notes.indexOf(n))}`, body(n.id)].filter(Boolean).join('\n\n'))
            .join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      copied = true
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => (copied = false), 1500)
    } catch (e) {
      console.error('Failed to copy', e)
      showError('Couldn’t copy to the clipboard.')
    }
  }

  function onTabKeydown(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = notes[(i + (e.key === 'ArrowRight' ? 1 : -1) + notes.length) % notes.length]
    select(next.id)
    tick().then(() => document.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus())
  }
</script>

<section class="day-notes" aria-label="Day notes">
  <div class="bar" class:tabs-view={view === 'tabs'}>
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
                if (e.isComposing) return
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
    <button
      type="button"
      class="copy-btn"
      class:copied
      title={view === 'tabs' ? 'Copy note as markdown' : 'Copy the day’s notes as markdown'}
      aria-label={view === 'tabs' ? 'Copy note as markdown' : 'Copy the day’s notes as markdown'}
      disabled={!loaded || !notes.length}
      onclick={copyNotes}
    >
      {#if copied}
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
      {:else}
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2.5" width="8.5" height="10" rx="1.5" /><path d="M2.5 5.5v7.5a1.5 1.5 0 0 0 1.5 1.5h7" /></svg>
      {/if}
    </button>
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

  {#if !loaded || !activeId}
    <div class="skeleton" aria-busy="true">
      <span class="skeleton-line" style:width="70%"></span>
      <span class="skeleton-line" style:width="85%"></span>
      <span class="skeleton-line" style:width="50%"></span>
    </div>
  {:else if view === 'tabs'}
    {#key `${dateStr}/${activeId}`}
      <div class="note" role="tabpanel" data-nid={activeId} in:fade={{ duration: 120 }}>
        <NoteEditor nid={activeId} variant="day" hideTitle onDelete={deleteFor(activeId)} />
      </div>
    {/key}
  {:else}
    {#key dateStr}
      <div class="stack">
        {#each notes as n (n.id)}
          <article class="note stacked" data-nid={n.id} transition:fade={{ duration: 140 }}>
            <NoteEditor nid={n.id} variant="day" placeholder="Write…" onDelete={deleteFor(n.id)} />
          </article>
        {/each}
        <button type="button" class="add-note" onclick={addNote}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
          Add note
        </button>
      </div>
    {/key}
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
  /* The tab already names the note; the editor's action row sits right under it. */
  .bar.tabs-view { margin-bottom: 0.5rem; }
  .bar-actions { display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0; }
  .copy-btn {
    width: 28px;
    height: 28px;
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
  .copy-btn svg { width: 14px; height: 14px; }
  .copy-btn:hover:not(:disabled) { color: var(--text); background: var(--glass-dark); }
  .copy-btn.copied { color: var(--accent); }
  .copy-btn:disabled { opacity: 0.4; cursor: default; }
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
  .view-toggle {
    display: inline-flex;
    flex-shrink: 0;
    padding: 2px;
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
