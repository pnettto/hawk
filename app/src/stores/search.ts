// Global search: the dialog's state and requests. The query and kind are kept
// for the session, so reopening the dialog shows the same results.
import { writable, get } from 'svelte/store'
import { search as searchApi, type SearchKind, type SearchResults } from '../api/search'
import { parseQuery } from '../lib/search/match'

interface SearchState {
  open: boolean
  query: string
  kind: SearchKind
  results: SearchResults | null
  // The query the shown results belong to.
  resultsFor: string
  loading: boolean
  error: boolean
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
      update((s) => ({ ...s, open: false }))
    },
    setQuery(query: string) {
      update((s) => ({ ...s, query }))
      schedule()
    },
    setKind(kind: SearchKind) {
      update((s) => ({ ...s, kind }))
      schedule(0)
    },
    // Search again now, e.g. after saving pending edits on open.
    refresh: () => schedule(0),
  }
}

export const searchStore = createSearchStore()
