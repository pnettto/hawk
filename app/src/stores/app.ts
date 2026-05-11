import { writable } from 'svelte/store'

export type Page = 'app' | 'notes' | 'report' | 'admin'
export type JournalTab = 'tasks' | 'notes'
export type ReportTab = 'notes' | 'tasks'

interface AppState {
  selectedDate: Date
  currentPage: Page
  journalTab: JournalTab
  reportTab: ReportTab
}

function createAppStore() {
  const { subscribe, update, set } = writable<AppState>({
    selectedDate: new Date(),
    currentPage: 'app',
    journalTab: 'tasks',
    reportTab: 'notes',
  })

  return {
    subscribe,
    set,
    setSelectedDate: (date: Date) => update((s) => ({ ...s, selectedDate: date })),
    setCurrentPage: (page: Page) => update((s) => ({ ...s, currentPage: page })),
    setJournalTab: (tab: JournalTab) => update((s) => ({ ...s, journalTab: tab })),
    setReportTab: (tab: ReportTab) => update((s) => ({ ...s, reportTab: tab })),
  }
}

export const appStore = createAppStore()
