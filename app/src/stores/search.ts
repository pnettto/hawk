// Global search: the dialog's state and requests. The query and kind are kept
// for the session, so reopening the dialog shows the same results.
import { writable, derived, get } from 'svelte/store'
import { search as searchApi, type SearchKind, type SearchResults } from '../api/search'
import { parseQuery } from '../lib/search/match'
import { parseQuickDate, parseQuickEntry } from '../lib/daily/quickTask'
import { splitTitleTags } from '../lib/notes/tags'
import { appStore } from './app'
import { logsStore } from './logs'
import { notesStore } from './notes'
import { showToast } from './toast'
import { navigate } from '../router/sync'
import { formatDate } from '../utils/date'

interface SearchState {
  open: boolean
  query: string
  kind: SearchKind
  results: SearchResults | null
  // The query the shown results belong to.
  resultsFor: string
  loading: boolean
  error: boolean
  // A day picked on the "Add task" row's calendar. Beats the default date
  // until a date word is typed or the dialog closes.
  createDate: string | null
}

const RECENT_KEY = 'hawk_recent_searches'
const RECENT_MAX = 5
const DEBOUNCE_MS = 150

export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

export function rememberQuery(q: string) {
  const query = q.trim()
  if (!query) return
  const next = [query, ...loadRecent().filter((x) => x !== query)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* private mode / quota */
  }
}

function createSearchStore() {
  const store = writable<SearchState>({
    open: false,
    query: '',
    kind: 'all',
    results: null,
    resultsFor: '',
    loading: false,
    error: false,
    createDate: null,
  })
  const { subscribe, update } = store

  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | null = null
  let seq = 0

  async function run() {
    const { query, kind } = get(store)
    controller?.abort()
    const key = `${kind}:${query}`
    if (!parseQuery(query)) {
      seq++
      update((s) => ({ ...s, results: null, resultsFor: '', loading: false, error: false }))
      return
    }
    const mine = ++seq
    const ctl = (controller = new AbortController())
    update((s) => ({ ...s, loading: true }))
    try {
      const results = await searchApi(query, kind, ctl.signal)
      if (mine !== seq) return
      update((s) => ({ ...s, results, resultsFor: key, loading: false, error: false }))
    } catch (e) {
      if (mine !== seq || (e as Error)?.name === 'AbortError') return
      console.error('Search failed:', e)
      update((s) => ({ ...s, loading: false, error: true }))
    }
  }

  function schedule(delay = DEBOUNCE_MS) {
    clearTimeout(timer)
    timer = setTimeout(() => void run(), delay)
  }

  return {
    subscribe,
    open: () => update((s) => (s.open ? s : { ...s, open: true })),
    close: () => {
      clearTimeout(timer)
      update((s) => ({ ...s, open: false, createDate: null }))
    },
    setQuery(query: string) {
      update((s) => ({
        ...s,
        query,
        createDate: s.createDate && parseQuickDate(query, new Date()).date ? null : s.createDate,
      }))
      schedule()
    },
    setCreateDate: (createDate: string | null) => update((s) => ({ ...s, createDate })),
    setKind(kind: SearchKind) {
      update((s) => ({ ...s, kind }))
      schedule(0)
    },
    // Search again now, e.g. after saving pending edits on open.
    refresh: () => schedule(0),
  }
}

export const searchStore = createSearchStore()

// ---- Quick create -----------------------------------------------------------
// Rows under the results that turn the typed text into a task or a note.

export type CreateKind = 'task' | 'note' | 'day-note'

export interface CreateItem {
  kind: CreateKind
  label: string
  // Muted text after the label: the task's date and time, the note's tags.
  detail: string
  // The task row's date, for its calendar button.
  date?: string
  run(opts?: { stayOpen?: boolean }): Promise<void>
}

// "Today", "Tomorrow" or "Thu, May 15" (with the year when it isn't this one).
export function dayName(dateStr: string, now = new Date()): string {
  const today = formatDate(now)
  if (dateStr === today) return 'Today'
  const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (dateStr === formatDate(tmr)) return 'Tomorrow'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

interface CreateCtx {
  query: string
  kind: SearchKind
  createDate: string | null
  onJournal: boolean
  journalDate: string
  dayNotesOpen: boolean
}

// Worked out again when a row runs, so "today" is right after midnight.
function taskPlan(c: CreateCtx, now = new Date()) {
  const entry = parseQuickEntry(c.query, now)
  const date = c.createDate ?? entry.date ?? (c.onJournal ? c.journalDate : formatDate(now))
  return { text: entry.text, time: entry.time, date }
}

type AppState = Parameters<Parameters<typeof appStore.subscribe>[0]>[0]

function ctxOf(s: SearchState, a: AppState): CreateCtx {
  return {
    query: s.query.trim(),
    kind: s.kind,
    createDate: s.createDate,
    onJournal: a.currentPage === 'app',
    journalDate: formatDate(a.selectedDate),
    dayNotesOpen: a.currentPage === 'app' && a.journalTab === 'notes',
  }
}

const ctxNow = () => ctxOf(get(searchStore), get(appStore))

async function addTask({ stayOpen = false } = {}) {
  const { text, time, date } = taskPlan(ctxNow())
  if (!text) return
  // addTask orders from the day's loaded tasks; load it so this one lands last.
  await logsStore.loadForDate(date)
  const task = logsStore.addTask(date, { text, ...(time ? { time } : {}) })
  if (stayOpen) {
    searchStore.setQuery('')
    searchStore.setCreateDate(null)
  } else {
    searchStore.close()
  }
  showToast(`Task added to ${dayName(date)}`, {
    action: 'Open',
    onAction: () => navigate({ page: 'journal', date, tab: 'tasks', task: task.id }),
  })
}

async function newNote() {
  const { title, tags } = splitTitleTags(ctxNow().query)
  const nid = notesStore.createNote({ title, tags })
  searchStore.close()
  appStore.setFocusNoteBody(nid)
  navigate({ page: 'notes', nid })
}

async function newDayNote() {
  const c = ctxNow()
  const day = c.journalDate
  const { title, tags } = splitTitleTags(c.query)
  const order = Math.max(-1, ...get(notesStore).allNotes.filter((n) => n.day === day && !n.deletedAt).map((n) => n.dayOrder ?? 0)) + 1
  const nid = notesStore.createNote({ title, tags, day, dayOrder: order, select: false })
  searchStore.close()
  appStore.setFocusDayNote(nid)
  navigate({ page: 'journal', date: day, tab: 'notes' })
}

export function buildCreateItems(c: CreateCtx, now = new Date()): CreateItem[] {
  if (!c.query) return []
  const items: CreateItem[] = []
  if (c.kind !== 'notes') {
    const t = taskPlan(c, now)
    items.push({
      kind: 'task',
      label: `Add task “${t.text}”`,
      detail: [dayName(t.date, now), t.time].filter(Boolean).join(', '),
      date: t.date,
      run: addTask,
    })
  }
  if (c.kind !== 'tasks') {
    const { title, tags } = splitTitleTags(c.query)
    const detail = tags.map((t) => `#${t}`).join(' ')
    items.push({ kind: 'note', label: title ? `New note “${title}”` : 'New note', detail, run: newNote })
    if (c.dayNotesOpen) {
      items.push({
        kind: 'day-note',
        label: title ? `New day note “${title}”` : 'New day note',
        detail: dayName(c.journalDate, now),
        run: newDayNote,
      })
    }
  }
  return items
}

export const createItems = derived([searchStore, appStore], ([s, a]) => buildCreateItems(ctxOf(s, a)))
