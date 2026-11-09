<script lang="ts">
  import { onDestroy } from 'svelte'
  import { notesStore, tagCounts, dayLabel } from '../../stores/notes'
  import { appStore } from '../../stores/app'
  import { authStore } from '../../stores/auth'
  import { showError } from '../../stores/toast'
  import NoteSharePopover from './NoteSharePopover.svelte'
  import HistoryPopover from '../ui/HistoryPopover.svelte'
  import RichEditor from '../editor/RichEditor.svelte'
  import { bindSnapshotTriggers } from '../../utils/snapshotTriggers'
  import type { Note } from '../../types/models'

  // One editor for every note: full page in Notepad, and inline in the
  // Journal's day notes ('day').
  interface Props {
    nid: string
    variant?: 'page' | 'day'
    placeholder?: string
    // Shows a delete button next to version history.
    onDelete?: () => void
    // Journal tabs carry the title (double-click to rename), so no field here.
    hideTitle?: boolean
    // Journal tabs put history/delete/reading in the tab bar instead.
    hideActions?: boolean
    // Reading mode: the note fills the window, everything else hidden.
    reading?: boolean
  }
  let {
    nid,
    variant = 'page',
    placeholder,
    onDelete,
    hideTitle = false,
    hideActions = false,
    reading = $bindable(false),
  }: Props = $props()

  let showSharePopover = $state(false)
  let showHistoryPopover = $state(false)
  let rootEl = $state<HTMLDivElement | null>(null)
  let historyAnchorEl = $state<HTMLButtonElement | null>(null)
  let richEditor = $state<RichEditor | null>(null)
  let teardownTriggers: (() => void) | null = null

  let note = $derived(($notesStore.allNotes.find((n) => n.id === nid) as Note | undefined) ?? null)

  // Day tabs carry the title; reading mode shows it only if there is one.
  let showTitle = $derived(!hideTitle || (reading && !!note?.title?.trim()))

  // Tags from other notes, most used first — offered when typing "#". This
  // note's own are left out: the half-typed tag would suggest itself.
  let tags = $derived(tagCounts($notesStore.allNotes.filter((n) => n.id !== nid)).map(([t]) => t))

  // Load the body if only the list row is here (e.g. a day note in Journal).
  $effect(() => {
    if (note && note.content === undefined) void notesStore.loadBody(note.id)
  })

  // Run inside the popover before listing — captures the user's current state
  // so the very first popover open already has a snapshot to show.
  async function prepareHistory() {
    await notesStore.triggerSnapshot(nid, true)
  }

  let title = $state('')
  let titleInputEl = $state<HTMLInputElement | null>(null)
  let lastNid = ''
  $effect(() => {
    if (!note) {
      lastNid = ''
      return
    }
    if (note.id !== lastNid) {
      lastNid = note.id
      title = note.title ?? ''
      return
    }
    // Same note — adopt the title from the store (e.g. another device renamed
    // it). Skip while the user is typing here — the store updates on every
    // keystroke, which re-runs this effect; if the note hasn't yet re-derived
    // the new title, we'd clobber what the user just typed.
    if (typeof document !== 'undefined' && document.activeElement === titleInputEl) return
    if (note.title !== undefined && note.title !== title) title = note.title
  })

  // The sync session owns the body once it's loaded; the editor talks to it
  // directly (see sync/docSession.ts).
  let session = $derived(note && note.content !== undefined ? notesStore.sessionFor(note.id) : null)

  let titlePlaceholder = $derived(
    variant === 'day' ? 'Title' : note?.day ? dayLabel(note.day) : 'Untitled',
  )

  function onTitleInput() {
    notesStore.setTitle(nid, title)
  }

  // Tab or Enter in the title moves into the body.
  function onTitleKeydown(e: KeyboardEvent) {
    if (e.isComposing) return
    if (!((e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter')) return
    if (!richEditor) return
    e.preventDefault()
    richEditor.focusBody()
  }

  function openDay() {
    if (!note?.day) return
    appStore.setSelectedDate(new Date(note.day + 'T12:00:00'))
    appStore.setJournalTab('notes')
    appStore.setCurrentPage('app')
  }

  // composedPath, not target.closest: clicking "Enable public link"
  // re-renders the popover and detaches the clicked node, which used to read
  // as an outside click and close the popover before the link appeared.
  function onClickOutside(e: MouseEvent) {
    if (!showSharePopover) return
    const inside = e.composedPath().some((n) => n === rootEl?.querySelector('.share-wrap'))
    if (!inside) showSharePopover = false
  }

  let copied = $state(false)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  async function copyNote() {
    await notesStore.loadBody(nid)
    const text = (($notesStore.allNotes.find((n) => n.id === nid) as Note | undefined)?.content ?? '').trim()
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

  // Focus the overlay on entry so Escape (handled on the root, below any
  // popover or editor menu that claims it first) can leave reading mode.
  $effect(() => {
    if (!reading || !rootEl) return
    if (!rootEl.contains(document.activeElement)) rootEl.focus({ preventScroll: true })
  })

  function onRootKeydown(e: KeyboardEvent) {
    if (!reading || e.key !== 'Escape' || e.defaultPrevented) return
    if (showHistoryPopover || showSharePopover) return
    reading = false
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !showSharePopover) return
    showSharePopover = false
    rootEl?.querySelector<HTMLElement>('.share-toggle')?.focus()
  }

  $effect(() => {
    document.addEventListener('click', onClickOutside)
    document.addEventListener('keydown', onKeydown)
    return () => {
      document.removeEventListener('click', onClickOutside)
      document.removeEventListener('keydown', onKeydown)
    }
  })

  // Re-bind snapshot triggers whenever the editor root or note changes.
  // Trigger fires on focusout/visibilitychange/beforeunload — see snapshotTriggers.ts.
  $effect(() => {
    teardownTriggers?.()
    teardownTriggers = null
    if (!rootEl || !note) return
    const id = note.id
    teardownTriggers = bindSnapshotTriggers(rootEl, () => {
      notesStore.triggerSnapshot(id)
    })
  })

  onDestroy(() => {
    teardownTriggers?.()
    teardownTriggers = null
  })
</script>

{#if note}
<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<div
  class="editor-root {variant}"
  class:no-title={!showTitle}
  class:reading
  role={reading ? 'dialog' : undefined}
  aria-label={reading ? 'Reading mode' : undefined}
  tabindex={reading ? -1 : undefined}
  bind:this={rootEl}
  onkeydown={onRootKeydown}
>
  {#if showTitle || !hideActions || reading}
  <div class="editor-header">
    {#if variant === 'page'}
      <button
        type="button"
        class="mobile-back"
        aria-label="Back to notes"
        onclick={() => notesStore.clearSelectedNote()}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 8H3.5M7.5 4L3.5 8l4 4" /></svg>
      </button>
    {/if}
    {#if !showTitle}
      <span class="title-spacer"></span>
    {:else}
    <input
      type="text"
      class="note-title"
      placeholder={titlePlaceholder}
      aria-label="Note title"
      bind:this={titleInputEl}
      bind:value={title}
      oninput={onTitleInput}
      onkeydown={onTitleKeydown}
    />
    {/if}
    {#if !hideActions || reading}
    <div class="header-actions">
      {#if variant === 'page' && note.day}
        <button type="button" class="day-chip" onclick={openDay} title="Open this day in Journal">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg>
          <span>{dayLabel(note.day)}</span>
        </button>
      {/if}
      <button
        type="button"
        class="icon-btn copy-btn"
        class:ghost={variant === 'day'}
        class:copied
        title="Copy note as markdown"
        aria-label="Copy note as markdown"
        onclick={copyNote}
      >
        {#if copied}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
        {:else}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2.5" width="8.5" height="10" rx="1.5" /><path d="M2.5 5.5v7.5a1.5 1.5 0 0 0 1.5 1.5h7" /></svg>
        {/if}
      </button>
      <div class="history-wrap">
        <button
          type="button"
          class="history-toggle icon-btn"
          class:ghost={variant === 'day'}
          aria-label="Version history"
          title="Version history"
          bind:this={historyAnchorEl}
          onclick={() => (showHistoryPopover = !showHistoryPopover)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l3 2" />
          </svg>
        </button>
        {#if showHistoryPopover}
          <HistoryPopover
            kind="note"
            entityId={note.id}
            anchor={historyAnchorEl}
            prepare={prepareHistory}
            onClose={() => (showHistoryPopover = false)}
          />
        {/if}
      </div>
      {#if onDelete}
        <button
          type="button"
          class="icon-btn danger"
          class:ghost={variant === 'day'}
          title="Delete note"
          aria-label="Delete note"
          onclick={onDelete}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
          </svg>
        </button>
      {/if}
      {#if variant === 'page' && !$authStore.isGuest}
        <div class="share-wrap">
          <button
            type="button"
            class="share-toggle icon-btn"
            class:active={note.isPublic}
            title={note.isPublic ? 'Public — share settings' : 'Share'}
            aria-label={note.isPublic ? 'Public — share settings' : 'Share'}
            aria-haspopup="dialog"
            aria-expanded={showSharePopover}
            onclick={() => (showSharePopover = !showSharePopover)}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M8 10V2.5M5 5.5l3-3 3 3" /><path d="M5.5 7.5H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1h-1.5" />
            </svg>
          </button>
          {#if showSharePopover}
            <NoteSharePopover note={note} onClose={() => (showSharePopover = false)} />
          {/if}
        </div>
      {/if}
      <button
        type="button"
        class="icon-btn"
        class:ghost={variant === 'day'}
        class:reading-toggle={variant === 'page'}
        title={reading ? 'Exit reading mode (Esc)' : 'Reading mode'}
        aria-label={reading ? 'Exit reading mode' : 'Reading mode'}
        aria-pressed={reading}
        onclick={() => (reading = !reading)}
      >
        {#if reading}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.5V6H2.5M10 2.5V6h3.5M6 13.5V10H2.5M10 13.5V10h3.5" /></svg>
        {:else}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10" /></svg>
        {/if}
      </button>
    </div>
    {/if}
  </div>
  {/if}

  {#if !session}
    <div class="editor-loading" aria-busy="true">
      <span class="skeleton-line" style:width="72%"></span>
      <span class="skeleton-line" style:width="88%"></span>
      <span class="skeleton-line" style:width="54%"></span>
    </div>
  {:else}
    {#key note.id}
      <RichEditor
        bind:this={richEditor}
        {session}
        {tags}
        placeholder={placeholder ?? (variant === 'day' ? 'Notes for the day…' : 'Write here…')}
      />
    {/key}
  {/if}
</div>
{/if}

<style>
  .editor-root { display: flex; flex-direction: column; min-width: 0; }
  /* Reading mode: fixed over the whole app, just under popovers so history,
     share and the editor's own menus still open on top. */
  .editor-root.reading {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popover) - 1);
    overflow-y: auto;
    padding: 3rem 1.5rem 0;
    background: var(--bg);
    outline: none;
  }
  .reading > .editor-header,
  .reading > .editor-loading,
  .reading > :global(.rich-editor) {
    width: 100%;
    max-width: calc(70ch + 2rem);
    margin-inline: auto;
  }
  .reading .mobile-back { display: none !important; }
  .reading-toggle,
  .page .copy-btn { width: 30px; height: 30px; }
  .copy-btn.copied { color: var(--accent); }
  .editor-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .day .editor-header { gap: 0.6rem; margin-bottom: 0.5rem; }
  .mobile-back {
    display: none;
    background: none;
    border: 1px solid var(--line);
    color: var(--text);
    cursor: pointer;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    line-height: 1;
    flex-shrink: 0;
    transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }
  .mobile-back:hover { background: var(--glass-dark); border-color: var(--accent); }
  .note-title {
    padding: 0;
    flex: 1;
    background: none;
    border: none;
    color: var(--text);
    font-size: 2.5rem;
    width: 100%;
    outline: none;
    font-weight: 800;
    font-family: inherit;
    min-width: 0;
    text-overflow: ellipsis;
  }
  .title-spacer { flex: 1; }
  .no-title .editor-header { margin-bottom: 0; }
  .day .note-title { font-size: 1.1rem; font-weight: 700; }
  .note-title::placeholder { color: var(--muted); opacity: 0.35; }
  .day .note-title::placeholder { opacity: 0.45; font-weight: 600; }
  .note-title:hover,
  .note-title:focus { background: none; }
  .header-actions { display: flex; align-items: center; gap: 0.5rem; }
  .day .header-actions {
    gap: 0.15rem;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .day:hover .header-actions,
  .day:focus-within .header-actions { opacity: 1; }
  @media (hover: none) {
    .day .header-actions { opacity: 1; }
  }
  .day-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--glass-dark);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    height: 30px;
    padding: 0 12px;
    color: var(--muted);
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: 0.8125rem;
    white-space: nowrap;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .day-chip:hover { color: var(--text); border-color: var(--accent); background: var(--glass); }
  .day-chip svg { color: var(--accent); }

  .history-wrap { position: relative; }
  .history-toggle { width: 30px; height: 30px; }
  .share-wrap { position: relative; }
  .share-toggle { width: 30px; height: 30px; }
  .share-toggle.active { color: var(--accent); border-color: var(--accent); }
  .editor-loading {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 0.6rem 0;
    max-width: 70ch;
  }
  @media (max-width: 900px) {
    .mobile-back { display: inline-flex; }
    .page .editor-header { gap: 0.5rem; margin-bottom: 1rem; }
  }
  @media (max-width: 600px) {
    /* Title gets its own full-width line under the controls. */
    .page .editor-header { flex-wrap: wrap; row-gap: 0.75rem; }
    .page .note-title { order: 3; flex-basis: 100%; font-size: 1.8rem; }
    .page .header-actions { margin-left: auto; }
    .day-chip span { display: none; }
  }
</style>
