import { writable } from 'svelte/store'

export type Page = 'app' | 'notes' | 'files' | 'extensions' | 'admin'
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
  // A task to scroll to and flash once, set by a deep link. DayTasks clears it.
  highlightTaskId: string | null
  // A day note to switch to once, set by search. DayNotes clears it.
  focusDayNoteId: string | null
  // A note whose body should take focus once it opens (quick create).
  focusNoteBodyId: string | null
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
    highlightTaskId: null,
    focusDayNoteId: null,
    focusNoteBodyId: null,
  })

  return {
    subscribe,
    set,
    setSelectedDate: (date: Date) => update((s) => ({ ...s, selectedDate: date })),
    setCurrentPage: (page: Page) => update((s) => ({ ...s, currentPage: page })),
    // `remember: false` is for links: they open a tab without making it the
    // default for next time.
    setJournalTab: (tab: JournalTab, { remember = true }: { remember?: boolean } = {}) =>
      update((s) => {
        if (remember) {
          try {
            localStorage.setItem(JOURNAL_TAB_KEY, tab)
          } catch {
            // ignore — private mode / quota
          }
        }
        return { ...s, journalTab: tab }
      }),
    setHighlightTask: (id: string | null) => update((s) => ({ ...s, highlightTaskId: id })),
    setFocusDayNote: (id: string | null) => update((s) => ({ ...s, focusDayNoteId: id })),
    setFocusNoteBody: (id: string | null) => update((s) => ({ ...s, focusNoteBodyId: id })),
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
