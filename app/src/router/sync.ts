// Keeps the URL and the navigation stores in step. The stores stay the source
// of truth: on boot and on Back/Forward the URL is written into them, and any
// store change is reflected back into the URL.
import { get } from 'svelte/store'
import { appStore } from '../stores/app'
import { notesStore, noteLabel, type NotesFilter } from '../stores/notes'
import { authStore } from '../stores/auth'
import { showError } from '../stores/toast'
import { apiOrigin } from '../api/client'
import { formatDate } from '../utils/date'
import * as loc from './location'
import { filterFor, formatRoute, historyMode, parseRoute, routeFromNav, type Route } from './routes'

const today = () => formatDate(new Date())
const toDate = (s: string) => new Date(s + 'T12:00:00')
const filterKey = (f: NotesFilter) => (f.kind === 'tag' ? `tag:${f.tag}` : f.kind)

// What the history entry was pushed from, so closing a note can step Back
// instead of stacking another list entry.
type EntryState = { from?: string } | null

export function currentRoute(): Route {
  const app = get(appStore)
  const notes = get(notesStore)
  return routeFromNav({
    currentPage: app.currentPage,
    journalTab: app.journalTab,
    selectedDate: formatDate(app.selectedDate),
    highlightTaskId: app.highlightTaskId,
    notesFilter: notes.filter,
    selectedNid: notes.selectedNid,
  })
}

// An absolute web link for Copy link. The extension copies the web URL, not
// chrome-extension://…
export function linkTo(route: Route): string {
  return apiOrigin() + formatRoute(route, null)
}

let lastRoute: Route | null = null
// The next URL write replaces instead of pushing: boot, Back/Forward, and
// fixing up a link that pointed nowhere.
let forceReplace = false
let scheduled = false
// A note link waiting for the notes index. URL writes hold until it's applied.
let pendingNote = false
let applySeq = 0

function schedule() {
  if (scheduled) return
  scheduled = true
  // Several setters often run together (applyRoute, opening a day from a
  // note). Writing once afterwards keeps intermediate states out of history.
  queueMicrotask(flush)
}

function flush() {
  scheduled = false
  // Leave the URL alone behind the login overlay so the link survives login.
  if (pendingNote || !get(authStore).isAuth) return
  // The demo has no Files page.
  if (get(authStore).isGuest && get(appStore).currentPage === 'files') {
    forceReplace = true
    appStore.setCurrentPage('app')
    return
  }
  const route = currentRoute()
  document.title = titleFor(route)
  const url = formatRoute(route, today())
  const here = loc.read()
  if (url !== here) {
    const mode = forceReplace ? 'replace' : historyMode(lastRoute, route)
    if (mode === 'push') loc.push(url, { from: here } satisfies EntryState)
    else loc.replace(url)
  }
  forceReplace = false
  lastRoute = route
}

function applyRoute(route: Route, { boot }: { boot: boolean }) {
  const seq = ++applySeq
  pendingNote = false
  const remember = !boot
  const app = get(appStore)
  const page = route.page === 'journal' ? 'app' : route.page === 'settings' ? 'admin' : route.page
  if (app.currentPage !== page) appStore.setCurrentPage(page)

  switch (route.page) {
    case 'journal': {
      const date = route.date ?? today()
      if (formatDate(app.selectedDate) !== date) appStore.setSelectedDate(route.date ? toDate(date) : new Date())
      // `/` keeps the remembered tab on boot; anywhere else it means Tasks.
      const tab = route.tab ?? (boot ? undefined : 'tasks')
      if (tab && app.journalTab !== tab) appStore.setJournalTab(tab, { remember })
      if (app.highlightTaskId !== (route.task ?? null)) appStore.setHighlightTask(route.task ?? null)
      break
    }
    case 'notes': {
      const notes = get(notesStore)
      if (route.nid) {
        openNote(route.nid, seq)
      } else if (route.filter && filterKey(route.filter) !== filterKey(notes.filter)) {
        notesStore.setFilter(route.filter, { remember })
      } else if (notes.selectedNid) {
        notesStore.clearSelectedNote()
      }
      break
    }
  }
}

// Open a linked note once the index has loaded (the Notepad page loads it on
// mount), under a filter that shows it.
function openNote(nid: string, seq: number) {
  if (!get(notesStore).loaded) {
    pendingNote = true
    let unsub: (() => void) | null = null
    let done = false
    unsub = notesStore.subscribe((s) => {
      if (!s.loaded || done) return
      done = true
      queueMicrotask(() => {
        unsub?.()
        if (seq !== applySeq) return
        pendingNote = false
        // Moved somewhere else while the notes were loading.
        if (get(appStore).currentPage === 'notes') openNote(nid, seq)
        else schedule()
      })
    })
    return
  }
  const s = get(notesStore)
  const note = s.allNotes.find((n) => n.id === nid)
  if (!note) {
    showError('Couldn’t find that note.')
    forceReplace = true
    if (s.selectedNid) notesStore.clearSelectedNote()
    schedule()
    return
  }
  const filter = filterFor(s.filter, note)
  if (filterKey(filter) !== filterKey(s.filter)) notesStore.setFilter(filter, { remember: false })
  if (s.selectedNid !== nid) void notesStore.selectNote(nid)
  schedule()
}

function onLocationChange() {
  const route = parseRoute(loc.read())
  forceReplace = true
  lastRoute = route
  applyRoute(route, { boot: false })
  schedule()
}

// Go somewhere from inside the app (search results). Places push a history
// entry, smaller steps replace, as for any other navigation.
export function navigate(route: Route) {
  lastRoute = currentRoute()
  applyRoute(route, { boot: false })
  schedule()
}

let started = false

// Called once at startup, before the session check finishes, so the first
// page shown is the linked one.
export function startRouter() {
  if (started) return
  started = true
  const route = parseRoute(loc.read())
  forceReplace = true
  applyRoute(route, { boot: true })
  appStore.subscribe(schedule)
  notesStore.subscribe(schedule)
  authStore.subscribe(schedule)
  loc.onChange(onLocationChange)
}

// The editor's back button on mobile: step Back to the list when that's
// where the note was opened from; otherwise close it in place.
export function closeNote() {
  const from = (loc.state() as EntryState)?.from
  const prev = from ? parseRoute(from) : null
  if (prev?.page === 'notes' && !prev.nid && !pendingNote) {
    history.back()
    return
  }
  forceReplace = true
  notesStore.clearSelectedNote()
}

const FILTER_TITLES: Record<Exclude<NotesFilter['kind'], 'tag'>, string> = {
  pinned: 'Pinned notes',
  notepad: 'Notepad',
  all: 'All notes',
  day: 'Journal notes',
  untagged: 'Not tagged',
  trash: 'Trash',
}

function titleFor(route: Route): string {
  let part: string
  switch (route.page) {
    case 'journal':
      part = toDate(route.date ?? today()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      break
    case 'notes': {
      if (route.nid) {
        const note = get(notesStore).allNotes.find((n) => n.id === route.nid)
        part = !note ? 'Notepad' : note.hidden ? 'Hidden note' : noteLabel(note)
      } else {
        const f = route.filter
        part = !f ? 'Notepad' : f.kind === 'tag' ? `#${f.tag}` : FILTER_TITLES[f.kind]
      }
      break
    }
    case 'files':
      part = 'Files'
      break
    case 'extensions':
      part = 'Extensions'
      break
    case 'settings':
      part = 'Settings'
      break
  }
  return `Hawk · ${part}`
}

// For tests.
export function _resetRouterForTests() {
  started = false
  lastRoute = null
  forceReplace = false
  scheduled = false
  pendingNote = false
}
