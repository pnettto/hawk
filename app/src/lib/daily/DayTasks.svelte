<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import { safeFlip } from '../../utils/safeFlip'
  import { fade, slide } from 'svelte/transition'
  import { appStore } from '../../stores/app'
  import { logsStore, sortTasks } from '../../stores/logs'
  import { formatDate } from '../../utils/date'
  import { bindSnapshotTriggers } from '../../utils/snapshotTriggers'
  import { parseQuickTask } from './quickTask'
  import HistoryPopover from '../ui/HistoryPopover.svelte'
  import TimePicker from '../ui/TimePicker.svelte'
  import type { Task } from '../../types/models'

  let dateStr = $derived(formatDate($appStore.selectedDate))
  let loaded = $derived(dateStr in $logsStore.byDate)
  let tasks = $derived(sortTasks($logsStore.byDate[dateStr]?.tasks ?? []))
  let doneCount = $derived(tasks.filter((t) => t.done).length)

  let prevDateStr = $derived.by(() => {
    const d = new Date($appStore.selectedDate)
    d.setDate(d.getDate() - 1)
    return formatDate(d)
  })
  let carryable = $derived(
    ($logsStore.byDate[prevDateStr]?.tasks ?? []).filter((t) => !t.done && t.text.trim()),
  )
  let prevDayName = $derived(
    new Date(prevDateStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' }),
  )

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
    const timed = tasks.filter((t) => t.time)
    if (!timed.length) return -1
    const idx = tasks.findIndex((t) => t.time && toMinutes(t.time) > nowMinutes)
    if (idx === 0) return -1
    return idx === -1 ? timed.length : idx
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
  // The task just created from the add row, until its row loses focus.
  let freshId = $state<string | null>(null)

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
    freshId = null
    if (!id) return
    const task = $logsStore.byDate[dateStr]?.tasks.find((t) => t.id === id)
    if (!task) return
    if (!task.text.trim() && !task.comment) {
      logsStore.removeTask(dateStr, id, { quiet: true })
      return
    }
    if (task.time) return
    const parsed = parseQuickTask(task.text)
    if (parsed.time && parsed.text) logsStore.editTask(dateStr, id, { text: parsed.text, time: parsed.time })
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
    } else if (e.key === 'ArrowUp' && tasks.length) {
      e.preventDefault()
      focusTask(tasks[tasks.length - 1].id)
    }
  }

  // ---- row editing ---------------------------------------------------------

  let listEl = $state<HTMLElement | null>(null)
  let openComments = $state(new Set<string>())

  function focusTask(id: string, caret: 'end' | 'start' = 'end') {
    const el = listEl?.querySelector<HTMLInputElement>(`[data-task-input="${id}"]`)
    if (!el) return
    el.focus()
    const pos = caret === 'end' ? el.value.length : 0
    el.setSelectionRange(pos, pos)
  }

  function onTextKeydown(e: KeyboardEvent, task: Task, index: number) {
    if (e.isComposing) return
    const input = e.currentTarget as HTMLInputElement
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      logsStore.editTask(dateStr, task.id, { done: !task.done }, { immediate: true })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      addInput?.focus()
    } else if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault()
      focusTask(tasks[index - 1].id)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (index < tasks.length - 1) focusTask(tasks[index + 1].id)
      else addInput?.focus()
    } else if (e.key === 'Backspace' && input.value === '' && !task.comment) {
      e.preventDefault()
      // Backing out of a task that was just started returns to the add row.
      if (task.id === freshId) {
        freshId = null
        logsStore.removeTask(dateStr, task.id, { quiet: true })
        addInput?.focus()
        return
      }
      const prev = tasks[index - 1]
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

  // ---- history / checkpoints -----------------------------------------------

  let showHistory = $state(false)
  let historyAnchorEl = $state<HTMLButtonElement | null>(null)
  let rootEl = $state<HTMLElement | null>(null)

  $effect(() => {
    const el = rootEl
    const ds = dateStr
    if (!el) return
    return bindSnapshotTriggers(el, () => void logsStore.flushTasks(ds, { snapshot: true }))
  })

  onDestroy(() => {
    clearInterval(ticker)
    void logsStore.flushTasks(dateStr)
  })
</script>

<section class="tasks" bind:this={rootEl} aria-label="Tasks">
  <div class="toolbar">
    <span class="progress" class:all-done={tasks.length > 0 && doneCount === tasks.length}>
      {#if tasks.length}
        {doneCount} of {tasks.length} done
      {/if}
    </span>
    <div class="history-wrap">
      <button
        class="icon-btn history-toggle"
        title="Version history"
        aria-label="Version history"
        bind:this={historyAnchorEl}
        onclick={() => (showHistory = !showHistory)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
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
    <ul class="list" bind:this={listEl} class:loading={!loaded}>
      {#each tasks as task, i (task.id)}
        <li
          class="task"
          class:done={task.done}
          class:has-comment={!!task.comment}
          animate:safeFlip={{ duration: 220 }}
          transition:slide={{ duration: 160 }}
        >
          {#if i === nowIndex}
            <div class="now-marker" aria-label="Now" transition:fade={{ duration: 150 }}><span>now</span></div>
          {/if}
          <div class="row">
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

            <input
              class="text"
              data-task-input={task.id}
              value={task.text}
              placeholder="Task"
              aria-label="Task"
              oninput={(e) => logsStore.editTask(dateStr, task.id, { text: e.currentTarget.value })}
              onkeydown={(e) => onTextKeydown(e, task, i)}
              onblur={() => {
                if (task.id === freshId) finishFresh()
              }}
            />

            <TimePicker
              class="time"
              value={task.time}
              onChange={(time) => logsStore.editTask(dateStr, task.id, { time }, { immediate: true })}
            />

            <button
              type="button"
              class="icon-btn ghost comment-toggle"
              class:active={!!task.comment || openComments.has(task.id)}
              title="Comment"
              aria-label="Comment"
              aria-expanded={openComments.has(task.id) || !!task.comment}
              onclick={() => toggleComment(task.id)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 2.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 3v-3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" />
              </svg>
            </button>

            <button
              type="button"
              class="icon-btn ghost carry-over"
              title="Carry over to next day"
              aria-label="Carry over to next day"
              onclick={() => logsStore.carryTaskOver(dateStr, task.id)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2.5 8h9" />
                <path d="M9 4.5L12.5 8 9 11.5" />
              </svg>
            </button>
            <button
              type="button"
              class="icon-btn ghost danger remove"
              title="Delete task"
              aria-label="Delete task"
              onclick={() => logsStore.removeTask(dateStr, task.id)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
          </div>

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
        </li>
      {/each}
      {#if nowIndex === tasks.length && tasks.length}
        <li class="now-marker" aria-label="Now"><span>now</span></li>
      {/if}
    </ul>
  {/key}

  <div class="add" class:has-draft={!!draft || !!draftTime || draftCommentOpen}>
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

  {#if loaded && !tasks.length && carryable.length}
    <button
      type="button"
      class="carry"
      onclick={() => logsStore.carryOver(prevDateStr, dateStr, carryable.map((t) => t.id))}
      transition:fade={{ duration: 150 }}
    >
      Bring over {carryable.length} unfinished {carryable.length === 1 ? 'task' : 'tasks'} from {prevDayName}
    </button>
  {/if}
</section>

<style>
  .tasks {
    --row-h: 2.5rem;
    margin-bottom: 3rem;
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
  .history-wrap { position: relative; }

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

  .task {
    border-radius: 8px;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .task:hover,
  .task:focus-within { background: var(--glass-dark); }
  .row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-height: var(--row-h);
    padding: 0 0.25rem 0 0.4rem;
  }

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
    line-height: var(--row-h);
    padding: 0 0.4rem;
    border-radius: 6px;
    outline: none;
    text-overflow: ellipsis;
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

  /* Untimed rows only show the clock on hover/focus. */
  .task :global(.time:not(.set)) { opacity: 0; }
  .task:hover :global(.time:not(.set)),
  .task:focus-within :global(.time:not(.set)) { opacity: 0.7; }
  .task :global(.time:not(.set):hover),
  .task :global(.time.open) { opacity: 1; }

  .comment-toggle,
  .carry-over,
  .remove { opacity: 0; }
  .task:hover .comment-toggle,
  .task:focus-within .comment-toggle,
  .task:hover .carry-over,
  .task:focus-within .carry-over,
  .task:hover .remove,
  .task:focus-within .remove { opacity: 0.6; }
  .comment-toggle.active { opacity: 0.8; color: var(--accent); }
  .comment-toggle:hover,
  .carry-over:hover,
  .remove:hover { opacity: 1 !important; }
  .carry-over:hover { color: var(--accent); }
  @media (hover: none) {
    .task :global(.time:not(.set)),
    .comment-toggle,
    .carry-over,
    .remove { opacity: 0.45; }
  }

  .comment {
    display: block;
    width: calc(100% - 2.6rem);
    margin: -0.35rem 0 0.4rem 2.35rem;
    padding: 0.2rem 0.4rem;
    resize: none;
    overflow: hidden;
    border: 0;
    border-radius: 6px;
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
    border-radius: 8px;
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
    border-radius: 50%;
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

  .carry {
    display: block;
    margin: 1rem 0 0 2.6rem;
    padding: 0.45rem 0.8rem;
    border: 1px dashed var(--line);
    border-radius: 999px;
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    cursor: pointer;
    transition:
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  .carry:hover { color: var(--text); border-color: var(--accent); background: var(--glass-dark); }
</style>
