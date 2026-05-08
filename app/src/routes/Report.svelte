<script lang="ts">
  import { onMount } from 'svelte'
  import { logsStore } from '../stores/logs'
  import { appStore } from '../stores/app'
  import { debounce } from '../utils/debounce'
  import type { DayLog, HourEntry } from '../types/models'

  function fmt(d: Date) {
    return d.toISOString().split('T')[0]
  }

  const today = new Date()
  const lastWeek = new Date()
  lastWeek.setDate(today.getDate() - 6)

  let startDate = $state(fmt(lastWeek))
  let endDate = $state(fmt(today))
  let markdown = $state('')
  let loading = $state(false)
  let copied = $state(false)

  function generate(): string {
    const logs = $logsStore.byDate
    const start = new Date(startDate)
    const end = new Date(endDate)
    const dates: string[] = []
    const cur = new Date(start)
    while (cur <= end) {
      dates.push(fmt(cur))
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
        if (typeof dayLog.notesMarkdown === 'string' && dayLog.notesMarkdown.trim()) {
          out += `### Notes\n${dayLog.notesMarkdown.trim()}\n\n`
          hasContent = true
        }
        return hasContent ? out : null
      })
      .filter(Boolean)
      .join('\n\n')
  }

  async function refresh() {
    loading = true
    await logsStore.loadForRange(startDate, endDate)
    markdown = generate()
    loading = false
  }

  // Re-generate whenever logs update (loadForRange resolves) or dates change.
  $effect(() => {
    void $logsStore.byDate
    void startDate
    void endDate
    markdown = generate()
  })

  const debouncedRefresh = debounce(refresh, 250)

  function onDateChange() {
    loading = true
    debouncedRefresh()
  }

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

  onMount(refresh)
</script>

<div class="report-container">
  <div class="controls">
    <div class="date-group">
      <label for="r-start">From</label>
      <input id="r-start" type="date" bind:value={startDate} onchange={onDateChange} />
    </div>
    <div class="date-group">
      <label for="r-end">To</label>
      <input id="r-end" type="date" bind:value={endDate} onchange={onDateChange} />
    </div>
    <div class="actions">
      <button class="secondary" onclick={refresh}>Refresh</button>
      <button class:copied onclick={copyToClipboard}>{copied ? '✓ Copied' : 'Copy'}</button>
    </div>
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
    <div class="empty-notice">No logs found for this period</div>
  {/if}
</div>

<style>
  .controls {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
    align-items: center;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--line);
    padding-bottom: 1.5rem;
  }
  .date-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  label {
    font-size: 0.8rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05rem;
  }
  input[type='date'] {
    background: var(--bg);
    border: none;
    padding: 0.5rem;
    border-radius: 6px;
    color: var(--text);
    font-family: inherit;
  }
  .actions {
    margin-left: auto;
    display: flex;
    gap: 1rem;
  }
  @media (max-width: 600px) {
    .controls {
      flex-direction: column;
      align-items: stretch;
    }
    .actions {
      margin-left: 0;
      width: 100%;
    }
    button { flex: 1; }
  }
  button {
    background: var(--accent);
    color: #000;
    border: none;
    padding: 0.6rem 1.2rem;
    border-radius: 6px;
    font-weight: bold;
    cursor: pointer;
    opacity: 0.9;
    transition: opacity 0.2s;
  }
  button:hover { opacity: 1; }
  button.secondary {
    background: transparent;
    border: 1px solid var(--line);
    color: var(--text);
  }
  button.copied {
    background: #00d68f;
    color: #000;
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
  .empty-notice {
    text-align: center;
    padding: 3rem;
    color: var(--muted);
    font-style: italic;
  }
</style>
