<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { safeFlip } from '../../utils/safeFlip'
  import { slide } from 'svelte/transition'
  import { appStore } from '../../stores/app'
  import { logsStore, sortTasks } from '../../stores/logs'
  import { formatDate } from '../../utils/date'
  import { bindSnapshotTriggers } from '../../utils/snapshotTriggers'
  import { parseQuickTask } from './quickTask'
  import HistoryPopover from '../ui/HistoryPopover.svelte'
  import ActionMenu from '../ui/ActionMenu.svelte'
  import MoreButton from '../ui/MoreButton.svelte'
  import { LINK_ICON, type ActionMenuItem } from '../ui/menuItem'
  import { linkTo } from '../../router/sync'
  import { showError, showToast } from '../../stores/toast'
  import TimePicker from '../ui/TimePicker.svelte'
  import MoveToDatePopover from './MoveToDatePopover.svelte'
  import { formatClock, pomodoroStore, EXTENSION_ID } from '../../stores/pomodoro'
  import { preferencesStore } from '../../stores/preferences'
  import { extensionState } from '../extensions/registry'
  import type { Task } from '../../types/models'

  let dateStr = $derived(formatDate($appStore.selectedDate))
  let loaded = $derived(dateStr in $logsStore.byDate)
  let tasks = $derived(sortTasks($logsStore.byDate[dateStr]?.tasks ?? []))

  // A task with subtasks becomes a group header: it no longer counts as a
  // completable task, its children do.
  let parentIds = $derived(new Set(tasks.filter((t) => t.parentId).map((t) => t.parentId!)))
  let leafTasks = $derived(tasks.filter((t) => !parentIds.has(t.id)))
  let doneCount = $derived(leafTasks.filter((t) => t.done).length)

  // Subtasks live in the same list, linked by parentId. Render parents with
  // their children directly underneath, then a group add row.
  type Row = { task: Task; depth: number; header: boolean; addRow?: boolean; now?: boolean; index: number }
  // Placeholder for the "now" divider, which needs a row but isn't a task.
  const NOW_TASK: Task = { id: '__now__', text: '', done: false, order: 0 }
  let topLevel = $derived.by(() => {
    const ids = new Set(tasks.map((t) => t.id))
    return tasks.filter((t) => !t.parentId || !ids.has(t.parentId))
  })
  let baseRows = $derived.by(() => {
    const out: Row[] = []
    let index = 0
    for (const parent of topLevel) {
      const children = sortTasks(tasks.filter((t) => t.parentId === parent.id))
      const header = children.length > 0
      out.push({ task: parent, depth: 0, header, index: index++ })
      for (const child of children) {
        out.push({ task: child, depth: 1, header: false, index: index++ })
      }
      if (header) out.push({ task: parent, depth: 1, header: false, addRow: true, index: -1 })
    }
    return out
  })
  let taskRows = $derived(baseRows.filter((r) => !r.addRow))

  // Minute ticker for the "now" marker.
  let nowMinutes = $state(minutesNow())
  function minutesNow() {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  }
  const ticker = setInterval(() => (nowMinutes = minutesNow()), 30_000)
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  let isToday = $derived(dateStr === formatDate(new Date()))
  // Index of the first timed task that's still ahead of now; the marker sits
  // just above it. Hidden when there's no timed task on either side.
  let nowIndex = $derived.by(() => {
    if (!isToday) return -1
    if (!taskRows.some((r) => r.task.time)) return -1
    const idx = taskRows.findIndex((r) => r.task.time && toMinutes(r.task.time) > nowMinutes)
    if (idx === 0) return -1
    if (idx !== -1) return idx
    // Every timed task is in the past: sit before the next untimed one.
    let lastTimed = -1
    for (let i = 0; i < taskRows.length; i++) if (taskRows[i].task.time) lastTimed = i
    const next = taskRows.findIndex((r, i) => i > lastTimed && r.depth === 0 && !r.task.time)
    return next === -1 ? taskRows.length : next
  })

  // The "now" divider is its own row, so dragging a task never carries it along.
  let rows = $derived.by(() => {
    if (nowIndex === -1) return baseRows
    const marker: Row = { task: NOW_TASK, depth: 0, header: false, now: true, index: -1 }
    const out: Row[] = []
    let inserted = false
    for (const row of baseRows) {
      if (!row.addRow && row.index === nowIndex) {
        out.push(marker)
        inserted = true
      }
      out.push(row)
    }
    if (!inserted) out.push(marker)
    return out
  })

  // ---- add -----------------------------------------------------------------

  // Typing in the add row creates the task on the first character and moves
  // the cursor into its row. A time and comment picked in the add row before
  // typing go with it. A time typed into the text ("14:30 Gym") is pulled out
  // once the new row loses focus; an explicit pick wins over it.
  let draft = $state('')
  let draftTime = $state<string | undefined>(undefined)
  let draftComment = $state('')
  let draftCommentOpen = $state(false)
  let addInput = $state<HTMLInputElement | null>(null)
  // The task just created from the add row or a subtask button, until its
  // row loses focus. freshIsSubtask skips the quick-time parsing.
  let freshId = $state<string | null>(null)
  let freshIsSubtask = $state(false)

  function resetDraft() {
    draft = ''
    draftTime = undefined
    draftComment = ''
    draftCommentOpen = false
  }

  async function createFromDraft() {
    const text = draft.trimStart()
    if (!text) {
      draft = ''
      return
    }
    const ds = dateStr
    const task = logsStore.addTask(ds, {
      text,
      time: draftTime,
      comment: draftComment.trim() || undefined,
    })
    finishFresh()
    freshId = task.id
    resetDraft()
    await tick()
    if (dateStr === ds) focusTask(task.id)
  }

  // Done with the task created from the add row: pull a typed time out of
  // its text, or drop it if it was emptied.
  function finishFresh() {
    const id = freshId
    const subtask = freshIsSubtask
    freshId = null
    freshIsSubtask = false
    if (!id) return
    const task = $logsStore.byDate[dateStr]?.tasks.find((t) => t.id === id)
    if (!task) return
    if (!task.text.trim() && !task.comment) {
      logsStore.removeTask(dateStr, id, { quiet: true })
      return
    }
    if (subtask || task.time) return
    const parsed = parseQuickTask(task.text)
    if (parsed.time && parsed.text) logsStore.editTask(dateStr, id, { text: parsed.text, time: parsed.time })
  }

  // Add an empty subtask and put the cursor in it. Blurring it while empty
  // removes it again, so a mis-click costs nothing.
  async function addSubtask(parent: Task) {
    finishFresh()
    const child = logsStore.addTask(dateStr, { text: '', parentId: parent.id })
    freshId = child.id
    freshIsSubtask = true
    await tick()
    focusTask(child.id)
  }

  // Enter at the end of a subtask continues the list with a new sibling.
  async function addSibling(task: Task) {
    if (!task.parentId) return
    const parentId = task.parentId
    finishFresh()
    const sibling = logsStore.addTask(dateStr, { text: '', parentId })
    freshId = sibling.id
    freshIsSubtask = true
    await tick()
    focusTask(sibling.id)
  }

  // ---- group add rows ------------------------------------------------------

  // Each group gets its own add row, same idea and style as the global one:
  // the first typed character becomes the new subtask and the cursor follows.
  let groupDrafts = $state<Record<string, string>>({})

  function focusGroupAdd(id: string) {
    listEl?.querySelector<HTMLInputElement>(`[data-group-add="${id}"]`)?.focus()
  }

  function clearGroupDraft(id: string) {
    const next = { ...groupDrafts }
    delete next[id]
    groupDrafts = next
    // The draft is set and cleared in the same tick, so Svelte can think the
    // value never changed and leave the typed character in the DOM input.
    const input = listEl?.querySelector<HTMLInputElement>(`[data-group-add="${id}"]`)
    if (input) input.value = ''
  }

  async function createGroupTaskFromDraft(parent: Task) {
    const text = (groupDrafts[parent.id] ?? '').trimStart()
    if (!text) return
    const ds = dateStr
    finishFresh()
    const child = logsStore.addTask(ds, { text, parentId: parent.id })
    freshId = child.id
    freshIsSubtask = true
    clearGroupDraft(parent.id)
    await tick()
    if (dateStr === ds) focusTask(child.id)
  }

  function onGroupAddInput(parent: Task, e: Event & { currentTarget: HTMLInputElement }) {
    groupDrafts = { ...groupDrafts, [parent.id]: e.currentTarget.value }
    if ((e as Event as InputEvent).isComposing) return
    void createGroupTaskFromDraft(parent)
  }

  function onGroupAddKeydown(e: KeyboardEvent, parent: Task) {
    if (e.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      void createGroupTaskFromDraft(parent)
    } else if (e.key === 'Escape') {
      clearGroupDraft(parent.id)
      ;(e.currentTarget as HTMLInputElement | null)?.blur()
    }
  }

  function onAddInput(e: Event & { currentTarget: HTMLInputElement }) {
    draft = e.currentTarget.value
    if ((e as Event as InputEvent).isComposing) return
    void createFromDraft()
  }

  async function toggleDraftComment() {
    draftCommentOpen = !draftCommentOpen
    if (draftCommentOpen) {
      await tick()
      document.querySelector<HTMLTextAreaElement>('.add-comment')?.focus()
    } else {
      draftComment = ''
      addInput?.focus()
    }
  }

  // Enter goes back to the task text; Shift+Enter is a newline in the comment.
  function onDraftCommentKeydown(e: KeyboardEvent) {
    if (e.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      addInput?.focus()
    } else if (e.key === 'Escape') {
      toggleDraftComment()
    }
  }

  function onAddKeydown(e: KeyboardEvent) {
    if (e.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
    } else if (e.key === 'Escape') {
      resetDraft()
      addInput?.blur()
    } else if (e.key === 'ArrowUp' && taskRows.length) {
      e.preventDefault()
      focusTask(taskRows[taskRows.length - 1].task.id)
    }
  }

  // ---- row editing ---------------------------------------------------------

  let listEl = $state<HTMLElement | null>(null)
  let openComments = $state(new Set<string>())

  function focusTask(id: string, caret: 'end' | 'start' = 'end') {
    const el = listEl?.querySelector<HTMLTextAreaElement>(`[data-task-input="${id}"]`)
    if (!el) return
    el.focus()
    const pos = caret === 'end' ? el.value.length : 0
    el.setSelectionRange(pos, pos)
  }

  function onTextKeydown(e: KeyboardEvent, task: Task, index: number, header: boolean) {
    if (e.isComposing) return
    const input = e.currentTarget as HTMLTextAreaElement
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !header) {
      e.preventDefault()
      logsStore.editTask(dateStr, task.id, { done: !task.done }, { immediate: true })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (header) focusGroupAdd(task.id)
      else if (task.parentId) void addSibling(task)
      else addInput?.focus()
    } else if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault()
      focusTask(taskRows[index - 1].task.id)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (index < taskRows.length - 1) focusTask(taskRows[index + 1].task.id)
      else addInput?.focus()
    } else if (e.key === 'Backspace' && input.value === '' && !task.comment && !header) {
      e.preventDefault()
      // Backing out of a task that was just started returns to where it came from.
      if (task.id === freshId) {
        freshId = null
        freshIsSubtask = false
        logsStore.removeTask(dateStr, task.id, { quiet: true })
        if (task.parentId) {
          const prev = taskRows[index - 1]
          if (prev) tick().then(() => focusTask(prev.task.id))
          else addInput?.focus()
        } else {
          addInput?.focus()
        }
        return
      }
      const prev = taskRows[index - 1]?.task
      logsStore.removeTask(dateStr, task.id)
      if (prev) tick().then(() => focusTask(prev.id))
      else addInput?.focus()
    } else if (e.key === 'Escape' && task.id === freshId) {
      input.blur()
    }
  }

  function toggleComment(id: string) {
    const next = new Set(openComments)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    openComments = next
    if (next.has(id)) {
      tick().then(() => listEl?.querySelector<HTMLTextAreaElement>(`[data-task-comment="${id}"]`)?.focus())
    }
  }

  function autosize(el: HTMLTextAreaElement) {
    const fit = () => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
    fit()
    el.addEventListener('input', fit)
    return { destroy: () => el.removeEventListener('input', fit) }
  }

  // ---- pomodoro ------------------------------------------------------------

  let timer = $derived($pomodoroStore)
  let pomodoroOn = $derived(extensionState($preferencesStore.extensions, EXTENSION_ID).enabled)
  let focusedId = $derived(timer.mode === 'focus' ? timer.taskId : null)

  function toggleFocus(task: Task) {
    pomodoroStore.focusOn({ id: task.id, text: task.text.trim() || 'Task', dateStr })
  }

  // ---- reordering ----------------------------------------------------------

  interface DragRow {
    id: string
    parentId: string | null
    header: boolean
    timed: boolean
    // Position in the rendered list and its top/height in list coordinates.
    index: number
    top: number
    height: number
  }

  interface DragBlock {
    // Every row in the block that moves together — a group header takes its
    // subtasks along.
    ids: string[]
    startIndex: number
    endIndex: number
  }

  // A top-level row, with the full height of its group, used when a group
  // itself is being dragged (groups stay top-level).
  interface DragTopTarget {
    id: string
    timed: boolean
    top: number
    height: number
  }

  let reorderMode = $state(false)
  let desktopReorder = $state(false)

  onMount(() => {
    // Match the phone layout, and keep touch-only devices in explicit mode.
    const media = window.matchMedia('(min-width: 601px) and (hover: hover) and (pointer: fine)')
    const update = () => {
      resetDrag()
      desktopReorder = media.matches
      reorderMode = false
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  })
  let dragId = $state<string | null>(null)
  // How far the dragged block follows the pointer, and where the gap opens.
  let dragOffset = $state(0)
  let dropIndex = $state<number | null>(null)

  let dragRows: DragRow[] = []
  let dragBlock: DragBlock | null = null
  let dragTopTargets: DragTopTarget[] = []
  // Where the drop will land, independent of the gap animation.
  let dropParentId: string | null = null
  let dropSiblingIndex = 0
  let dragHeight = 0
  let dragPointer: number | null = null
  let dragStartListY = 0
  let lastPointerY = 0
  let dragMoved = false
  let autoScrollFrame = 0

  // Siblings share a parent (top-level tasks have none). A group header
  // moves with its subtasks; a single task can move between a group and the
  // top level.
  const siblingsOf = (task: Task): Task[] => {
    const parentId = task.parentId ?? null
    return tasks.filter((t) => (t.parentId ?? null) === parentId)
  }
  const untimedSiblings = (task: Task): Task[] => siblingsOf(task).filter((t) => !t.time)
  const untimedIdsForParent = (parentId: string | null): string[] =>
    tasks.filter((t) => (t.parentId ?? null) === parentId && !t.time).map((t) => t.id)
  const topLevelUntimedIds = (): string[] => topLevel.filter((t) => !t.time).map((t) => t.id)
  const blockIds = (task: Task): string[] =>
    task.parentId
      ? [task.id]
      : [task.id, ...tasks.filter((t) => t.parentId === task.id).map((t) => t.id)]

  function blockRect(task: Task, listRect: DOMRect) {
    const rects = blockIds(task)
      .map((id) => listEl?.querySelector<HTMLElement>(`[data-task-id="${id}"]`)?.getBoundingClientRect())
      .filter((r): r is DOMRect => !!r)
    if (!rects.length) return { top: 0, height: 0 }
    const top = Math.min(...rects.map((r) => r.top))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    return { top: top - listRect.top, height: bottom - top }
  }

  function toggleReorder() {
    if (dragId) endDrag()
    reorderMode = !reorderMode
    if (reorderMode) exitSelect()
  }

  function startDrag(e: PointerEvent, task: Task) {
    if ((!desktopReorder && !reorderMode) || task.time || e.button !== 0 || !listEl) return
    e.preventDefault()
    const listRect = listEl.getBoundingClientRect()
    // Keep every rendered row's geometry for the whole gesture. Add rows and
    // the now marker aren't targets; everything else is.
    dragRows = rows
      .filter((row) => !row.now && !row.addRow)
      .map((row, index) => {
        const rect = listEl?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(row.task.id)}"]`)?.getBoundingClientRect()
        return {
          id: row.task.id,
          parentId: row.task.parentId ?? null,
          header: row.header,
          timed: !!row.task.time,
          index,
          top: rect ? rect.top - listRect.top : 0,
          height: rect?.height ?? 0,
        }
      })
    const ids = blockIds(task)
    const block = dragRows.filter((row) => ids.includes(row.id))
    if (!block.length) return
    const startIndex = block[0].index
    const endIndex = block[block.length - 1].index
    const last = block[block.length - 1]
    const top = block[0].top
    dragBlock = { ids, startIndex, endIndex }
    dragTopTargets = topLevel.map((t) => {
      const rect = blockRect(t, listRect)
      return {
        id: t.id,
        timed: !!t.time,
        top: rect.top,
        height: rect.height,
      }
    })
    dragId = task.id
    dragPointer = e.pointerId
    dragHeight = last.top + last.height - top + 2
    dragStartListY = e.clientY - listRect.top
    dragOffset = 0
    dropIndex = startIndex
    dropParentId = task.parentId ?? null
    dropSiblingIndex = Math.max(0, untimedSiblings(task).findIndex((t) => t.id === task.id))
    lastPointerY = e.clientY
    dragMoved = false
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    startAutoScroll()
  }

  // Rows keep their original geometry for the whole drag, so the insertion
  // point stays stable while the other rows slide around to make room.
  function updateDrag(clientY: number) {
    if (!dragId || !listEl || !dragBlock) return
    const listRect = listEl.getBoundingClientRect()
    const pointerY = clientY - listRect.top
    dragOffset = pointerY - dragStartListY
    if (dragBlock.ids.length > 1) updateGroupDrag(pointerY)
    else updateTaskDrag(pointerY)
  }

  // A group moves as one block and stays top-level, so it only targets the
  // gaps between top-level blocks.
  function updateGroupDrag(pointerY: number) {
    const targets = dragTopTargets.filter((t) => t.id !== dragId)
    let at = 0
    for (const t of targets) if (pointerY > t.top + t.height / 2) at++
    dropParentId = null
    const ids = topLevelUntimedIds().filter((id) => id !== dragId)
    const nextUntimed = targets.slice(at).find((t) => !t.timed)
    dropSiblingIndex = nextUntimed ? ids.indexOf(nextUntimed.id) : ids.length
    if (dropSiblingIndex < 0) dropSiblingIndex = ids.length
    dropIndex = dropDisplayIndex(dropParentId, dropSiblingIndex)
  }

  // A single task can land in any group or at the top level. The half of the
  // row under the pointer decides whether it goes before or after it; the
  // lower half of a group header means the start of that group.
  function updateTaskDrag(pointerY: number) {
    // Include the source row: while the pointer is still over it, the drop
    // shouldn't jump to the next row and pull the task out of its group.
    const targets = dragRows
    if (!targets.length) {
      dropParentId = null
      dropSiblingIndex = 0
      dropIndex = dragRows.length
      return
    }
    let i = targets.findIndex((row) => pointerY < row.top + row.height)
    let anchor: DragRow
    let after: boolean
    if (i === -1) {
      anchor = targets[targets.length - 1]
      after = true
    } else {
      anchor = targets[i]
      after = pointerY > anchor.top + anchor.height / 2
    }
    if (anchor.id === dragId) {
      dropParentId = anchor.parentId
      const ids = anchor.parentId ? untimedIdsForParent(anchor.parentId) : topLevelUntimedIds()
      dropSiblingIndex = Math.max(0, ids.indexOf(dragId))
    } else if (anchor.parentId) {
      dropParentId = anchor.parentId
      dropSiblingIndex = insertionIndex(untimedIdsForParent(anchor.parentId), anchor, after)
    } else if (anchor.header && after) {
      dropParentId = anchor.id
      dropSiblingIndex = 0
    } else {
      dropParentId = null
      dropSiblingIndex = insertionIndex(topLevelUntimedIds(), anchor, after)
    }
    dropIndex = dropDisplayIndex(dropParentId, dropSiblingIndex)
  }

  // The row before which the gap should open, from the destination sibling
  // index. Timed rows sort first and aren't in that list, so this keeps the
  // gap after them rather than in the middle of the timed block.
  function dropDisplayIndex(parentId: string | null, index: number): number {
    const siblings = parentId ? tasks.filter((t) => t.parentId === parentId) : topLevel
    const next = siblings.filter((t) => t.id !== dragId && !t.time)[index]
    if (next) {
      const row = dragRows.find((r) => r.id === next.id)
      if (row) return row.index
    }
    if (parentId) {
      const children = dragRows.filter((r) => r.parentId === parentId)
      if (children.length) return children[children.length - 1].index + 1
      const header = dragRows.find((r) => r.id === parentId)
      if (header) return header.index + 1
    }
    return dragRows.length
  }

  function insertionIndex(ids: string[], anchor: DragRow, after: boolean): number {
    const list = ids.filter((id) => id !== dragId)
    const i = list.indexOf(anchor.id)
    // A timed row isn't in the untimed list; untimed rows always follow it.
    if (i === -1) return 0
    return i + (after ? 1 : 0)
  }

  function onDragMove(e: PointerEvent) {
    if (!dragId || e.pointerId !== dragPointer) return
    dragMoved = true
    lastPointerY = e.clientY
    updateDrag(e.clientY)
  }

  // Rows moving with the dragged block shouldn't animate behind the pointer.
  function isDraggedBlockRow(id: string): boolean {
    if (!dragId || !dragBlock) return false
    return dragBlock.ids.includes(id)
  }

  // How far a row moves to open the gap, in list coordinates.
  function shiftFor(id: string): number {
    if (!dragId || dropIndex === null || !dragBlock) return 0
    if (dragBlock.ids.includes(id)) return dragOffset
    const row = dragRows.find((r) => r.id === id)
    if (!row) return 0
    if (dropIndex > dragBlock.endIndex) {
      if (row.index > dragBlock.endIndex && row.index < dropIndex) return -dragHeight
    } else if (dropIndex < dragBlock.startIndex) {
      if (row.index >= dropIndex && row.index < dragBlock.startIndex) return dragHeight
    }
    return 0
  }

  function startAutoScroll() {
    if (autoScrollFrame) return
    const step = () => {
      if (!dragId) {
        autoScrollFrame = 0
        return
      }
      if (!dragMoved) {
        autoScrollFrame = requestAnimationFrame(step)
        return
      }
      const margin = 80
      let dy = 0
      if (lastPointerY < margin) dy = -Math.ceil((margin - lastPointerY) / 4)
      else if (lastPointerY > window.innerHeight - margin) {
        dy = Math.ceil((lastPointerY - (window.innerHeight - margin)) / 4)
      }
      if (dy) {
        if (fullScreen && rootEl) {
          const before = rootEl.scrollTop
          rootEl.scrollTop += dy
          if (rootEl.scrollTop !== before) updateDrag(lastPointerY)
        } else {
          const before = window.scrollY
          window.scrollBy(0, dy)
          if (window.scrollY !== before) updateDrag(lastPointerY)
        }
      }
      autoScrollFrame = requestAnimationFrame(step)
    }
    autoScrollFrame = requestAnimationFrame(step)
  }

  function stopAutoScroll() {
    if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame)
    autoScrollFrame = 0
  }

  function resetDrag() {
    dragId = null
    dragPointer = null
    dragOffset = 0
    dropIndex = null
    dragRows = []
    dragBlock = null
    dragTopTargets = []
    dropParentId = null
    dropSiblingIndex = 0
    dragHeight = 0
    dragMoved = false
    stopAutoScroll()
  }

  function endDrag(e?: PointerEvent) {
    if (e && dragPointer !== null && e.pointerId !== dragPointer) return
    const sourceId = dragId
    const parentId = dropParentId
    const to = dropSiblingIndex
    const moved = dragMoved
    const source = sourceId ? tasks.find((t) => t.id === sourceId) : undefined
    resetDrag()
    if (!source || !sourceId || !moved) return
    if (!tasks.some((t) => t.id === sourceId)) return
    const siblings = parentId ? tasks.filter((t) => t.parentId === parentId) : topLevel
    const ids = siblings.filter((t) => t.id !== sourceId && !t.time).map((t) => t.id)
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, sourceId)
    if ((source.parentId ?? null) !== parentId) {
      logsStore.editTask(dateStr, sourceId, { parentId: parentId ?? undefined })
    }
    logsStore.reorderTasks(dateStr, ids, { defer: true })
    void logsStore.flushTasks(dateStr)
  }

  function onReorderKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    if (dragId) {
      e.preventDefault()
      resetDrag()
      return
    }
    if (selectMode && !anyPopoverOpen()) {
      e.preventDefault()
      exitSelect()
    }
  }

  // Keyboard reordering: arrow keys on the handle move the row.
  function onHandleKeydown(e: KeyboardEvent, task: Task) {
    if (task.time || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const ids = untimedSiblings(task).map((t) => t.id)
    const i = ids.indexOf(task.id)
    const j = i + (e.key === 'ArrowUp' ? -1 : 1)
    if (i === -1 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    logsStore.reorderTasks(dateStr, ids)
  }

  // ---- selection ----------------------------------------------------------

  // Select mode works on top-level rows; a selected group takes its subtasks.
  let selectMode = $state(false)
  let selected = $state(new Set<string>())
  // Where a Shift+click range starts.
  let rangeAnchor: string | null = null
  let selectableIds = $derived(taskRows.filter((r) => r.depth === 0).map((r) => r.task.id))
  let unfinishedIds = $derived(
    topLevel
      .filter((t) => {
        // A group counts while any of its subtasks is unfinished.
        if (parentIds.has(t.id)) return tasks.some((c) => c.parentId === t.id && !c.done)
        return !t.done && !!t.text.trim()
      })
      .map((t) => t.id),
  )

  // A task removed elsewhere (another device, undo) drops out of the selection.
  $effect(() => {
    const valid = new Set(selectableIds)
    const cur = untrack(() => selected)
    if ([...cur].some((id) => !valid.has(id))) selected = new Set([...cur].filter((id) => valid.has(id)))
  })

  function toggleSelectMode() {
    if (selectMode) {
      exitSelect()
      return
    }
    resetDrag()
    reorderMode = false
    finishFresh()
    menuTaskId = null
    selectMode = true
  }

  function exitSelect() {
    selectMode = false
    selected = new Set()
    rangeAnchor = null
  }

  function onSelectRowClick(e: MouseEvent, id: string) {
    const next = new Set(selected)
    if (e.shiftKey && rangeAnchor && selectableIds.includes(rangeAnchor)) {
      const a = selectableIds.indexOf(rangeAnchor)
      const b = selectableIds.indexOf(id)
      for (const rid of selectableIds.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(rid)
    } else {
      if (next.has(id)) next.delete(id)
      else next.add(id)
      rangeAnchor = id
    }
    selected = next
  }

  function focusSelectRow(id: string) {
    listEl?.querySelector<HTMLElement>(`[data-select-row="${CSS.escape(id)}"]`)?.focus()
  }

  function onSelectRowKeydown(e: KeyboardEvent, id: string) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      onSelectRowClick(e as unknown as MouseEvent, id)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const i = selectableIds.indexOf(id) + (e.key === 'ArrowUp' ? -1 : 1)
      if (i >= 0 && i < selectableIds.length) focusSelectRow(selectableIds[i])
    }
  }

  function selectAll() {
    selected = new Set(selectableIds)
  }

  function selectUnfinished() {
    selected = new Set(unfinishedIds)
  }

  function deleteSelected() {
    const ids = [...selected]
    if (!ids.length) return
    // Deleting a task takes its subtasks along, timer and all.
    const focused = tasks.find((t) => t.id === focusedId)
    if (focused && (ids.includes(focused.id) || (focused.parentId && ids.includes(focused.parentId)))) {
      pomodoroStore.stop()
    }
    logsStore.removeTasks(dateStr, ids)
    selected = new Set()
  }

  // ---- move to another day -------------------------------------------------

  let moveState = $state<{ ids: string[]; anchor: HTMLElement | null; fromSelection: boolean; from: string } | null>(null)
  let moveBarButton = $state<HTMLButtonElement | null>(null)

  function openMove(ids: string[], anchor: HTMLElement | null, fromSelection: boolean) {
    if (!ids.length) return
    moveState = { ids, anchor, fromSelection, from: dateStr }
  }

  async function moveTo(to: string) {
    const m = moveState
    moveState = null
    if (!m) return
    const ok = await logsStore.moveTasks(m.from, to, m.ids)
    if (ok && m.fromSelection && dateStr === m.from) exitSelect()
  }

  function anyPopoverOpen() {
    return !!(moveState || menuTaskId || toolbarMenuOpen || showHistory)
  }

  // ---- row menu ------------------------------------------------------------

  // Secondary actions live in the same menu at every screen size.
  let menuTaskId = $state<string | null>(null)
  let menuAnchorEl = $state<HTMLButtonElement | null>(null)

  function toggleRowMenu(id: string, el: HTMLButtonElement) {
    menuTaskId = menuTaskId === id ? null : id
    menuAnchorEl = el
  }

  function removeTask(task: Task) {
    if (menuTaskId === task.id) menuTaskId = null
    // Deleting a group takes its subtasks along, timer and all.
    const focused = tasks.find((t) => t.id === focusedId)
    if (focused && (focused.id === task.id || focused.parentId === task.id)) {
      pomodoroStore.stop()
    }
    logsStore.removeTask(dateStr, task.id)
  }

  const TIMER_ICON = [
    'M6 5.1C3.9 5.3 2.5 6.9 2.5 9.4 2.5 12.4 5 14.3 8 14.3s5.5-1.9 5.5-4.9c0-2.5-1.4-4.1-3.5-4.3',
    'M8 5.6 5.4 4.3M8 5.6l2.6-1.3M8 5.6 8 3.4c0-.6.3-1 .9-1.2',
    'M4.9 9.2c.1-.8.6-1.5 1.3-1.8',
  ]

  // Keep the time picker and any active timer directly accessible.
  function rowMenuItems(task: Task, row: Row): ActionMenuItem[] {
    const items: ActionMenuItem[] = []
    if (row.depth === 0 && !row.header) {
      items.push({
        label: 'Add subtask',
        icon: ['M3 3v5a2 2 0 0 0 2 2h6', 'M8.5 7.5 11 10 8.5 12.5'],
        onSelect: () => void addSubtask(task),
      })
    }
    items.push({
      label: task.comment ? 'Edit comment' : 'Add comment',
      icon: 'M3 2.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 3v-3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z',
      onSelect: () => {
        if (openComments.has(task.id)) {
          listEl?.querySelector<HTMLTextAreaElement>(`[data-task-comment="${task.id}"]`)?.focus()
          return
        }
        toggleComment(task.id)
      },
    })
    if (pomodoroOn && !row.header) {
      const running = focusedId === task.id
      items.push({
        label: running ? (timer.running ? 'Pause the timer' : 'Resume the timer') : 'Start a focus timer',
        icon: running ? ['M6 4v8', 'M10 4v8'] : TIMER_ICON,
        onSelect: () => toggleFocus(task),
      })
    }
    if (row.depth === 0) {
      items.push({
        label: 'Move to…',
        icon: ['M2.5 8h9', 'M9 4.5 12.5 8 9 11.5'],
        onSelect: () => openMove([task.id], menuAnchorEl, false),
      })
    }
    items.push({
      label: 'Copy link',
      icon: LINK_ICON,
      onSelect: () => void copyLink(task.id),
    })
    items.push({
      label: 'Delete task',
      icon: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
      danger: true,
      onSelect: () => removeTask(task),
    })
    return items
  }

  // ---- history / checkpoints -----------------------------------------------

  let fullScreen = $state(false)
  let fullScreenButton = $state<HTMLButtonElement | null>(null)

  async function toggleFullScreen() {
    resetDrag()
    fullScreen = !fullScreen
    await tick()
    // The content width changes, so refit wrapped tasks and comments.
    rootEl?.querySelectorAll('textarea').forEach((el) => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    })
    if (fullScreen) rootEl?.focus({ preventScroll: true })
    else fullScreenButton?.focus({ preventScroll: true })
  }

  function onRootKeydown(e: KeyboardEvent) {
    if (
      selectMode &&
      e.key.toLowerCase() === 'a' &&
      (e.metaKey || e.ctrlKey) &&
      !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault()
      selectAll()
      return
    }
    if (e.key === 'Escape' && selectMode && !e.defaultPrevented && !dragId && !anyPopoverOpen()) {
      // Leave select mode before leaving full screen.
      e.preventDefault()
      exitSelect()
      return
    }
    if (!fullScreen || e.key !== 'Escape' || e.defaultPrevented) return
    if (dragId) {
      e.preventDefault()
      resetDrag()
      return
    }
    if (anyPopoverOpen()) return
    e.preventDefault()
    void toggleFullScreen()
  }

  let showHistory = $state(false)
  let toolbarMenuOpen = $state(false)
  let toolbarMenuItems: ActionMenuItem[] = $derived([
    ...(selectMode ? [] : [{
      label: 'Select tasks',
      icon: ['M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z', 'M5.5 8l1.8 1.8L10.5 6'],
      onSelect: toggleSelectMode,
    }]),
    { label: 'Copy link', icon: LINK_ICON, onSelect: () => void copyLink() },
    {
      label: 'Version history',
      icon: ['M2 8a6 6 0 1 0 2-4.47L2 5.33', 'M2 2v3.33h3.33', 'M8 4.67V8l2 1.33'],
      onSelect: () => (showHistory = true),
    },
  ])

  // Links to this day, or to one task on it (opens it and flashes the row).
  async function copyLink(taskId?: string) {
    try {
      await navigator.clipboard.writeText(linkTo({ page: 'journal', date: dateStr, tab: 'tasks', task: taskId }))
      showToast('Link copied')
    } catch (e) {
      console.error('Failed to copy', e)
      showError('Couldn’t copy to the clipboard.')
    }
  }

  // A deep link to a task: scroll it into view and flash it once its day has
  // loaded. A task that isn't there is skipped quietly.
  let flashId = $state<string | null>(null)
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    const id = $appStore.highlightTaskId
    if (!id || !loaded) return
    const found = tasks.some((t) => t.id === id)
    appStore.setHighlightTask(null)
    if (!found) return
    void tick().then(() => {
      const el = listEl?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      flashId = id
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => (flashId = null), 1600)
    })
  })
  let historyAnchorEl = $state<HTMLButtonElement | null>(null)
  let rootEl = $state<HTMLElement | null>(null)

  $effect(() => {
    const el = rootEl
    const ds = dateStr
    if (!el) return
    return bindSnapshotTriggers(el, () => void logsStore.flushTasks(ds, { snapshot: true }))
  })

  // Menus and history belong to one day's list.
  $effect(() => {
    void dateStr
    menuTaskId = null
    toolbarMenuOpen = false
    showHistory = false
    moveState = null
    selected = new Set()
    rangeAnchor = null
  })

  onDestroy(() => {
    clearInterval(ticker)
    clearTimeout(flashTimer)
    stopAutoScroll()
    void logsStore.flushTasks(dateStr)
  })
