import { writable } from 'svelte/store'

export type Page = 'app' | 'notes' | 'admin'
export type JournalTab = 'tasks' | 'notes' | 'report'
export type ReportTab = 'notes' | 'tasks'

interface AppState {
  selectedDate: Date
  currentPage: Page
  journalTab: JournalTab
  reportTab: ReportTab
}

const JOURNAL_TAB_KEY = 'hawk_journal_tab'

function loadJournalTab(): JournalTab {
  if (typeof localStorage === 'undefined') return 'tasks'
  const v = localStorage.getItem(JOURNAL_TAB_KEY)
  return v === 'notes' || v === 'tasks' || v === 'report' ? v : 'tasks'
}

function createAppStore() {
  const { subscribe, update, set } = writable<AppState>({
    selectedDate: new Date(),
    currentPage: 'app',
    journalTab: loadJournalTab(),
    reportTab: 'notes',
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
    setReportTab: (tab: ReportTab) => update((s) => ({ ...s, reportTab: tab })),
  }
}

export const appStore = createAppStore()
