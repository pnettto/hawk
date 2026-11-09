<script lang="ts">
  import MarkdownIt from 'markdown-it'
  import { logsStore, sortTasks } from '../stores/logs'
  import { sortDayNotes } from '../stores/notes'
  import { getDayNotes } from '../api/notes'
  import { appStore } from '../stores/app'
  import { debounce } from '../utils/debounce'
  import { formatDate } from '../utils/date'
  import type { DayLog, Note } from '../types/models'

  const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

  let loading = $state(true)
  let copied = $state(false)
  // Day notes in the range, by date.
  let notesByDate = $state<Record<string, Note[]>>({})

  let tab = $derived($appStore.overviewTab)

  const dayLabel = (date: string) =>
    new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })

  let dates = $derived.by(() => {
    const out: string[] = []
    const cur = new Date(formatDate($appStore.overviewStart) + 'T12:00:00')
    const end = new Date(formatDate($appStore.overviewEnd) + 'T12:00:00')
    while (cur <= end) {
      out.push(formatDate(cur))
      cur.setDate(cur.getDate() + 1)
    }
    return out
  })

  // Markdown for one day's section body (also what Copy puts on the clipboard).
  function dayMarkdown(day: DayLog | undefined, date: string): string {
    if (tab === 'tasks') {
      return sortTasks(day?.tasks ?? [])
        .filter((t) => t.text.trim() || t.comment?.trim())
        .map((t) => {
          let line = `- [${t.done ? 'x' : ' '}] ${t.time ? `**${t.time}** ` : ''}${t.text}`
          if (t.comment) line += '\n' + t.comment.split('\n').map((l) => `  > ${l}`).join('\n')
          return line
        })
        .join('\n')
    }
    const notes = sortDayNotes(notesByDate[date] ?? []).filter((n) => n.content.trim())
    return notes
      .map((n) => (notes.length > 1 || n.title ? `### ${n.title || 'Note'}\n\n` : '') + n.content.trim())
      .join('\n\n')
  }

  let sections = $derived(
    dates
      .map((date) => ({ date, body: dayMarkdown($logsStore.byDate[date], date) }))
      .filter((s) => s.body),
  )

  let fullMarkdown = $derived(sections.map((s) => `## ${dayLabel(s.date)}\n\n${s.body}`).join('\n\n'))

  // Task lists render as plain checkmarks rather than disabled inputs.
  function render(body: string): string {
    return md.render(body).replace(/<li>\[( |x)\] /g, (_m, c) =>
      c === 'x' ? '<li class="task done"><span class="mark">✓</span> ' : '<li class="task"><span class="mark">·</span> ',
    )
  }

  async function refresh() {
    loading = true
    const start = formatDate($appStore.overviewStart)
    const end = formatDate($appStore.overviewEnd)
    const [, notes] = await Promise.all([
      logsStore.loadForRange(start, end),
      getDayNotes(start, end).catch((e) => {
        console.error('Failed to load day notes', e)
        return [] as Note[]
      }),
    ])
    const byDate: Record<string, Note[]> = {}
    for (const n of notes) if (n.day) (byDate[n.day] ??= []).push(n)
    notesByDate = byDate
    loading = false
  }
  const debouncedRefresh = debounce(refresh, 250)

  $effect(() => {
    void $appStore.overviewStart
    void $appStore.overviewEnd
    loading = true
    debouncedRefresh()
  })

  async function copyToClipboard() {
    if (!fullMarkdown) return
    try {
      await navigator.clipboard.writeText(fullMarkdown)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch (e) {
      console.error('Failed to copy', e)
    }
  }

  function openDay(date: string) {
    appStore.setSelectedDate(new Date(date + 'T12:00:00'))
    appStore.setJournalTab(tab === 'tasks' ? 'tasks' : 'notes')
  }
</script>

<div class="report-toolbar">
  <div class="segmented" role="radiogroup" aria-label="Show">
    <button role="radio" aria-checked={tab === 'notes'} onclick={() => appStore.setOverviewTab('notes')}>Day notes</button>
    <button role="radio" aria-checked={tab === 'tasks'} onclick={() => appStore.setOverviewTab('tasks')}>Tasks</button>
  </div>
  <button
    type="button"
    class="copy-btn"
    class:copied
    onclick={copyToClipboard}
    disabled={!fullMarkdown}
    title="Copy as markdown"
    aria-label="Copy as markdown"
  >
    {#if copied}
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7"/>
      </svg>
      <span aria-live="polite">Copied</span>
    {:else}
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="5" y="2.5" width="8.5" height="10" rx="1.5"/>
        <path d="M2.5 5.5v7.5a1.5 1.5 0 0 0 1.5 1.5h7"/>
      </svg>
      <span>Copy</span>
    {/if}
  </button>
</div>

{#if sections.length}
  <div class="report-content" class:loading>
    {#each sections as s (s.date)}
      <section class="day">
        <h2><button type="button" class="day-link" onclick={() => openDay(s.date)}>{dayLabel(s.date)}</button></h2>
        <div class="day-body">{@html render(s.body)}</div>
      </section>
    {/each}
  </div>
{:else if loading}
  <div class="report-content" aria-busy="true">
    {#each [0, 1] as i (i)}
      <div class="skeleton-day">
        <span class="skeleton-line" style:width="8rem" style:height="1.1rem"></span>
        <span class="skeleton-line" style:width="80%"></span>
        <span class="skeleton-line" style:width="60%"></span>
      </div>
    {/each}
  </div>
{:else}
  <div class="empty-state">
    <div class="empty-headline">
      {#if tab === 'tasks'}No tasks in this period{:else}No day notes in this period{/if}
    </div>
    <div class="empty-sub">Try a different range, or write something today.</div>
  </div>
{/if}

<style>
  .report-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    font-family: var(--font-ui);
  }
  .segmented {
    display: inline-flex;
    padding: 2px;
    border-radius: var(--r-pill);
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
    border-radius: var(--r-pill);
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .segmented button:hover { color: var(--text); }
  .segmented button[aria-checked='true'] { color: var(--accent); background: var(--glass); }
  .copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.75rem;
    padding: 0.4rem 0.7rem;
    border-radius: var(--r-pill);
    line-height: 1;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .copy-btn svg { width: 12px; height: 12px; display: block; }
  .copy-btn:hover:not(:disabled) { color: var(--text); background: var(--glass-dark); }
  .copy-btn:disabled { opacity: 0.4; cursor: default; }
  .copy-btn.copied { color: var(--accent); background: var(--glass); }

  .report-content {
    line-height: 1.6;
    color: var(--text);
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .report-content.loading { opacity: 0.5; }
  .day + .day { margin-top: 2.5rem; }
  h2 {
    margin: 0 0 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--line);
    font-size: 1.25rem;
  }
  .day-link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    border-radius: var(--r-xs);
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .day-link:hover { opacity: 0.8; }
  .day-body :global(h1),
  .day-body :global(h2),
  .day-body :global(h3) { font-size: 1.05rem; margin: 1.25rem 0 0.5rem; }
  .day-body :global(h3) { color: var(--muted); }
  .day-body :global(p) { margin: 0.5rem 0; }
  .day-body :global(ul),
  .day-body :global(ol) { padding-left: 1.4rem; margin: 0.5rem 0; }
  .day-body :global(li.task) { list-style: none; margin-left: -1.4rem; }
  .day-body :global(li.task .mark) { display: inline-block; width: 1.2rem; color: var(--muted); }
  .day-body :global(li.task.done .mark) { color: var(--accent); }
  .day-body :global(li.task strong) { color: var(--accent); font-weight: 500; font-variant-numeric: tabular-nums; }
  .day-body :global(blockquote) {
    margin: 0.35rem 0 0.5rem;
    padding-left: 1rem;
    border-left: 2px solid var(--line);
    color: var(--muted);
    font-size: 0.9rem;
  }
  .day-body :global(blockquote p) { margin: 0; }
  .day-body :global(code) {
    background: var(--glass);
    padding: 0.1rem 0.35rem;
    border-radius: var(--r-xs);
    font-size: 0.85em;
  }
  .day-body :global(pre) {
    background: var(--input-bg);
    padding: 0.75rem 1rem;
    border-radius: var(--r-sm);
    overflow-x: auto;
  }
  .day-body :global(pre code) { background: none; padding: 0; }
  .day-body :global(img) { max-width: 100%; border-radius: var(--r-md); }
  .skeleton-day { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 2.5rem; }
  .empty-state {
    text-align: center;
    padding: 3.5rem 1.5rem;
    color: var(--muted);
    font-family: var(--font-ui);
  }
  .empty-headline { font-size: 0.95rem; opacity: 0.75; }
  .empty-sub { font-size: 0.8rem; opacity: 0.5; margin-top: 0.4rem; }
</style>
