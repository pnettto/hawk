import { writable } from 'svelte/store'

export type Page = 'app' | 'notes' | 'files' | 'admin'
export type JournalTab = 'tasks' | 'notes' | 'overview'
export type OverviewTab = 'notes' | 'tasks'

interface AppState {
  selectedDate: Date
  currentPage: Page
  journalTab: JournalTab
  overviewTab: OverviewTab
  // Overview range lives here (not in the route) so it survives navigation.
  overviewStart: Date
  overviewEnd: Date
}

const JOURNAL_TAB_KEY = 'hawk_journal_tab'

function loadJournalTab(): JournalTab {
  if (typeof localStorage === 'undefined') return 'tasks'
  const v = localStorage.getItem(JOURNAL_TAB_KEY)
  if (v === 'report') return 'overview'
  return v === 'notes' || v === 'tasks' || v === 'overview' ? v : 'tasks'
}

function createAppStore() {
  const { subscribe, update, set } = writable<AppState>({
    selectedDate: new Date(),
    currentPage: 'app',
    journalTab: loadJournalTab(),
    overviewTab: 'notes',
    overviewStart: (() => {
      const d = new Date()
      d.setDate(d.getDate() - 6)
      return d
    })(),
    overviewEnd: new Date(),
  })

  return {
    subscribe,
    set,
    setSelectedDate: (date: Date) => update((s) => ({ ...s, selectedDate: date })),
    setCurrentPage: (page: Page) => update((s) => ({ ...s, currentPage: page })),
    setJournalTab: (tab: JournalTab) =>
      update((s) => {
        try {
          localStorage.setItem(JOURNAL_TAB_KEY, tab)
        } catch {
          // ignore — private mode / quota
        }
        return { ...s, journalTab: tab }
      }),
    setOverviewTab: (tab: OverviewTab) => update((s) => ({ ...s, overviewTab: tab })),
    // Keeps start ≤ end by swapping when the user picks them out of order.
    setOverviewRange: (start: Date, end: Date) =>
      update((s) =>
        start <= end
          ? { ...s, overviewStart: start, overviewEnd: end }
          : { ...s, overviewStart: end, overviewEnd: start },
      ),
  }
}

export const appStore = createAppStore()
