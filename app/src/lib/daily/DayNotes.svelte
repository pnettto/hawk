<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { fade } from 'svelte/transition'
  import { appStore } from '../../stores/app'
  import { notesStore, sortDayNotes } from '../../stores/notes'
  import { formatDate } from '../../utils/date'
  import { showError, showToast } from '../../stores/toast'
  import NoteEditor from '../notes/NoteEditor.svelte'
  import HistoryPopover from '../ui/HistoryPopover.svelte'
  import ActionMenu from '../ui/ActionMenu.svelte'
  import MoreButton from '../ui/MoreButton.svelte'
  import type { ActionMenuItem } from '../ui/menuItem'
  import { revealedNote, isConcealed } from '../../stores/hidden'
  import { hiddenMenuItems, LOCK_ICON } from '../notes/hiddenMenu'
  import type { Note, NoteMetadata } from '../../types/models'

  // A day's notes are regular notes with `day` set — the same ones Notepad
  // lists under Day Notes, edited with the same editor.

  let dateStr = $derived(formatDate($appStore.selectedDate))
  let loaded = $derived($notesStore.loaded)

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

  // Opened from search: switch to that note's tab.
  $effect(() => {
    const id = $appStore.focusDayNoteId
    if (!id || !loaded) return
    appStore.setFocusDayNote(null)
    if (notes.some((n) => n.id === id)) select(id)
  })

  async function addNote() {
    const order = Math.max(0, ...notes.map((n) => n.dayOrder ?? 0)) + 1
    const id = notesStore.createNote({ day: dateStr, dayOrder: order, select: false })
    select(id)
    await tick()
    await startRename(id)
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

  // ---- tabs: note actions in the bar ---------------------------------------

  // Tabs keep full screen visible and put secondary actions in the menu.
  let reading = $state(false)
  let showHistory = $state(false)
  let barMenuOpen = $state(false)
  let barMenuEl = $state<HTMLButtonElement | null>(null)

  const COPY_ICON = [
    'M5.5 2.5h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z',
    'M2.5 5.5v7a2 2 0 0 0 2 2h6',
  ]
  const HISTORY_ICON = ['M2 8a6 6 0 1 0 2-4.47L2 5.33', 'M2 2v3.33h3.33', 'M8 4.67V8l2 1.33']
  const DELETE_ICON = 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5'

  let barMenuItems: ActionMenuItem[] = $derived.by(() => {
    const items: ActionMenuItem[] = []
    if (!loaded || !notes.length) return items
    const id = activeId
    const active = notes.find((n) => n.id === id)
    // A hidden note shows nothing but delete until it's revealed.
    if (!isConcealed(active, $revealedNote)) {
      items.push({
        label: 'Copy note as markdown',
        icon: COPY_ICON,
        onSelect: () => void copyNote(),
      })
      if (id) {
        items.push({ label: 'Version history', icon: HISTORY_ICON, onSelect: () => (showHistory = true) })
        items.push(...hiddenMenuItems(active))
      }
    }
    if (id && notes.length > 1) {
      items.push({ label: 'Delete note', icon: DELETE_ICON, danger: true, onSelect: () => removeNote(id) })
    }
    return items
  })

  $effect(() => {
    void activeId
    void dateStr
    showHistory = false
    barMenuOpen = false
  })

  // ---- copy ----------------------------------------------------------------

  async function copyNote() {
    const id = activeId
    if (!id) return
    await notesStore.loadBody(id)
    const text = (($notesStore.allNotes.find((n) => n.id === id) as Note | undefined)?.content ?? '').trim()
    try {
      await navigator.clipboard.writeText(text)
      showToast('Copied as markdown')
    } catch (e) {
      console.error('Failed to copy', e)
      showError('Couldn’t copy to the clipboard.')
    }
  }

  // Stable, untransformed tab geometry for the entire pointer gesture.
  let tabsEl: HTMLDivElement
  let drag = $state<{ id: string; from: number; to: number; offset: number; moved: boolean } | null>(null)
  let geometry: { id: string; left: number; width: number }[] = []
  let pointerId = -1
  let startX = 0
  let clientX = 0
  let startScroll = 0
  let dragDay = ''
  let frame = 0
  let suppressClick = false

  function cancelDrag() {
    cancelAnimationFrame(frame)
    drag = null
  }
  onDestroy(cancelDrag)

  function startDrag(e: PointerEvent, id: string) {
    if (e.button !== 0 || notes.length < 2) return
    suppressClick = false
    geometry = Array.from(tabsEl.querySelectorAll<HTMLElement>('[data-tab]')).map((el) => {
      const rect = el.getBoundingClientRect()
      return { id: el.dataset.tab!, left: rect.left, width: rect.width }
    })
    const from = geometry.findIndex((g) => g.id === id)
    if (from < 0) return
    pointerId = e.pointerId
    startX = clientX = e.clientX
    startScroll = tabsEl.scrollLeft
    dragDay = dateStr
    drag = { id, from, to: from, offset: 0, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    frame = requestAnimationFrame(autoScroll)
  }

  function updateDrag() {
    if (!drag) return
    // Cancel if sync, deletion or a day switch changes the captured list.
    if (dateStr !== dragDay || notes.map((n) => n.id).join() !== geometry.map((g) => g.id).join()) {
      cancelDrag()
      return
    }
    const offset = clientX - startX + tabsEl.scrollLeft - startScroll
    if (!drag.moved && Math.abs(offset) < 5) return
    const source = geometry[drag.from]
    const center = source.left + source.width / 2 + offset
    const to = geometry.filter((g) => g.id !== drag!.id && center > g.left + g.width / 2).length
    drag = { ...drag, offset, to, moved: true }
    suppressClick = true
  }

  function moveDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== pointerId) return
    clientX = e.clientX
    updateDrag()
  }

  function autoScroll() {
    if (!drag) return
    if (drag.moved) {
      const rect = tabsEl.getBoundingClientRect()
      const speed = clientX < rect.left + 28 ? -8 : clientX > rect.right - 28 ? 8 : 0
      if (speed) {
        tabsEl.scrollLeft += speed
        updateDrag()
      }
    }
    frame = requestAnimationFrame(autoScroll)
  }

  function tabOffset(id: string) {
    if (!drag?.moved) return 0
    if (id === drag.id) return drag.offset
    // Variable-width tabs fill the gap at their preview positions.
    const order = geometry.filter((g) => g.id !== drag!.id)
    order.splice(drag.to, 0, geometry[drag.from])
    const gap = geometry.length > 1 ? geometry[1].left - geometry[0].left - geometry[0].width : 0
    let left = geometry[0].left
    for (const tab of order) {
      if (tab.id === id) return left - geometry.find((g) => g.id === id)!.left
      left += tab.width + gap
    }
    return 0
  }

  function finishDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== pointerId) return
    clientX = e.clientX
    updateDrag()
    const settled = drag
    cancelDrag()
    if (!settled?.moved || settled.from === settled.to) return
    const ids = geometry.map((g) => g.id)
    ids.splice(settled.from, 1)
    ids.splice(settled.to, 0, settled.id)
    void notesStore.reorderDayNotes(dragDay, ids)
  }

  function onDragKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && drag) {
      e.preventDefault()
      e.stopPropagation()
      cancelDrag()
    }
  }

  function onTabKeydown(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    if (e.altKey) {
      const to = i + (e.key === 'ArrowRight' ? 1 : -1)
      if (to < 0 || to >= notes.length) return
      const ids = notes.map((n) => n.id)
      const [id] = ids.splice(i, 1)
      ids.splice(to, 0, id)
      void notesStore.reorderDayNotes(dateStr, ids)
      return
    }
    const next = notes[(i + (e.key === 'ArrowRight' ? 1 : -1) + notes.length) % notes.length]
    select(next.id)
    tick().then(() => document.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus())
  }
