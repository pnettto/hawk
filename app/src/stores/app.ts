import { writable } from 'svelte/store'

export type Page = 'app' | 'notes' | 'files' | 'extensions' | 'admin'
export type JournalTab = 'tasks' | 'notes'

interface AppState {
  selectedDate: Date
  currentPage: Page
  journalTab: JournalTab
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
  return v === 'notes' || v === 'tasks' ? v : 'tasks'
}

function createAppStore() {
  const { subscribe, update, set } = writable<AppState>({
    selectedDate: new Date(),
    currentPage: 'app',
    journalTab: loadJournalTab(),
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
  }
}

export const appStore = createAppStore()
