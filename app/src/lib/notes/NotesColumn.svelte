<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { safeFlip } from '../../utils/safeFlip'
  import { notesStore, isDayDraft, noteLabel, dayLabel } from '../../stores/notes'
  import { formatDate } from '../../utils/date'
  import NotesFilter from './NotesFilter.svelte'
  import { revealedNote, isConcealed } from '../../stores/hidden'
  import { NOTE_ACCENTS, accentColor } from './pinAccents'
  import type { NoteMetadata } from '../../types/models'
  import {
    relativeTime,
    dateBucket,
    bucketLabels,
    bucketOrder,
    type DateBucket,
  } from '../utils/relativeTime'

  // Day notes sort and group by their day, everything else by last edit or
  // creation, whichever sort is picked.
  const dayTime = (n: NoteMetadata) => (n.day ? Date.parse(n.day + 'T12:00:00') : n.updatedAt || 0)
  let listTime = $derived(
    $notesStore.sort === 'added'
      ? (n: NoteMetadata) => n.createdAt || n.updatedAt || 0
      : (n: NoteMetadata) => n.updatedAt || n.createdAt || 0,
  )

  let visibleNotes = $derived.by<NoteMetadata[]>(() => {
    const { allNotes, filter } = $notesStore
    if (filter.kind === 'trash') {
      return allNotes
        .filter((n) => !!n.deletedAt)
        .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
    }
    const live = allNotes.filter((n) => !n.deletedAt && !isDayDraft(n))
    if (filter.kind === 'pinned') {
      return live
        .filter((n) => n.pinned)
        .sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0) || (b.updatedAt || 0) - (a.updatedAt || 0))
    }
    if (filter.kind === 'day') {
      return live
        .filter((n) => n.day)
        .sort((a, b) => dayTime(b) - dayTime(a) || (a.dayOrder ?? 0) - (b.dayOrder ?? 0))
    }
    const shown =
      filter.kind === 'tag'
        ? live.filter((n) => n.tags?.includes(filter.tag))
        : filter.kind === 'untagged'
          ? live.filter((n) => !n.tags?.length)
          : filter.kind === 'notepad'
            ? live.filter((n) => !n.day)
            : live
    return shown.sort((a, b) => listTime(b) - listTime(a))
  })

  let groups = $derived.by(() => {
    const { filter } = $notesStore
    // The pinned cover and Trash keep a flat list.
    if (filter.kind === 'trash' || filter.kind === 'pinned') return null
    const now = Date.now()
    const map = new Map<DateBucket, NoteMetadata[]>()
    for (const n of visibleNotes) {
      const ts = filter.kind === 'day' ? dayTime(n) : listTime(n)
      const key = dateBucket(ts, now)
      const arr = map.get(key) ?? []
      arr.push(n)
      map.set(key, arr)
    }
    return bucketOrder
      .map((b) => ({ key: b, label: bucketLabels[b], items: map.get(b) ?? [] }))
      .filter((g) => g.items.length > 0)
  })

  // Tags worth showing on a row: the one being filtered on is implied.
  function rowTags(n: NoteMetadata): string[] {
    const f = $notesStore.filter
    return (n.tags ?? []).filter((t) => !(f.kind === 'tag' && f.tag === t)).slice(0, 3)
  }

  // Multi-select: the header icon, or Cmd/Ctrl/Shift-click a row.
  let selecting = $state(false)
  let picked = $state(new Set<string>())
  let anchorId: string | null = null

  // A new view starts with nothing picked. Keyed by value: the store updates
  // on every edit, and that shouldn't drop the selection.
  let filterKey = $derived(JSON.stringify($notesStore.filter))
  $effect(() => {
    void filterKey
    untrack(stopSelecting)
    untrack(resetPinDrag)
  })

  function stopSelecting() {
    selecting = false
    picked = new Set()
    anchorId = null
  }

  function togglePick(id: string, range: boolean) {
    const next = new Set(picked)
    const ids = visibleNotes.map((n) => n.id)
    const a = anchorId ? ids.indexOf(anchorId) : -1
    const b = ids.indexOf(id)
    if (range && a !== -1 && b !== -1) {
      for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x)
    } else {
      if (next.has(id)) next.delete(id)
      else next.add(id)
      anchorId = id
    }
    picked = next
  }

  function onRowClick(e: MouseEvent, id: string) {
    if (selecting || e.metaKey || e.ctrlKey || e.shiftKey) {
      if (!selecting) {
        selecting = true
        // Start from the open note, so Cmd-click adds to it.
        const open = $notesStore.selectedNid
        if (open && open !== id && visibleNotes.some((n) => n.id === open)) {
          picked = new Set([open])
          anchorId = open
        }
      }
      togglePick(id, e.shiftKey)
      return
    }
    notesStore.selectNote(id)
  }

  function deletePicked() {
    notesStore.trashNotes([...picked])
    stopSelecting()
  }

  async function onCreate() {
    const { filter, allNotes } = $notesStore
    if (filter.kind === 'day') {
      const day = formatDate(new Date())
      const order = Math.max(-1, ...allNotes.filter((n) => n.day === day).map((n) => n.dayOrder ?? 0)) + 1
      notesStore.createNote({ day, dayOrder: order })
    } else {
      const nid = notesStore.createNote({ tag: filter.kind === 'tag' ? filter.tag : undefined })
      // On the cover, a new note belongs there: save it, then pin it.
      if (filter.kind === 'pinned') {
        await notesStore.sessionFor(nid)?.flush()
        await notesStore.setPinned(nid, true)
      }
    }
    await tick()
    document.querySelector<HTMLInputElement>('.editor-main .note-title')?.focus()
  }

  // ---- pinned cover: colour and drag-to-reorder ---------------------------

  // Which card's palette is open.
  let accentMenu = $state<string | null>(null)

  interface PinSlot {
    id: string
    left: number
    top: number
    width: number
    height: number
  }

  let pinGridEl = $state<HTMLElement | null>(null)
  let listEl = $state<HTMLElement | null>(null)
  let pinDragId = $state<string | null>(null)
  // How far the dragged card follows the pointer.
  let pinDx = $state(0)
  let pinDy = $state(0)
  // Slot the card would land in, counted among the other cards.
  let pinDrop = $state<number | null>(null)
  let pinPointer: number | null = null
  let pinSlots: PinSlot[] = []
  let pinIds: string[] = []
  let pinStartX = 0
  let pinStartY = 0
  let pinMoved = false
  let pinLastX = 0
  let pinLastY = 0
  let pinAutoScroll = 0

  function toggleAccent(nid: string, e: MouseEvent) {
    e.stopPropagation()
    accentMenu = accentMenu === nid ? null : nid
  }

  function chooseAccent(nid: string, accent: (typeof NOTE_ACCENTS)[number]['id'], e: MouseEvent) {
    e.stopPropagation()
    accentMenu = null
    void notesStore.setAccent(nid, accent)
  }

  // A chip click (or its keyboard equivalent) opens the note; the card tools
  // handle their own events.
  function onPinCardClick(e: MouseEvent, nid: string) {
    if (accentMenu) accentMenu = null
    onRowClick(e, nid)
  }

  function onPinCardKeydown(e: KeyboardEvent, nid: string) {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (selecting) togglePick(nid, e.shiftKey)
      else notesStore.selectNote(nid)
    } else if (e.key === 'Escape' && selecting) {
      stopSelecting()
    }
  }

  // Card geometry is captured once when the gesture starts and used for the
  // whole drag, so the insertion point never wobbles as rows slide around.
  function startPinDrag(e: PointerEvent, nid: string) {
    if (selecting || e.button !== 0 || !pinGridEl) return
    e.preventDefault()
    accentMenu = null
    const gridRect = pinGridEl.getBoundingClientRect()
    pinSlots = [...pinGridEl.querySelectorAll<HTMLElement>('[data-pin-id]')].map((el) => {
      const rect = el.getBoundingClientRect()
      return {
        id: el.dataset.pinId!,
        left: rect.left - gridRect.left,
        top: rect.top - gridRect.top,
        width: rect.width,
        height: rect.height,
      }
    })
    pinIds = pinSlots.map((s) => s.id)
    pinDragId = nid
    pinPointer = e.pointerId
    pinStartX = e.clientX
    pinStartY = e.clientY
    pinDx = 0
    pinDy = 0
    pinDrop = pinIds.indexOf(nid)
    pinMoved = false
    pinLastX = e.clientX
    pinLastY = e.clientY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    startPinAutoScroll()
  }

  function onPinDragMove(e: PointerEvent) {
    if (!pinDragId || e.pointerId !== pinPointer) return
    pinMoved = true
    pinLastX = e.clientX
    pinLastY = e.clientY
    updatePinDrag()
  }

  // The dragged card follows the pointer; the card it will displace is found
  // in reading order, using geometry captured when the gesture started.
  function updatePinDrag() {
    if (!pinDragId || !pinGridEl) return
    pinDx = pinLastX - pinStartX
    pinDy = pinLastY - pinStartY
    const rect = pinGridEl.getBoundingClientRect()
    const x = pinLastX - rect.left
    const y = pinLastY - rect.top
    // A card comes before the pointer once the pointer is past its vertical
    // middle, or beside it within the same row.
    let at = 0
    for (const slot of pinSlots) {
      if (slot.id === pinDragId) continue
      const inRow = y >= slot.top && y <= slot.top + slot.height
      if (inRow ? x > slot.left + slot.width / 2 : y > slot.top + slot.height / 2) at++
    }
    pinDrop = at
  }

  // Scroll the column while the card is held near its top or bottom edge.
  // Scrolling moves the original slot with it, so the pointer offset shifts
  // by the same amount.
  function startPinAutoScroll() {
    if (pinAutoScroll) return
    const step = () => {
      if (!pinDragId || !listEl) {
        pinAutoScroll = 0
        return
      }
      const rect = listEl.getBoundingClientRect()
      const margin = 64
      let dy = 0
      if (pinMoved && pinLastY < rect.top + margin) dy = -Math.ceil((rect.top + margin - pinLastY) / 4)
      else if (pinMoved && pinLastY > rect.bottom - margin) {
        dy = Math.ceil((pinLastY - (rect.bottom - margin)) / 4)
      }
      if (dy) {
        const before = listEl.scrollTop
        listEl.scrollTop += dy
        const scrolled = listEl.scrollTop - before
        if (scrolled) {
          pinStartY -= scrolled
          updatePinDrag()
        }
      }
      pinAutoScroll = requestAnimationFrame(step)
    }
    pinAutoScroll = requestAnimationFrame(step)
  }

  // Move the pointer card itself, and slide the others into the vacated and
  // newly opened slots.
  function pinShift(nid: string): string | undefined {
    if (!pinDragId || pinDrop === null) return undefined
    const from = pinIds.indexOf(nid)
    if (from === -1) return undefined
    if (nid === pinDragId) return `translate(${pinDx}px, ${pinDy}px)`
    const others = pinIds.filter((id) => id !== pinDragId)
    const at = others.indexOf(nid)
    if (at === -1) return undefined
    const to = at < pinDrop ? at : at + 1
    if (to === from) return undefined
    const a = pinSlots[from]
    const b = pinSlots[to]
    if (!a || !b) return undefined
    return `translate(${b.left - a.left}px, ${b.top - a.top}px)`
  }

  function endPinDrag(e?: PointerEvent) {
    if (e && pinPointer !== null && e.pointerId !== pinPointer) return
    const id = pinDragId
    const at = pinDrop
    const moved = pinMoved
    const ids = pinIds
    resetPinDrag()
    if (!id || at === null || !moved || !ids.includes(id)) return
    const order = ids.filter((x) => x !== id)
    order.splice(Math.max(0, Math.min(at, order.length)), 0, id)
    void notesStore.reorderPinnedNotes(order)
  }

  function resetPinDrag() {
    if (pinAutoScroll) cancelAnimationFrame(pinAutoScroll)
    pinAutoScroll = 0
    pinDragId = null
    pinPointer = null
    pinDx = 0
    pinDy = 0
    pinDrop = null
    pinSlots = []
    pinIds = []
    pinMoved = false
  }

  function onPinHandleKeydown(e: KeyboardEvent, nid: string) {
    const step =
      e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1
      : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : 0
    if (!step) return
    e.preventDefault()
    const ids = visibleNotes.map((n) => n.id)
    const i = ids.indexOf(nid)
    const j = i + step
    if (i === -1 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    void notesStore.reorderPinnedNotes(ids)
  }

  function onPinWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && pinDragId) {
      e.preventDefault()
      resetPinDrag()
    }
  }

  // Close an open palette on any click outside one.
  $effect(() => {
    if (!accentMenu) return
    const onDown = (e: PointerEvent) => {
      if (e.composedPath().some((n) => n instanceof HTMLElement && n.classList.contains('pin-palette-wrap'))) return
      accentMenu = null
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  })
</script>

<svelte:window onkeydown={onPinWindowKeydown} />

<section class="notes-col" class:selecting>
  <header class="col-header">
    <NotesFilter />
    <div class="col-actions">
      {#if $notesStore.filter.kind === 'trash'}
        {#if visibleNotes.length > 0}
          <button class="text-action danger" onclick={() => notesStore.emptyTrash()}>Empty trash</button>
        {/if}
      {:else if selecting}
        <button class="text-action danger" disabled={picked.size === 0} onclick={deletePicked}>
          Delete{picked.size ? ` ${picked.size}` : ''}
        </button>
        <button type="button" class="icon-btn selection-toggle active" title="Done selecting notes" aria-label="Done selecting notes" aria-pressed="true" onclick={stopSelecting}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="m5 8 2 2 4-4" /></svg>
        </button>
      {:else}
        {#if visibleNotes.length > 0}
          <button type="button" class="icon-btn selection-toggle" title="Select notes" aria-label="Select notes" aria-pressed="false" onclick={() => (selecting = true)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="m5 8 2 2 4-4" /></svg>
          </button>
        {/if}
        <button type="button" class="icon-btn" title="New note" aria-label="New note" onclick={onCreate}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
        </button>
      {/if}
    </div>
  </header>

  <div class="col-list" bind:this={listEl}>
    {#if visibleNotes.length === 0}
      <div class="empty">
        {#if !$notesStore.loaded}
          <div class="empty-headline">Loading…</div>
        {:else if $notesStore.filter.kind === 'trash'}
          <div class="empty-headline">Trash is empty</div>
          <div class="empty-sub">Notes you delete will rest here.</div>
        {:else if $notesStore.filter.kind === 'day'}
          <div class="empty-headline">No journal notes yet</div>
          <div class="empty-sub">Notes you write in Journal land here.</div>
        {:else if $notesStore.filter.kind === 'pinned'}
          <div class="empty-headline">Nothing pinned yet</div>
          <div class="empty-sub">Open a note and pin it from its ⋯ menu to keep it here.</div>
        {:else}
          <div class="empty-headline">No notes here</div>
          <div class="empty-sub">Hit + above to start writing.</div>
        {/if}
      </div>
    {:else if $notesStore.filter.kind === 'trash'}
      <div class="rows">
        {#each visibleNotes as n (n.id)}
          <div class="row trash-row">
            <div class="row-body">
              <div class="row-title">{noteLabel(n)}</div>
              {#if isConcealed(n, $revealedNote)}
                <div class="row-preview muted">Hidden note</div>
              {:else if n.preview}
                <div class="row-preview">{n.preview}</div>
              {/if}
              <div class="row-meta">
                {#if n.hidden}<svg class="lock-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Hidden" role="img"><path d="M4.5 7.5h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" /><path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2" /></svg>{/if}
                <span>{relativeTime(n.deletedAt ?? n.updatedAt)}</span>
                {#if n.day}
                  <span class="meta-dot" aria-hidden="true">·</span>
                  <span class="row-tag">Day note</span>
                {/if}
              </div>
            </div>
            <div class="row-actions">
              <button
                class="row-action"
                title="Restore"
                aria-label="Restore note"
                onclick={() => notesStore.restoreNote(n.id)}
              ><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.5L3 6M3 3v3h3"/></svg></button>
              <button
                class="row-action danger"
                title="Delete forever"
                aria-label="Delete forever"
                onclick={() => notesStore.permanentlyDeleteNote(n.id)}
              ><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></button>
            </div>
          </div>
        {/each}
      </div>
    {:else if $notesStore.filter.kind === 'pinned'}
      <div class="pin-grid" class:dragging={!!pinDragId} bind:this={pinGridEl}>
        {#each visibleNotes as n (n.id)}
          {@const accent = accentColor(n.accent)}
          <div
            class="pin-card"
            class:active={!selecting && n.id === $notesStore.selectedNid}
            class:picked={picked.has(n.id)}
            class:dragging={pinDragId === n.id}
            data-pin-id={n.id}
            role="button"
            tabindex="0"
            aria-pressed={selecting ? picked.has(n.id) : undefined}
            style:--pin-accent={accent ?? 'var(--border-subtle)'}
            style:transform={pinShift(n.id)}
            animate:safeFlip={{ duration: 180 }}
            onclick={(e) => onPinCardClick(e, n.id)}
            onkeydown={(e) => onPinCardKeydown(e, n.id)}
          >
            <div class="pin-head">
              {#if selecting}
                <span class="check pin-check" aria-hidden="true">
                  {#if picked.has(n.id)}
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                  {/if}
                </span>
              {/if}
              <div class="pin-title">{noteLabel(n)}</div>
              {#if n.hidden}<svg class="lock-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Hidden" role="img"><path d="M4.5 7.5h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" /><path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2" /></svg>{/if}
            </div>
            {#if isConcealed(n, $revealedNote)}
              <div class="pin-preview muted">Hidden note</div>
            {:else if n.preview}
              <div class="pin-preview">{n.preview}</div>
            {:else}
              <div class="pin-preview muted">No content yet</div>
            {/if}
            <div class="pin-foot">
              <div class="pin-meta">
                {#if n.day}<span class="row-tag day">{dayLabel(n.day)}</span>{/if}
                {#each (n.tags ?? []).slice(0, 3) as t (t)}
                  <button
                    type="button"
                    class="tag-badge tag-link"
                    aria-label="Open #{t} collection"
                    onclick={(e) => { e.stopPropagation(); notesStore.setFilter({ kind: 'tag', tag: t }) }}
                  >#{t}</button>
                {/each}
              </div>
              {#if !selecting}
                <div class="pin-tools">
                  <button
                    type="button"
                    class="pin-tool pin-grip"
                    title="Drag to reorder"
                    aria-label="Drag to reorder"
                    onpointerdown={(e) => startPinDrag(e, n.id)}
                    onpointermove={onPinDragMove}
                    onpointerup={endPinDrag}
                    onpointercancel={endPinDrag}
                    onlostpointercapture={endPinDrag}
                    onkeydown={(e) => onPinHandleKeydown(e, n.id)}
                    onclick={(e) => e.stopPropagation()}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
                  </button>
                  <div class="pin-palette-wrap">
                    <button
                      type="button"
                      class="pin-tool"
                      class:active={accentMenu === n.id}
                      title="Card colour"
                      aria-label="Card colour"
                      aria-haspopup="true"
                      aria-expanded={accentMenu === n.id}
                      onclick={(e) => toggleAccent(n.id, e)}
                    >
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.2a5.8 5.8 0 1 0 0 11.6c.9 0 1.4-.6 1.4-1.3 0-.4-.2-.7-.4-1-.2-.2-.3-.5-.3-.8 0-.7.5-1.1 1.2-1.1h.9c1.3 0 2.2-.9 2.2-2.2A5.2 5.2 0 0 0 8 2.2z" /><circle cx="5.6" cy="6.2" r=".7" fill="currentColor" stroke="none" /><circle cx="8" cy="4.8" r=".7" fill="currentColor" stroke="none" /><circle cx="10.6" cy="6.2" r=".7" fill="currentColor" stroke="none" /></svg>
                    </button>
                    {#if accentMenu === n.id}
                      <div class="pin-palette" role="group" aria-label="Card colour">
                        {#each NOTE_ACCENTS as a (a.id)}
                          <button
                            type="button"
                            class="pin-swatch"
                            class:current={n.accent === a.id}
                            style:--swatch={a.color}
                            title={a.label}
                            aria-label={`${a.label} accent`}
                            aria-pressed={n.accent === a.id}
                            onclick={(e) => chooseAccent(n.id, a.id, e)}
                          ></button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                  <button
                    type="button"
                    class="pin-tool"
                    title="Unpin from cover"
                    aria-label="Unpin from cover"
                    onclick={(e) => { e.stopPropagation(); void notesStore.setPinned(n.id, false) }}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.5h4v3l2 1.5v1H4v-1l2-1.5z" /><path d="M8 8v5.5" /></svg>
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else if groups}
      {#each groups as group (group.key)}
        <div class="group-header">{group.label}</div>
        <div class="rows">
          {#each group.items as n (n.id)}
            <div
              class="row"
              class:active={!selecting && n.id === $notesStore.selectedNid}
              class:picked={picked.has(n.id)}
              role="button"
              aria-pressed={selecting ? picked.has(n.id) : undefined}
              tabindex="0"
              animate:safeFlip={{ duration: 180 }}
              onmousedown={(e) => {
                // Keep Shift-click from highlighting text.
                if (e.shiftKey) e.preventDefault()
              }}
              onclick={(e) => onRowClick(e, n.id)}
              onkeydown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  if (selecting) togglePick(n.id, e.shiftKey)
                  else notesStore.selectNote(n.id)
                } else if (e.key === 'Escape' && selecting) {
                  stopSelecting()
                }
              }}
            >
              {#if selecting}
                <span class="check" aria-hidden="true">
                  {#if picked.has(n.id)}
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                  {/if}
                </span>
              {/if}
              <div class="row-body">
                <div class="row-title">{noteLabel(n)}</div>
                {#if isConcealed(n, $revealedNote)}
                  <div class="row-preview muted">Hidden note</div>
                {:else if n.preview}
                  <div class="row-preview">{n.preview}</div>
                {:else}
                  <div class="row-preview muted">No content yet</div>
                {/if}
                <div class="row-meta">
                  {#if n.hidden}<svg class="lock-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Hidden" role="img"><path d="M4.5 7.5h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" /><path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2" /></svg>{/if}
                  {#if n.pinned}<svg class="lock-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-label="Pinned" role="img"><path d="M6 2.5h4v3l2 1.5v1H4v-1l2-1.5z" /><path d="M8 8v5.5" /></svg>{/if}
                  {#if n.day && n.title.trim() && $notesStore.filter.kind !== 'day'}
                    <span class="row-tag day">{dayLabel(n.day)}</span>
                  {:else}
                    <span>{relativeTime($notesStore.filter.kind === 'day' ? n.updatedAt : listTime(n))}</span>
                  {/if}
                  {#each rowTags(n) as t (t)}
                    <button
                      type="button"
                      class="tag-badge tag-link"
                      aria-label="Open #{t} collection"
                      onclick={(e) => { e.stopPropagation(); notesStore.setFilter({ kind: 'tag', tag: t }) }}
                    >#{t}</button>
                  {/each}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
</section>

<style>
  .notes-col {
    width: 340px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border-subtle);
    background: var(--surface-subtle);
    min-height: 0;
    font-family: var(--font-ui, inherit);
  }
  .col-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--workspace-header-height);
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border-subtle);
    gap: 0.75rem;
  }
  .col-actions { display: flex; gap: 0.4rem; align-items: center; min-height: 32px; }

  .icon-btn {
    background: none;
    border: 1px solid var(--line);
    color: var(--accent);
    cursor: pointer;
    width: 32px;
    height: 32px;
    border-radius: var(--r-sm);
    font-size: 1.1rem;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .icon-btn:hover {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: var(--accent);
  }
  .icon-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .selection-toggle.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); }
  @media (pointer: coarse) {
    .icon-btn { width: 40px; height: 40px; }
  }
  .icon-btn svg { width: 15px; height: 15px; display: block; }

  .text-action {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.78rem;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    white-space: nowrap;
    transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }
  .text-action:hover { color: var(--text); background: var(--glass-dark); }
  .text-action.danger:hover:not(:disabled) { color: var(--danger); background: var(--danger-bg); }
  .text-action:disabled { opacity: 0.4; cursor: default; }
  .text-action:disabled:hover { background: none; color: var(--muted); }

  .col-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0.5rem 1rem;
    min-height: 0;
  }

  .group-header {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    padding: 0.85rem 0.75rem 0.4rem;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /* ---- pinned cover -------------------------------------------------- */

  .pin-grid {
    position: relative;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
    gap: 8px;
    padding: 0.25rem 0.25rem 0.5rem;
  }
  .pin-grid.dragging { cursor: grabbing; }
  .pin-grid.dragging .pin-card:not(.dragging) {
    transition: transform 170ms var(--ease-out);
  }
  .pin-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    min-height: 98px;
    padding: 0.65rem 0.6rem 0.5rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--pin-accent) 30%, var(--border-subtle));
    border-left: 3px solid var(--pin-accent);
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--pin-accent) 8%, var(--bg));
    cursor: pointer;
    animation: row-in var(--dur-base) var(--ease-out);
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .pin-card:hover { background: color-mix(in srgb, var(--pin-accent) 13%, var(--bg)); }
  .pin-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .pin-card.active,
  .pin-card.picked {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--pin-accent));
    background: color-mix(in srgb, var(--pin-accent) 16%, var(--bg));
  }
  .pin-card.dragging {
    z-index: 2;
    cursor: grabbing;
    box-shadow: var(--shadow-pop);
    background: color-mix(in srgb, var(--pin-accent) 16%, var(--panel));
  }
  .selecting .pin-card { user-select: none; }

  .pin-head {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
  }
  .pin-title {
    flex: 1;
    min-width: 0;
    font-size: 0.87rem;
    font-weight: 650;
    line-height: 1.3;
    color: var(--text);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }
  .pin-head .lock-icon { flex-shrink: 0; margin-top: 2px; }
  .pin-check { margin-top: 1px; }

  .pin-preview {
    flex: 1;
    font-size: 0.75rem;
    line-height: 1.35;
    color: var(--muted);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }
  .pin-preview.muted { opacity: 0.5; font-style: italic; }

  .pin-foot {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 22px;
    margin-top: auto;
  }
  .pin-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 0.68rem;
    color: var(--muted);
  }
  .pin-meta .tag-link {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pin-meta .row-tag { overflow: hidden; text-overflow: ellipsis; }

  .pin-tools {
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
    opacity: 0.5;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .pin-card:hover .pin-tools,
  .pin-card:focus-within .pin-tools { opacity: 1; }
  .pin-tool {
    width: 24px;
    height: 24px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--r-xs);
    background: none;
    color: var(--muted);
    cursor: pointer;
    touch-action: none;
  }
  .pin-tool svg { width: 14px; height: 14px; display: block; }
  .pin-tool:hover { color: var(--text); background: var(--glass-dark); }
  .pin-tool.active { color: var(--accent); background: var(--glass-dark); }
  .pin-tool:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .pin-grip { cursor: grab; }
  .pin-grip:active { cursor: grabbing; }

  .pin-palette-wrap { position: relative; }
  .pin-palette {
    position: absolute;
    right: 0;
    bottom: calc(100% + 5px);
    z-index: var(--z-popover);
    display: flex;
    gap: 5px;
    padding: 6px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    box-shadow: var(--shadow-pop);
    animation: popIn var(--dur-pop) var(--ease-spring);
  }
  .pin-swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--swatch) 70%, var(--line));
    background: var(--swatch);
    cursor: pointer;
  }
  .pin-swatch:hover { transform: scale(1.1); }
  .pin-swatch.current { box-shadow: 0 0 0 2px var(--panel), 0 0 0 3px var(--swatch); }
  .pin-swatch:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }

  /* Touch devices can't hover, so keep the card tools visible. */
  @media (hover: none) {
    .pin-tools { opacity: 1; }
  }

  .row {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.65rem 0.75rem;
    border-radius: var(--r-md);
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-out);
    animation: row-in var(--dur-base) var(--ease-out);
  }
  .row:hover { background: var(--glass-dark); }
  .row:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .row.active,
  .row.picked {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .row.active:hover,
  .row.picked:hover {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }

  .row-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .row-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row.active .row-title { color: var(--text); }
  .row-preview {
    font-size: 0.82rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.35;
  }
  .row-preview.muted { opacity: 0.5; font-style: italic; }
  .row-meta .lock-icon { flex-shrink: 0; }
  .row-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    color: var(--muted);
    margin-top: 2px;
  }
  .meta-dot { opacity: 0.6; }
  .row-meta { min-width: 0; overflow: hidden; }
  .row-tag {
    padding: 1px 6px;
    border-radius: var(--r-xs);
    background: var(--glass-dark);
    font-size: 0.68rem;
    white-space: nowrap;
  }
  .row-tag.day { color: var(--accent); }
  .tag-link {
    --tag-font-size: 0.6875rem;
    flex-shrink: 0;
    white-space: nowrap;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border-subtle));
  }
  .tag-link:hover {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border-subtle));
  }
  .tag-link:active { background: color-mix(in srgb, var(--accent) 24%, transparent); }

  .row-actions { display: flex; gap: 2px; align-items: flex-start; }
  .row-action {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    width: 28px;
    height: 28px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }
  .row-action:hover { color: var(--text); background: var(--glass); }
  .row-action.danger:hover { color: var(--danger); background: var(--danger-bg); }
  .selecting .row { user-select: none; }
  .check {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-top: 3px;
    border: 1.5px solid var(--line);
    border-radius: var(--r-xs);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text);
    transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }
  .row.picked .check { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .check svg { width: 12px; height: 12px; display: block; }

  .trash-row { font-style: normal; }
  .trash-row .row-title { opacity: 0.85; }

  .empty {
    text-align: center;
    padding: 3rem 1.5rem;
    color: var(--muted);
  }
  .empty-headline { font-size: 0.95rem; opacity: 0.7; }
  .empty-sub { font-size: 0.8rem; opacity: 0.5; margin-top: 0.4rem; }

  @keyframes row-in {
    from { opacity: 0; transform: translateY(2px); }
    to { opacity: 1; transform: none; }
  }

  @media (max-width: 900px) {
    .notes-col {
      width: 100%;
      border: none;
      flex: 1;
      min-height: 0;
    }
    .col-header { padding: 0.6rem 0.75rem; gap: 0.4rem; }
    .col-list { padding: 0.5rem; }
    .col-actions { gap: 0.25rem; }
    /* Generous tap targets on touch — 40px square. */
    .icon-btn { width: 40px; height: 40px; }
    .icon-btn svg { width: 18px; height: 18px; }
    .text-action { padding: 10px 12px; font-size: 0.85rem; }
    .row { padding: 0.6rem 0.75rem; }
    .row-action { width: 40px; height: 40px; }
    .pin-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    .pin-card { padding: 0.75rem 0.7rem 0.6rem 0.85rem; }
    .pin-tool { width: 30px; height: 30px; }
    .pin-tool svg { width: 16px; height: 16px; }
  }
</style>