</script>

<svelte:window onkeydown={onDragKey} />

<section class="day-notes" aria-label="Day notes">
  <div class="bar">
    <div class="tabs" class:reordering={drag?.moved} bind:this={tabsEl} role="tablist" aria-label="Notes">
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
            class:dragging={drag?.id === n.id && drag.moved}
            style:transform={`translateX(${tabOffset(n.id)}px)`}
            data-tab={n.id}
            aria-selected={n.id === activeId}
            tabindex={n.id === activeId ? 0 : -1}
            title="Drag to reorder · Alt+Left/Right to move · Double-click to rename"
            onpointerdown={(e) => startDrag(e, n.id)}
            onpointermove={moveDrag}
            onpointerup={finishDrag}
            onpointercancel={cancelDrag}
            onlostpointercapture={cancelDrag}
            onclick={() => { if (!suppressClick) select(n.id); suppressClick = false }}
            ondblclick={() => startRename(n.id)}
            onkeydown={(e) => onTabKeydown(e, i)}
          >
            {#if n.hidden}
              <svg class="tab-lock" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Hidden" role="img">{#each LOCK_ICON as d}<path {d} />{/each}</svg>
            {/if}
            {label(n, i)}
          </button>
        {/if}
      {/each}
      <button type="button" class="tab add-tab" onclick={addNote} title="New note" aria-label="New note">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
      </button>
    </div>
    <div class="bar-actions">
      {#if loaded && activeId}
        {#if showHistory}
          <HistoryPopover
            kind="note"
            entityId={activeId}
            anchor={barMenuEl}
            prepare={() => notesStore.triggerSnapshot(activeId, true)}
            onClose={() => (showHistory = false)}
          />
        {/if}
        <button type="button" class="icon-btn ghost full-screen-button" title="Full screen" aria-label="Full screen" onclick={() => (reading = true)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10" /></svg>
        </button>
      {/if}
      {#if barMenuItems.length}
        <MoreButton
          expanded={barMenuOpen}
          bind:anchor={barMenuEl}
          onclick={() => (barMenuOpen = !barMenuOpen)}
        />
        {#if barMenuOpen}
          <ActionMenu
            anchor={barMenuEl}
            items={barMenuItems}
            label="Note actions"
            onClose={() => (barMenuOpen = false)}
          />
        {/if}
      {/if}
    </div>
  </div>

  {#if !loaded || !activeId}
    <div class="skeleton" aria-busy="true">
      <span class="skeleton-line" style:width="70%"></span>
      <span class="skeleton-line" style:width="85%"></span>
      <span class="skeleton-line" style:width="50%"></span>
    </div>
  {:else}
    {#key `${dateStr}/${activeId}`}
      <div class="note" role="tabpanel" data-nid={activeId} in:fade={{ duration: 120 }}>
        <NoteEditor nid={activeId} variant="day" hideTitle hideActions bind:reading onDelete={deleteFor(activeId)} />
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
    margin-bottom: 0.75rem;
  }
  .icon-btn.full-screen-button { width: 32px; height: 32px; }
  @media (pointer: coarse) {
    .icon-btn.full-screen-button { width: 40px; height: 40px; }
  }
  .bar-actions { display: flex; align-items: center; gap: 0.15rem; flex-shrink: 0; }
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
  .tab-lock { flex-shrink: 0; margin-right: 0.3rem; vertical-align: -1px; }
  .tab {
    flex-shrink: 0;
    height: 28px;
    max-width: 14rem;
    padding: 0 0.8rem;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
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
  .tab[data-tab] { touch-action: none; }
  .tab[data-tab]:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .tabs.reordering { user-select: none; cursor: grabbing; }
  .tabs.reordering .tab:not(.dragging) { transition: transform var(--dur-fast) var(--ease-out); }
  .tab.dragging { position: relative; z-index: 1; cursor: grabbing; background: var(--surface-subtle); transition: none; }
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
  .skeleton { display: flex; flex-direction: column; gap: 0.9rem; padding: 0.6rem 0; max-width: 70ch; }
</style>
