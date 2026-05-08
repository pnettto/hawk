import { writable } from 'svelte/store'

export type Page = 'app' | 'notes' | 'report'
export type JournalTab = 'tasks' | 'notes'

interface AppState {
  selectedDate: Date
  currentPage: Page
  journalTab: JournalTab
}

function createAppStore() {
  const { subscribe, update, set } = writable<AppState>({
    selectedDate: new Date(),
    currentPage: 'app',
    journalTab: 'tasks',
  })

  return {
    subscribe,
    set,
    setSelectedDate: (date: Date) => update((s) => ({ ...s, selectedDate: date })),
    setCurrentPage: (page: Page) => update((s) => ({ ...s, currentPage: page })),
    setJournalTab: (tab: JournalTab) => update((s) => ({ ...s, journalTab: tab })),
  }
}

export const appStore = createAppStore()
