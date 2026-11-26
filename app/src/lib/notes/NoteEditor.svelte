<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { notesStore, tagCounts, dayLabel } from '../../stores/notes'
  import { appStore } from '../../stores/app'
  import { closeNote, linkTo } from '../../router/sync'
  import { authStore } from '../../stores/auth'
  import { revealedNote, reveal, conceal, isConcealed } from '../../stores/hidden'
  import { verifyPassword } from '../../api/auth'
  import { showError, showToast } from '../../stores/toast'
  import NoteSharePopover from './NoteSharePopover.svelte'
  import HistoryPopover from '../ui/HistoryPopover.svelte'
  import ActionMenu from '../ui/ActionMenu.svelte'
  import MoreButton from '../ui/MoreButton.svelte'
  import { LINK_ICON, type ActionMenuItem } from '../ui/menuItem'
  import { hiddenMenuItems, LOCK_ICON } from './hiddenMenu'
  import RichEditor from '../editor/RichEditor.svelte'
  import { bindSnapshotTriggers } from '../../utils/snapshotTriggers'
  import type { Note } from '../../types/models'

  // One editor for every note: full page in Notepad, and inline in the
  // Journal's day notes ('day').
  interface Props {
    nid: string
    variant?: 'page' | 'day'
    placeholder?: string
    // Optional delete action in the note menu.
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
  let menuAnchorEl = $state<HTMLButtonElement | null>(null)
  let menuOpen = $state(false)
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

  // Created from quick create: the title is written, so start in the body.
  // After a beat, so the closing search dialog has given focus back first.
  $effect(() => {
    if ($appStore.focusNoteBodyId !== nid || variant !== 'page' || !richEditor || !session) return
    appStore.setFocusNoteBody(null)
    const ed = richEditor
    setTimeout(() => ed.focusBody(), 30)
  })

  function openTag(tag: string) {
    reading = false
    notesStore.setFilter({ kind: 'tag', tag })
    appStore.setCurrentPage('notes')
  }

  function openDay() {
    if (!note?.day) return
    appStore.setSelectedDate(new Date(note.day + 'T12:00:00'))
    appStore.setJournalTab('notes')
    appStore.setCurrentPage('app')
  }

  // pointerdown, so the menu click that opens the popover can't also close
  // it, and composedPath so a node detached by a re-render (clicking "Enable
  // public link") still counts as inside.
  function onClickOutside(e: PointerEvent) {
    if (!showSharePopover) return
    const inside = e.composedPath().some((n) => n === rootEl?.querySelector('.share-wrap'))
    if (!inside) showSharePopover = false
  }

  // A hidden note's body, history and copy action wait for the password.
  let concealed = $derived(isConcealed(note, $revealedNote))
  let password = $state('')
  let unlockError = $state('')
  let checking = $state(false)

  async function unlock(e: SubmitEvent) {
    e.preventDefault()
    if (!password || checking) return
    const id = nid
    checking = true
    const res = await verifyPassword(password)
    checking = false
    password = ''
    if (id !== nid) return
    if (res === 'ok') {
      unlockError = ''
      reveal(id)
    } else {
      unlockError =
        res === 'rate_limited' ? 'Too many attempts. Try again in a few minutes.'
        : res === 'network' ? 'Couldn’t check the password.'
        : 'Wrong password'
    }
  }

  // Leaving a revealed note conceals it again. Compare ids rather than rely
  // on effect cleanup: Notepad passes `nid` straight from the notes store, so
  // this effect also re-runs on unrelated store updates.
  let shownNid = untrack(() => nid)
  $effect(() => {
    const id = nid
    if (id === shownNid) return
    conceal(shownNid)
    shownNid = id
    password = ''
    unlockError = ''
  })

  let canShare = $derived(variant === 'page' && !$authStore.isGuest)

  const PIN_ICON = ['M9.5 2.5 13.5 6.5', 'M10.8 3.8 7.2 6.1 4.3 5.2 2.5 7l6.5 6.5 1.8-1.8-.9-2.9 2.3-3.6']

  let menuItems: ActionMenuItem[] = $derived([
    ...(canShare
      ? [{
          label: note?.isPublic ? 'Share settings' : 'Share',
          icon: ['M8 10V2.5M5 5.5l3-3 3 3', 'M5.5 7.5H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1h-1.5'],
          onSelect: () => (showSharePopover = true),
        }]
      : []),
    ...(concealed
      ? []
      : [
          {
            label: note?.pinned ? 'Unpin from cover' : 'Pin to cover',
            icon: PIN_ICON,
            onSelect: () => void notesStore.setPinned(nid, !note?.pinned),
          },
          { label: 'Copy link', icon: LINK_ICON, onSelect: () => void copyLink() },
          { label: 'Copy note as markdown', icon: ['M5.5 2.5h7v10h-7z', 'M2.5 5.5v8h7'], onSelect: () => void copyNote() },
          { label: 'Version history', icon: ['M2 8a6 6 0 1 0 2-4.47L2 5.33', 'M2 2v3.33h3.33', 'M8 4.67V8l2 1.33'], onSelect: () => (showHistoryPopover = true) },
          ...hiddenMenuItems(note),
        ]),
    ...(onDelete ? [{ label: 'Delete note', icon: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5', danger: true, onSelect: onDelete }] : []),
  ])

  // Do not carry transient menus over when another note is selected. Compare
  // the id rather than rely on effect cleanup: any note update (enabling
  // sharing, a save elsewhere) re-runs this effect, and closing the open menu
  // or share popover there would hide the thing the click just opened.
  let menuNid = untrack(() => nid)
  $effect(() => {
    const id = nid
    if (id === menuNid) return
    menuNid = id
    menuOpen = false
    showHistoryPopover = false
    showSharePopover = false
  })

  // Opens the note in Hawk (login required). Public sharing has its own
  // "Copy public link".
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(linkTo({ page: 'notes', nid }))
      showToast('Link copied')
    } catch (e) {
      console.error('Failed to copy', e)
      showError('Couldn’t copy to the clipboard.')
    }
  }

  async function copyNote() {
    await notesStore.loadBody(nid)
    const text = (($notesStore.allNotes.find((n) => n.id === nid) as Note | undefined)?.content ?? '').trim()
    try {
      await navigator.clipboard.writeText(text)
      showToast('Copied as markdown')
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
    menuAnchorEl?.focus()
  }

  $effect(() => {
    document.addEventListener('pointerdown', onClickOutside)
    document.addEventListener('keydown', onKeydown)
    return () => {
      document.removeEventListener('pointerdown', onClickOutside)
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
    conceal(shownNid)
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
        onclick={closeNote}
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
      {#if showHistoryPopover}
        <HistoryPopover
          kind="note"
          entityId={note.id}
          anchor={menuAnchorEl}
          prepare={prepareHistory}
          onClose={() => (showHistoryPopover = false)}
        />
      {/if}
      {#if note.hidden && !concealed}
        <button
          type="button"
          class="icon-btn lock-button"
          class:ghost={variant === 'day'}
          title="Lock note"
          aria-label="Lock note"
          onclick={() => conceal(nid)}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            {#each LOCK_ICON as d}<path {d} />{/each}
          </svg>
        </button>
      {/if}
      <button
        type="button"
        class="icon-btn full-screen-button"
        class:ghost={variant === 'day'}
        title={reading ? 'Exit full screen (Esc)' : 'Full screen'}
        aria-label={reading ? 'Exit full screen' : 'Full screen'}
        aria-pressed={reading}
        onclick={() => (reading = !reading)}
      >
        {#if reading}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.5V6H2.5M10 2.5V6h3.5M6 13.5V10H2.5M10 13.5V10h3.5" /></svg>
        {:else}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10" /></svg>
        {/if}
      </button>
      <div class="share-wrap">
        <MoreButton
          expanded={menuOpen}
          ghost={variant === 'day'}
          bind:anchor={menuAnchorEl}
          onclick={() => (menuOpen = !menuOpen)}
        />
        {#if showSharePopover}
          <NoteSharePopover note={note} onClose={() => (showSharePopover = false)} />
        {/if}
      </div>
      {#if menuOpen}
        <ActionMenu anchor={menuAnchorEl} items={menuItems} label="Note actions" onClose={() => (menuOpen = false)} />
      {/if}
    </div>
    {/if}
  </div>
  {/if}

  {#if concealed}
    <form class="hidden-body" onsubmit={unlock}>
      <div class="unlock-row">
        <input
          type="password"
          autocomplete="current-password"
          placeholder="Password"
          aria-label="Password"
          aria-invalid={unlockError ? 'true' : undefined}
          aria-describedby={unlockError ? `unlock-error-${nid}` : undefined}
          bind:value={password}
        />
        <button type="submit" class="btn-secondary" disabled={!password || checking}>Show</button>
      </div>
      {#if unlockError}
        <p id="unlock-error-{nid}" class="unlock-error" role="alert">{unlockError}</p>
      {/if}
    </form>
  {:else if !session}
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
        onOpenTag={openTag}
        placeholder={placeholder ?? (variant === 'day' ? 'Notes for the day…' : 'Write here…')}
      />
    {/key}
  {/if}
</div>
{/if}

<style>
  .editor-root {
    --note-content-width: 70ch;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  /* Reading mode: fixed over the whole app, just under popovers so history,
     share and the editor's own menus still open on top. */
  .editor-root.reading {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popover) - 1);
    overflow-y: auto;
    padding: 0 1.5rem;
    background: var(--bg);
    outline: none;
  }
  .reading > .editor-header,
  .reading > .editor-loading,
  .reading > :global(.rich-editor) {
    width: 100%;
    max-width: var(--note-content-width);
    margin-inline: auto;
  }
  /* Keep the title and its actions in place while the note scrolls. The top
     padding lives here so the header stays opaque above it. */
  .reading > .editor-header {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    padding-top: 3rem;
    background: var(--bg);
  }
  .reading .mobile-back { display: none !important; }
  .icon-btn.full-screen-button,
  .icon-btn.lock-button { width: 32px; height: 32px; }
  @media (pointer: coarse) {
    .icon-btn.full-screen-button,
    .icon-btn.lock-button { width: 40px; height: 40px; }
    .page .day-chip { height: 40px; }
  }
  .editor-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  /* A shared header edge makes the list and editor one workspace. Reading
     mode remains a separate, centred document rather than a framed pane. */
  .page:not(.reading) .editor-header {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    width: 100%;
    min-height: var(--workspace-header-height);
    max-width: none;
    padding: 0.75rem 1.5rem;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg);
  }
  .page:not(.reading) .note-title { font-size: 1.25rem; line-height: 1.4; }
  .page:not(.reading) > :global(.rich-editor),
  .page:not(.reading) > .editor-loading {
    /* Preserve space for the editor's block-insertion gutter. */
    margin: 0 1.5rem 1.5rem 3rem;
  }
  .page.reading .note-title { font-size: 2rem; line-height: 1.25; }
  .day .editor-header { gap: 0.6rem; margin-bottom: 0.5rem; }
  .mobile-back {
    display: none;
    background: none;
    border: 1px solid var(--line);
    color: var(--text);
    cursor: pointer;
    width: 36px;
    height: 36px;
    border-radius: var(--r-sm);
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
  .header-actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 0.375rem;
  }
  .day .header-actions { gap: 0.15rem; }
  .day-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--glass-dark);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    height: 32px;
    padding: 0 0.6rem;
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

  .share-wrap { position: relative; }
  .hidden-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    padding: 3rem 1rem;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 0.875rem;
  }
  .page:not(.reading) > .hidden-body { margin: 0 1.5rem 1.5rem; }
  .day > .hidden-body { padding: 2rem 1rem; }
  .unlock-row { display: flex; gap: 0.5rem; width: min(300px, 100%); }
  .unlock-row input {
    flex: 1;
    min-width: 0;
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--input-bg);
    color: var(--text);
    font-family: inherit;
    font-size: 0.875rem;
  }
  .unlock-row input:focus { border-color: var(--accent); outline: none; }
  .unlock-error { margin: 0; color: var(--danger); font-size: 0.8125rem; }
  .editor-loading {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 0.6rem 0;
    max-width: 70ch;
  }
  @media (max-width: 900px) {
    .mobile-back { display: inline-flex; }
    .page:not(.reading) .editor-header { gap: 0.5rem; padding-inline: 1rem; }
    .page:not(.reading) > :global(.rich-editor),
    .page:not(.reading) > .editor-loading { margin-inline: 2.5rem 1rem; }
  }
  @media (max-width: 600px) {
    /* Title gets its own full-width line under the controls. */
    .page .editor-header { flex-wrap: wrap; row-gap: 0.75rem; }
    .page:not(.reading) .note-title { font-size: 1.5rem; }
    .page .note-title { order: 3; flex-basis: 100%; font-size: 1.8rem; }
    .page .header-actions { margin-left: auto; }
    .day-chip span { display: none; }
  }
</style>
