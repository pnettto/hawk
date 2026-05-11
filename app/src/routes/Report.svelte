<script lang="ts">
  import { onMount } from 'svelte'
  import { logsStore } from '../stores/logs'
  import { appStore } from '../stores/app'
  import { debounce } from '../utils/debounce'
  import { formatDate } from '../utils/date'
  import type { DayLog, HourEntry } from '../types/models'

  interface Props {
    startDate: Date
    endDate: Date
  }
  let { startDate, endDate }: Props = $props()

  let markdown = $state('')
  let loading = $state(false)
  let copied = $state(false)

  function generate(): string {
    const logs = $logsStore.byDate
    const tab = $appStore.reportTab
    const startStr = formatDate(startDate)
    const endStr = formatDate(endDate)
    const start = new Date(startStr + 'T12:00:00')
    const end = new Date(endStr + 'T12:00:00')
    const dates: string[] = []
    const cur = new Date(start)
    while (cur <= end) {
      dates.push(formatDate(cur))
      cur.setDate(cur.getDate() + 1)
    }
    return dates
      .map((date) => {
        const dayLog = logs[date] as DayLog | undefined
        if (!dayLog || Object.keys(dayLog).length === 0) return null
        const d = new Date(date + 'T12:00:00')
        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
        let out = `## ${date} ${dayName}\n\n`
        let hasContent = false
        if (tab === 'tasks') {
          const entries = Object.entries(dayLog)
            .filter(([hour, data]) => {
              if (!hour.includes('-') && isNaN(Number(hour))) return false
              const e = data as HourEntry
              return !!(e?.text?.trim() || e?.comment?.trim())
            })
            .sort((a, b) => {
              const mins = (k: string) => {
                const [h, m] = k.split('-').map(Number)
                return h * 60 + (m || 0)
              }
              return mins(a[0]) - mins(b[0])
            })
            .map(([hour, data]) => {
              const e = data as HourEntry
              const time = hour.replace('-30', ':30').replace(/-00|$/, ':00')
              const cb = e.checked ? '[x]' : '[ ]'
              let line = `- ${cb} **${time}** ${e.text || ''}`
              if (e.comment) {
                const lines = e.comment
                  .split('\n')
                  .map((l) => `  > ${l}`)
                  .join('\n')
                line += `\n${lines}`
              }
              return line
            })
          if (entries.length) {
            out += entries.join('\n') + '\n\n'
            hasContent = true
          }
        } else {
          if (typeof dayLog.notesMarkdown === 'string' && dayLog.notesMarkdown.trim()) {
            out += `${dayLog.notesMarkdown.trim()}\n\n`
            hasContent = true
          }
        }
        return hasContent ? out : null
      })
      .filter(Boolean)
      .join('\n\n')
  }

  async function refresh() {
    loading = true
    await logsStore.loadForRange(formatDate(startDate), formatDate(endDate))
    markdown = generate()
    loading = false
  }

  const debouncedRefresh = debounce(refresh, 250)

  // Refetch when the parent updates the date range (skip the initial run —
  // onMount already kicks off the first load).
  let mounted = false
  $effect(() => {
    void startDate
    void endDate
    if (!mounted) return
    loading = true
    debouncedRefresh()
  })

  // Re-generate whenever logs update (loadForRange resolves), dates change,
  // or the active tab changes.
  $effect(() => {
    void $logsStore.byDate
    void startDate
    void endDate
    void $appStore.reportTab
    markdown = generate()
  })

  async function copyToClipboard() {
    if (!markdown) return
    try {
      await navigator.clipboard.writeText(markdown)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch (e) {
      console.error('Failed to copy', e)
    }
  }

  function onClickReport(e: MouseEvent) {
    const el = (e.target as HTMLElement | null)?.closest('h2')
    if (!el) return
    const dateStr = el.textContent?.split(' ')[0] ?? ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      appStore.setSelectedDate(new Date(dateStr + 'T12:00:00'))
      appStore.setCurrentPage('app')
      appStore.setJournalTab($appStore.reportTab === 'tasks' ? 'tasks' : 'notes')
    }
  }

  // Cheap markdown→HTML for headings, bold, lists, blockquotes — plus paragraphs.
  // Keeps the report rendering self-contained (no marked dep on this page yet).
  function renderMarkdown(md: string): string {
    const lines = md.split('\n')
    const out: string[] = []
    let inList = false
    let inBlockquote = false
    const closeList = () => {
      if (inList) {
        out.push('</ul>')
        inList = false
      }
    }
    const closeQuote = () => {
      if (inBlockquote) {
        out.push('</blockquote>')
        inBlockquote = false
      }
    }
    const inline = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    for (const raw of lines) {
      const line = raw
      if (line.startsWith('## ')) {
        closeList()
        closeQuote()
        out.push(`<h2>${inline(line.slice(3))}</h2>`)
      } else if (line.startsWith('### ')) {
        closeList()
        closeQuote()
        out.push(`<h3>${inline(line.slice(4))}</h3>`)
      } else if (line.startsWith('- ')) {
        closeQuote()
        if (!inList) {
          out.push('<ul>')
          inList = true
        }
        out.push(`<li>${inline(line.slice(2))}</li>`)
      } else if (/^\s*>\s?/.test(line)) {
        closeList()
        if (!inBlockquote) {
          out.push('<blockquote>')
          inBlockquote = true
        }
        out.push(inline(line.replace(/^\s*>\s?/, '')) + '<br>')
      } else if (line.trim() === '') {
        closeList()
        closeQuote()
      } else {
        closeList()
        closeQuote()
        out.push(`<p>${inline(line)}</p>`)
      }
    }
    closeList()
    closeQuote()
    return out.join('\n')
  }

  let html = $derived(renderMarkdown(markdown))

  onMount(() => {
    mounted = true
    refresh()
  })
