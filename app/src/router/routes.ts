// URL <-> navigation state. Pure: no DOM, no stores. `sync.ts` wires it up.
import type { JournalTab, Page } from '../stores/app'
import type { NotesFilter } from '../stores/notes'
import type { NoteMetadata } from '../types/models'

export type Route =
  | { page: 'journal'; date?: string; tab?: JournalTab; task?: string }
  | { page: 'notes'; filter?: NotesFilter; nid?: string }
  | { page: 'files' | 'extensions' | 'settings' }

// Same check the server uses for day keys.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const isDateStr = (s: string | null | undefined): s is string => !!s && DATE_RE.test(s)

// Filter names that sit where a note id would. Note ids are UUIDs or
// `day-YYYY-MM-DD`, so they never collide.
const FILTER_NAMES = ['all', 'notepad', 'day', 'untagged', 'trash'] as const
type NamedFilter = (typeof FILTER_NAMES)[number]
const isNamedFilter = (s: string): s is NamedFilter => (FILTER_NAMES as readonly string[]).includes(s)

const JOURNAL: Route = { page: 'journal' }

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

// Unknown or malformed input lands on the Journal.
export function parseRoute(pathAndQuery: string): Route {
  const [rawPath, ...rest] = (pathAndQuery || '/').split('?')
  const params = new URLSearchParams(rest.join('?').split('#')[0])
  const raw = rawPath.split('#')[0].split('/').filter(Boolean)
  const parts = raw.map(decode)
  if (parts.some((p) => p === null)) return JOURNAL
  const seg = parts as string[]

  if (seg.length === 0) return JOURNAL

  switch (seg[0]) {
    case 'journal': {
      if (seg.length === 1) return JOURNAL
      if (!isDateStr(seg[1])) return JOURNAL
      if (seg.length > 3) return JOURNAL
      let tab: 'tasks' | 'notes' = 'tasks'
      if (seg.length === 3) {
        if (seg[2] !== 'notes' && seg[2] !== 'tasks') return JOURNAL
        tab = seg[2]
      }
      const route: Route = { page: 'journal', date: seg[1], tab }
      const task = params.get('task')
      if (task && tab === 'tasks') route.task = task
      return route
    }
    case 'notes': {
      if (seg.length === 1) return { page: 'notes' }
      if (seg[1] === 'tag') {
        const tag = seg[2]
        if (seg.length !== 3 || !tag) return JOURNAL
        return { page: 'notes', filter: { kind: 'tag', tag } }
      }
      if (seg.length !== 2 || !seg[1]) return JOURNAL
      if (isNamedFilter(seg[1])) return { page: 'notes', filter: { kind: seg[1] } }
      return { page: 'notes', nid: seg[1] }
    }
    case 'files':
    case 'extensions':
    case 'settings':
      return seg.length === 1 ? { page: seg[0] } : JOURNAL
    default:
      return JOURNAL
  }
}

const enc = encodeURIComponent

// The canonical path. Pass `today` to fold today's Tasks view into `/`;
// pass null for an explicit link (Copy link).
export function formatRoute(route: Route, today: string | null): string {
  switch (route.page) {
    case 'journal': {
      const date = route.date ?? today
      const tab = route.tab ?? 'tasks'
      if (!date) return '/'
      if (date === today && tab === 'tasks' && !route.task) return '/'
      const base = `/journal/${date}${tab === 'notes' ? '/notes' : ''}`
      return route.task ? `${base}?task=${enc(route.task)}` : base
    }
    case 'notes': {
      if (route.nid) return `/notes/${enc(route.nid)}`
      const f = route.filter
      if (!f) return '/notes'
      if (f.kind === 'tag') return `/notes/tag/${enc(f.tag)}`
      return `/notes/${f.kind}`
    }
    default:
      return `/${route.page}`
  }
}

// The navigation state a route is built from.
export interface NavState {
  currentPage: Page
  journalTab: JournalTab
  selectedDate: string
  highlightTaskId: string | null
  notesFilter: NotesFilter
  selectedNid: string | null
}

export function routeFromNav(s: NavState): Route {
  switch (s.currentPage) {
    case 'app':
      return {
        page: 'journal',
        date: s.selectedDate,
        tab: s.journalTab,
        ...(s.highlightTaskId && s.journalTab === 'tasks' ? { task: s.highlightTaskId } : {}),
      }
    case 'notes':
      return s.selectedNid ? { page: 'notes', nid: s.selectedNid } : { page: 'notes', filter: s.notesFilter }
    case 'admin':
      return { page: 'settings' }
    default:
      return { page: s.currentPage }
  }
}

const filterKey = (f?: NotesFilter) => (f ? (f.kind === 'tag' ? `tag:${f.tag}` : f.kind) : '')

// Push for "places" (page, note, notes filter); replace for small steps
// (dates, journal tabs) so they don't fill the Back stack.
export function historyMode(prev: Route | null, next: Route): 'push' | 'replace' {
  if (!prev) return 'replace'
  if (prev.page !== next.page) return 'push'
  if (prev.page === 'notes' && next.page === 'notes') {
    if ((prev.nid ?? null) !== (next.nid ?? null)) return 'push'
    if (!next.nid && filterKey(prev.filter) !== filterKey(next.filter)) return 'push'
  }
  return 'replace'
}

// Whether a note shows up in the Notepad list under a filter. Mirrors the
// list in lib/notes/NotesColumn.svelte.
export function filterIncludes(filter: NotesFilter, n: NoteMetadata): boolean {
  if (filter.kind === 'trash') return !!n.deletedAt
  if (n.deletedAt) return false
  switch (filter.kind) {
    case 'all':
      return true
    case 'notepad':
      return !n.day
    case 'day':
      return !!n.day
    case 'untagged':
      return !n.tags?.length
    case 'tag':
      return !!n.tags?.includes(filter.tag)
  }
}

// The filter to open a note under: the current one if it shows the note,
// otherwise the narrowest built-in view that does.
export function filterFor(current: NotesFilter, n: NoteMetadata): NotesFilter {
  if (filterIncludes(current, n)) return current
  if (n.deletedAt) return { kind: 'trash' }
  return n.day ? { kind: 'day' } : { kind: 'notepad' }
}