</script>

<svelte:window onkeydown={onReorderKeydown} />

<section
  class="tasks"
  class:full-screen={fullScreen}
  class:desktop-reorder={desktopReorder}
  bind:this={rootEl}
  role={fullScreen ? 'dialog' : 'region'}
  aria-label="Tasks"
  tabindex="-1"
  onkeydown={onRootKeydown}
>
  <div class="toolbar">
    {#if selectMode}
      <div class="select-bar" role="toolbar" aria-label="Selected tasks">
        <span class="select-count" aria-live="polite">
          {selected.size ? `${selected.size} selected` : 'None selected'}
        </span>
        {#if selected.size}
          <button
            type="button"
            class="btn-secondary bar-btn"
            bind:this={moveBarButton}
            aria-haspopup="dialog"
            aria-expanded={!!moveState?.fromSelection}
            onclick={() => openMove([...selected], moveBarButton, true)}
          >Move to…</button>
          <button type="button" class="btn-secondary bar-btn danger" onclick={deleteSelected}>Delete</button>
        {/if}
        {#if unfinishedIds.length && unfinishedIds.some((id) => !selected.has(id))}
          <button type="button" class="btn-secondary bar-btn" onclick={selectUnfinished}>Select unfinished</button>
        {/if}
        {#if selected.size}
          <button type="button" class="btn-secondary bar-btn ghost" onclick={() => (selected = new Set())}>Clear</button>
        {/if}
        <button type="button" class="btn-secondary bar-btn done-btn" onclick={exitSelect}>Done</button>
      </div>
    {:else}
      <span class="progress" class:all-done={leafTasks.length > 0 && doneCount === leafTasks.length}>
        {#if leafTasks.length}
          {doneCount} of {leafTasks.length} done
        {/if}
      </span>
    {/if}
    <div class="tools">
      <button
        class="icon-btn reorder-toggle"
        class:active={reorderMode}
        title={reorderMode ? 'Done reordering' : 'Reorder tasks'}
        aria-label={reorderMode ? 'Done reordering' : 'Reorder tasks'}
        aria-pressed={reorderMode}
        onclick={toggleReorder}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M8 5v14M8 5 5 8M8 5l3 3" />
          <path d="M16 19V5M16 19l-3-3M16 19l3-3" />
        </svg>
      </button>
      <button
        type="button"
        class="icon-btn ghost full-screen-button"
        bind:this={fullScreenButton}
        title={fullScreen ? 'Exit full screen (Esc)' : 'Full screen'}
        aria-label={fullScreen ? 'Exit full screen' : 'Full screen'}
        aria-pressed={fullScreen}
        onclick={toggleFullScreen}
      >
        {#if fullScreen}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.5V6H2.5M10 2.5V6h3.5M6 13.5V10H2.5M10 13.5V10h3.5" /></svg>
        {:else}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10" /></svg>
        {/if}
      </button>
      <MoreButton
        expanded={toolbarMenuOpen}
        bind:anchor={historyAnchorEl}
        onclick={() => (toolbarMenuOpen = !toolbarMenuOpen)}
      />
      {#if toolbarMenuOpen}
        <ActionMenu
          anchor={historyAnchorEl}
          items={toolbarMenuItems}
          label="Tasks actions"
          onClose={() => (toolbarMenuOpen = false)}
        />
      {/if}
      {#if showHistory}
        <HistoryPopover
          kind="day-tasks"
          entityId={dateStr}
          anchor={historyAnchorEl}
          prepare={() => logsStore.flushTasks(dateStr, { snapshot: true })}
          onClose={() => (showHistory = false)}
        />
      {/if}
    </div>
  </div>

  {#key dateStr}
    <ul
      class="list"
      bind:this={listEl}
      class:loading={!loaded}
      class:reordering={!!dragId}
      class:reorder-mode={reorderMode}
      class:select-mode={selectMode}
    >
      {#each rows as row (row.now ? `n:${dateStr}` : row.addRow ? `a:${row.task.id}` : `t:${row.task.id}`)}
        {@const task = row.task}
        {@const shift = row.now || row.addRow ? 0 : shiftFor(task.id)}
        <li
          class:task={!row.addRow && !row.now}
          class:group-add-row={row.addRow}
          class:now-row={row.now}
          class:done={!row.now && !row.addRow && task.done && !row.header}
          class:header={!row.now && !row.addRow && row.header}
          class:sub={!row.now && !row.addRow && row.depth > 0}
          class:has-comment={!row.now && !row.addRow && !!task.comment}
          class:dragging={!row.now && !row.addRow && dragId === task.id}
          class:flash={!row.now && !row.addRow && flashId === task.id}
          class:following={!row.now && !row.addRow && isDraggedBlockRow(task.id)}
          class:selected={selectMode && !row.now && !row.addRow && (selected.has(task.id) || (row.depth > 0 && !!task.parentId && selected.has(task.parentId)))}
          data-task-id={row.now || row.addRow ? undefined : task.id}
          style:transform={!row.now && !row.addRow && shift ? `translateY(${shift}px)` : undefined}
          animate:safeFlip={{ duration: 220 }}
          transition:slide={{ duration: 160 }}
        >
        {#if row.now}
          <div class="now-marker" aria-label="Now"><span>now</span></div>
        {:else if row.addRow}
          <div class="add group-add" class:has-draft={!!groupDrafts[task.id]?.trim()}>
            <div class="row">
              <button
                type="button"
                class="add-icon"
                title="Add a task"
                aria-label="Add a task to this group"
                onclick={() => focusGroupAdd(task.id)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
              </button>
              <input
                class="add-input"
                data-group-add={task.id}
                value={groupDrafts[task.id] ?? ''}
                placeholder="Add a task"
                aria-label="Add a task to this group"
                enterkeyhint="done"
                oninput={(e) => onGroupAddInput(task, e)}
                oncompositionend={() => void createGroupTaskFromDraft(task)}
                onkeydown={(e) => onGroupAddKeydown(e, task)}
              />
            </div>
          </div>
        {:else if selectMode}
          {@const included = row.depth > 0 && !!task.parentId && selected.has(task.parentId)}
          {@const on = row.depth === 0 ? selected.has(task.id) : included}
          {@const name = task.text.trim() || (row.header ? 'Untitled group' : 'Untitled task')}
          {#if row.depth === 0}
            <div
              class="row select-row"
              role="checkbox"
              tabindex="0"
              aria-checked={on}
              aria-label={`Select “${name}”`}
              data-select-row={task.id}
              onclick={(e) => onSelectRowClick(e, task.id)}
              onkeydown={(e) => onSelectRowKeydown(e, task.id)}
            >
              <span class="select-mark" class:on aria-hidden="true">
                <svg viewBox="0 0 16 16"><path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </span>
              <span class="text select-text" class:placeholder={!task.text.trim()}>{task.text || (row.header ? 'Group' : 'Task')}</span>
              {#if task.time}<span class="time-label">{task.time}</span>{/if}
            </div>
          {:else}
            <div
              class="row select-row included"
              role="checkbox"
              aria-checked={included}
              aria-disabled="true"
              aria-label={included ? `“${name}” moves with its group` : `“${name}” moves with its group when the group is selected`}
            >
              <span class="select-mark" class:on={included} aria-hidden="true">
                <svg viewBox="0 0 16 16"><path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </span>
              <span class="text select-text" class:placeholder={!task.text.trim()}>{task.text || 'Subtask'}</span>
            </div>
          {/if}
          {#if task.comment}
            <p class="comment select-comment">{task.comment}</p>
          {/if}
        {:else}
          <div class="row">
            {#if desktopReorder || reorderMode}
              <button
                type="button"
                class="handle"
                class:disabled={!!task.time}
                title={task.time ? 'Timed tasks stay in time order' : 'Drag to reorder'}
                aria-label={task.time ? 'Timed tasks stay in time order' : 'Drag to reorder'}
                aria-disabled={!!task.time}
                onpointerdown={(e) => startDrag(e, task)}
                onpointermove={onDragMove}
                onpointerup={endDrag}
                onpointercancel={endDrag}
                onlostpointercapture={endDrag}
                onkeydown={(e) => onHandleKeydown(e, task)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
              </button>
            {/if}
            {#if row.header}
              <span class="group-mark" aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                  <path d="M3 4.5h10M3 8h10M3 11.5h6" />
                </svg>
              </span>
            {:else}
              <button
                type="button"
                class="check"
                role="checkbox"
                aria-checked={task.done}
                aria-label={task.done ? 'Mark not done' : 'Mark done'}
                onclick={() => logsStore.editTask(dateStr, task.id, { done: !task.done }, { immediate: true })}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            {/if}

            <textarea
              class="text"
              data-task-input={task.id}
              rows="1"
              value={task.text}
              placeholder={row.header ? 'Group' : row.depth ? 'Subtask' : 'Task'}
              aria-label={row.header ? 'Group name' : row.depth ? 'Subtask' : 'Task'}
              use:autosize
              oninput={(e) => logsStore.editTask(dateStr, task.id, { text: e.currentTarget.value })}
              onkeydown={(e) => onTextKeydown(e, task, row.index, row.header)}
              onblur={() => {
                if (task.id === freshId) finishFresh()
              }}
            ></textarea>

            {#if pomodoroOn && !row.header && focusedId === task.id}
              <button
                type="button"
                class="icon-btn ghost focus-btn"
                class:active={focusedId === task.id}
                class:paused={focusedId === task.id && !timer.running}
                title="Pause or resume the timer"
                aria-label="Pause or resume the focus timer"
                aria-pressed={focusedId === task.id}
                onclick={() => toggleFocus(task)}
              >
                <span class="focus-clock">{formatClock(timer.remainingMs)}</span>
              </button>
            {/if}

            {#if row.depth === 0}
              <TimePicker
                class="time"
                value={task.time}
                onChange={(time) => logsStore.editTask(dateStr, task.id, { time }, { immediate: true })}
              />
            {/if}
            <MoreButton
              expanded={menuTaskId === task.id}
              onclick={(e) => toggleRowMenu(task.id, e.currentTarget as HTMLButtonElement)}
            />
          </div>

          {#if menuTaskId === task.id}
            <ActionMenu
              anchor={menuAnchorEl}
              items={rowMenuItems(task, row)}
              label="Task actions"
              onClose={() => (menuTaskId = null)}
            />
          {/if}

          {#if task.comment || openComments.has(task.id)}
            <textarea
              class="comment"
              data-task-comment={task.id}
              rows="1"
              placeholder="Add a comment…"
              aria-label="Comment"
              value={task.comment ?? ''}
              use:autosize
              oninput={(e) => logsStore.editTask(dateStr, task.id, { comment: e.currentTarget.value })}
              onblur={(e) => {
                if (!e.currentTarget.value.trim() && openComments.has(task.id)) toggleComment(task.id)
              }}
              transition:slide={{ duration: 140 }}
            ></textarea>
          {/if}
        {/if}
        </li>
      {/each}
    </ul>
  {/key}

  {#if moveState}
    <MoveToDatePopover
      from={moveState.from}
      anchor={moveState.anchor}
      onPick={(to) => void moveTo(to)}
      onClose={() => (moveState = null)}
    />
  {/if}

  <div class="add" class:hidden={selectMode} inert={selectMode} class:has-draft={!!draft || !!draftTime || draftCommentOpen}>
    <div class="row">
      <button type="button" class="add-icon" aria-label="Add task" title="Add task" onclick={() => addInput?.focus()}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
      </button>
      <input
        class="add-input"
        bind:this={addInput}
        bind:value={draft}
        placeholder={tasks.length ? 'Add a task' : 'Add task'}
        aria-label="Add a task"
        enterkeyhint="done"
        oninput={onAddInput}
        oncompositionend={() => void createFromDraft()}
        onkeydown={onAddKeydown}
      />
      <TimePicker
        class="time add-time"
        value={draftTime}
        label={draftTime ? `Change time (${draftTime})` : 'Set a time'}
        onChange={(t) => {
          draftTime = t
          addInput?.focus()
        }}
      />
      <button
        type="button"
        class="icon-btn ghost comment-toggle add-comment-toggle"
        class:active={draftCommentOpen}
        title="Add a comment"
        aria-label="Add a comment"
        aria-expanded={draftCommentOpen}
        onclick={toggleDraftComment}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 2.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 3v-3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" />
        </svg>
      </button>
    </div>
    {#if draftCommentOpen}
      <textarea
        class="comment add-comment"
        rows="1"
        placeholder="Add a comment…"
        aria-label="Comment for the new task"
        bind:value={draftComment}
        use:autosize
        onkeydown={onDraftCommentKeydown}
        transition:slide={{ duration: 140 }}
      ></textarea>
    {/if}
  </div>

</section>

<style>
  .tasks {
    --row-h: 2.5rem;
    margin-bottom: 3rem;
  }
  .tasks.full-screen {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popover) - 1);
    overflow-y: auto;
    overscroll-behavior: contain;
    margin: 0;
    padding: 3rem 1.5rem;
    background: var(--bg);
    outline: none;
  }
  .tasks.full-screen > * { max-width: 70ch; margin-inline: auto; }
  .icon-btn.full-screen-button { width: 32px; height: 32px; }
  @media (pointer: coarse) {
    .icon-btn.full-screen-button { width: 40px; height: 40px; }
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 30px;
    margin-bottom: 0.5rem;
  }
  .progress {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
    transition: color var(--dur-base) var(--ease-out);
  }
  .progress.all-done { color: var(--accent); opacity: 1; }
  .tools { display: flex; align-items: center; gap: 0.35rem; }
  .reorder-toggle.active { color: var(--accent); border-color: var(--accent); }
  .desktop-reorder .reorder-toggle { display: none; }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .list.loading { opacity: 0.4; }
  .list.reordering { cursor: grabbing; user-select: none; }
  .list.reordering .task:not(.dragging):not(.following) { transition: transform 170ms var(--ease-out); }
  /* Add rows would otherwise show up in the gap while groups move. */
  .list.reorder-mode .group-add-row,
  .list.select-mode .group-add-row { display: none; }
  .add.hidden { display: none; }

  /* Select mode: the row is the control. Selected rows lift with a quiet
     background rather than an accent border. */
  .select-bar {
    flex: 1;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    min-width: 0;
    margin-right: 0.5rem;
  }
  .select-count {
    margin-right: 0.35rem;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .bar-btn { height: var(--h-sm); padding: 0 0.65rem; font-size: 0.75rem; }
  .bar-btn.danger { color: var(--danger); }
  .bar-btn.danger:hover:not(:disabled) { background: var(--danger-bg); border-color: var(--danger); }
  .bar-btn.ghost { border-color: transparent; }
  .bar-btn.done-btn { margin-left: auto; }
  .select-row {
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    border-radius: var(--r-md);
  }
  .select-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .select-row.included { cursor: default; opacity: 0.55; }
  .select-text {
    display: block;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .select-text.placeholder { color: var(--muted); }
  .time-label {
    flex-shrink: 0;
    padding: 0 0.4rem;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .select-mark {
    position: relative;
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--on-accent);
  }
  .select-mark::before {
    content: '';
    position: absolute;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--muted) 55%, transparent);
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .select-mark svg {
    position: relative;
    width: 0.8rem;
    height: 0.8rem;
    opacity: 0;
    transform: scale(0.6);
    transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-base) var(--ease-spring);
  }
  .select-mark.on::before { background: var(--accent); border-color: var(--accent); }
  .select-mark.on svg { opacity: 1; transform: none; }
  .select-row:hover .select-mark:not(.on)::before { border-color: var(--accent); }
  .task.selected,
  .task.selected:hover { background: color-mix(in srgb, var(--accent) 12%, var(--glass-dark)); }
  .select-comment { margin-top: -0.35rem; white-space: pre-wrap; pointer-events: none; }
  @media (max-width: 600px) {
    /* On phones the bar sits at the bottom, under the thumb. */
    .select-bar {
      position: fixed;
      left: 0.75rem;
      right: 0.75rem;
      bottom: calc(0.75rem + env(safe-area-inset-bottom));
      z-index: calc(var(--z-popover) - 2);
      padding: 0.5rem 0.6rem;
      border: 1px solid var(--line);
      border-radius: var(--r-md);
      background: var(--panel);
      box-shadow: var(--shadow-pop);
    }
    .tasks:has(.select-bar) { padding-bottom: 5rem; }
  }
  /* Desktop handles are always available: preserve the geometry captured at
     pointer-down while hiding group inputs during the gesture. */
  .desktop-reorder .list.reordering .group-add-row { visibility: hidden; }
  .task.dragging {
    position: relative;
    z-index: 3;
    background: var(--glass-dark);
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.16);
    cursor: grabbing;
  }
  .list.reordering .task.following {
    position: relative;
    z-index: 2;
  }

  .task {
    border-radius: var(--r-md);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .task:hover,
  .task:focus-within { background: var(--glass-dark); }
  .task.flash { animation: taskFlash 1.6s var(--ease-out); }
  @keyframes taskFlash {
    0%, 30% { background: color-mix(in srgb, var(--accent) 22%, transparent); }
    100% { background: transparent; }
  }
  .task.header .text { font-weight: 500; }
  .group-mark {
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    opacity: 0.55;
  }
  .group-mark svg { width: 0.85rem; height: 0.85rem; }
  .row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-height: var(--row-h);
    padding: 0 0.25rem 0 0.4rem;
  }

  .handle {
    flex-shrink: 0;
    width: 1.4rem;
    height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: -0.2rem;
    padding: 0;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--muted);
    opacity: 0.55;
    cursor: grab;
    touch-action: none;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .handle:hover { opacity: 1; color: var(--text); }
  .handle:active { cursor: grabbing; }
  .handle:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .handle.disabled { opacity: 0.2; cursor: default; }
  .handle.disabled:hover { opacity: 0.2; color: var(--muted); background: none; }
  .handle svg { width: 14px; height: 14px; }

  /* Bleed desktop handles into the left gutter without taking up row space.
     Anchor to the main row so comments don't change their vertical position. */
  .desktop-reorder .task {
    margin-left: -0.5rem;
    padding-left: 0.5rem;
  }
  .desktop-reorder .task.sub { margin-left: 1.2rem; }
  .desktop-reorder .row { position: relative; padding-left: 0; }
  /* Align the visible circle, not the padded button, with the heading. */
  .desktop-reorder .row > .check,
  .desktop-reorder .row > .select-mark,
  .desktop-reorder .row > .group-mark,
  .desktop-reorder .row > .add-icon { margin-left: -0.375rem; }
  .desktop-reorder .handle {
    position: absolute;
    right: calc(100% + 0.375rem);
    top: 50%;
    transform: translateY(-50%);
    margin-left: 0;
    width: 2rem;
    height: 100%;
    min-height: 2rem;
    opacity: 0;
    /* The invisible gutter is targetable too, revealing the handle on entry. */
    pointer-events: auto;
  }
  .desktop-reorder .task:hover .handle,
  .desktop-reorder .task:focus-within .handle,
  .desktop-reorder .task.dragging .handle { opacity: 0.55; }
  .desktop-reorder .task .handle:hover,
  .desktop-reorder .task .handle:focus-visible { opacity: 1; }
  .desktop-reorder .task .handle.disabled { opacity: 0; }
  .desktop-reorder .task:hover .handle.disabled,
  .desktop-reorder .task:focus-within .handle.disabled { opacity: 0.2; }

  .check {
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: none;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
    color: var(--on-accent);
  }
  .check::before {
    content: '';
    position: absolute;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--muted) 55%, transparent);
    background: transparent;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-bounce);
  }
  .check { position: relative; }
  .check svg {
    position: relative;
    width: 0.8rem;
    height: 0.8rem;
    opacity: 0;
    transform: scale(0.6);
    transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-base) var(--ease-bounce);
  }
  .check:hover::before { border-color: var(--accent); }
  .done .check::before { background: var(--accent); border-color: var(--accent); }
  .done .check svg { opacity: 1; transform: scale(1); }

  .text {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    line-height: 1.4;
    padding: 0.2rem 0.4rem;
    border-radius: var(--r-sm);
    outline: none;
    resize: none;
    overflow: hidden;
    transition: color var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out);
  }
  .text:hover,
  .text:focus { background: transparent; }
  .done .text {
    color: var(--muted);
    opacity: 0.6;
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--muted) 60%, transparent);
  }

  /* Even an unset time stays discoverable without hovering. */
  .task :global(.time:not(.set)) { opacity: 0.7; }
  .task :global(.time:hover),
  .task :global(.time.open) { opacity: 1; }

  .task .focus-btn.active {
    width: auto;
    min-width: 28px;
    padding: 0 0.35rem;
    color: var(--accent);
  }
  .task .focus-btn.active.paused { color: var(--muted); }
  .focus-clock {
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
  }

  /* Subtasks sit indented under their parent, marked by a short guide line. */
  .task.sub {
    position: relative;
    margin-left: 1.7rem;
  }
  .task.sub::before {
    content: '';
    position: absolute;
    left: -0.75rem;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--line);
  }
  .task.sub .text { font-size: 0.95rem; }
  .task.sub .comment { margin-left: 2.35rem; }

  .group-add-row { list-style: none; }
  .add.group-add {
    margin-top: 0;
    margin-left: 1.7rem;
  }
  .group-add .add-input { font-size: 0.95rem; }

  .comment {
    display: block;
    width: calc(100% - 2.6rem);
    margin: -0.35rem 0 0.4rem 2.35rem;
    padding: 0.2rem 0.4rem;
    resize: none;
    overflow: hidden;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.9rem;
    line-height: 1.5;
    outline: none;
  }
  .comment:hover,
  .comment:focus { background: transparent; }
  .comment:focus { color: var(--text); }
  .desktop-reorder .task .comment,
  .desktop-reorder .add .comment {
    margin-left: 1.625rem;
    width: calc(100% - 1.875rem);
  }

  .now-marker {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.2rem 0 0.2rem 0.6rem;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: 0.62rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .now-marker::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(to right, var(--accent), transparent);
    opacity: 0.6;
  }

  .add {
    margin-top: 0.25rem;
    border-radius: var(--r-md);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .add:focus-within,
  .add.has-draft { background: var(--glass-dark); }
  .add-icon {
    width: 1.75rem;
    height: 1.75rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    cursor: pointer;
    color: var(--muted);
    opacity: 0.6;
    flex-shrink: 0;
    transition:
      color var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  .add-icon:hover { background: var(--glass); opacity: 1; color: var(--accent); }
  /* The add row's time/comment controls stay discoverable (dimmed). */
  .add .comment-toggle { opacity: 0.45; }
  .add :global(.time:not(.set)) { opacity: 0.55; }
  .add:focus-within .comment-toggle,
  .add.has-draft .comment-toggle,
  .add:focus-within :global(.time:not(.set)),
  .add.has-draft :global(.time:not(.set)) { opacity: 0.85; }
  .add .comment-toggle.active { opacity: 1; color: var(--accent); }
  .add .add-comment { margin-top: -0.25rem; padding-bottom: 0.5rem; }
  .add-icon svg { width: 14px; height: 14px; }
  .add:focus-within .add-icon,
  .add.has-draft .add-icon { color: var(--accent); opacity: 1; }
  .add-input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    line-height: var(--row-h);
    padding: 0 0.4rem;
    outline: none;
  }
  .add-input:hover,
  .add-input:focus { background: transparent; }

</style>