</script>

<div class="report-toolbar">
  <div class="report-filter">
    <button
      class:active={$appStore.reportTab === 'notes'}
      onclick={() => appStore.setReportTab('notes')}>Day Notes</button
    >
    <button
      class:active={$appStore.reportTab === 'tasks'}
      onclick={() => appStore.setReportTab('tasks')}>Tasks</button
    >
  </div>
  <button
    type="button"
    class="copy-btn"
    class:copied
    onclick={copyToClipboard}
    title="Copy markdown"
    aria-label="Copy markdown"
  >
    {#if copied}
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7"/>
      </svg>
      <span>Copied</span>
    {:else}
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="5" y="2.5" width="8.5" height="10" rx="1.5"/>
        <path d="M2.5 5.5v7.5a1.5 1.5 0 0 0 1.5 1.5h7"/>
      </svg>
      <span>Copy</span>
    {/if}
  </button>
</div>

{#if markdown}
  <div
    class="report-content"
    class:loading
    onclick={onClickReport}
    role="presentation"
  >
    {@html html}
  </div>
{:else}
  <div class="empty-state">
    <div class="empty-headline">
      {#if $appStore.reportTab === 'tasks'}No tasks in this period{:else}No day notes in this period{/if}
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
    font-family: var(--font-ui, inherit);
  }
  .report-filter {
    display: flex;
    gap: 0.25rem;
  }
  .report-filter button {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.72rem;
    padding: 0.4rem 0.75rem;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .report-filter button:hover {
    color: var(--text);
    background: var(--glass-dark);
  }
  .report-filter button.active {
    color: var(--accent);
    background: var(--glass);
  }
  .copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.72rem;
    padding: 0.4rem 0.6rem;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    line-height: 1;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .copy-btn svg { width: 12px; height: 12px; display: block; }
  .copy-btn:hover {
    color: var(--text);
    background: var(--glass-dark);
  }
  .copy-btn.copied {
    color: var(--accent);
    background: var(--glass);
  }
  .report-content {
    line-height: 1.6;
    color: var(--text);
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .report-content.loading { opacity: 0.4; }
  .report-content :global(h2) {
    color: var(--accent);
    font-size: 1.5rem;
    margin-top: 2.5rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--line);
    padding-bottom: 0.5rem;
    cursor: pointer;
  }
  .report-content :global(h2:hover) { opacity: 0.8; }
  .report-content :global(h2:first-child) { margin-top: 0; }
  .report-content :global(h3) {
    font-size: 1.1rem;
    color: var(--muted);
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.05rem;
  }
  .report-content :global(ul) {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .report-content :global(li) { margin-bottom: 0.5rem; }
  .report-content :global(blockquote) {
    margin: 0.5rem 0;
    padding-left: 1rem;
    border-left: 2px solid var(--line);
    color: var(--muted);
    font-style: italic;
    font-size: 0.9rem;
  }
  .report-content :global(strong) {
    color: var(--accent);
    font-weight: normal;
  }
  .empty-state {
    text-align: center;
    padding: 3.5rem 1.5rem;
    color: var(--muted);
    font-family: var(--font-ui, inherit);
  }
  .empty-headline { font-size: 0.95rem; opacity: 0.75; }
  .empty-sub { font-size: 0.8rem; opacity: 0.5; margin-top: 0.4rem; }
</style>
