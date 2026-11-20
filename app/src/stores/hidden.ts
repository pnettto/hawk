import { writable, get } from 'svelte/store'
import { authStore } from './auth'

// Hidden notes: a privacy screen, not encryption. A note marked `hidden` is
// stored and synced like any other, and its content is concealed until the
// main password is entered in the note (NoteEditor). Search matches it on
// title and tags only and never shows a snippet of its body. One note is
// revealed at a time. It's concealed again when you leave it, from
// "Lock note", on reload or logout, or after a while without activity.

const IDLE_MS = 10 * 60_000
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

// Id of the hidden note revealed right now.
export const revealedNote = writable<string | null>(null)

let idleTimer: ReturnType<typeof setTimeout> | undefined
function armIdle() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => conceal(), IDLE_MS)
}
function watchActivity(on: boolean) {
  for (const ev of ACTIVITY) {
    if (on) window.addEventListener(ev, armIdle, { passive: true, capture: true })
    else window.removeEventListener(ev, armIdle, { capture: true })
  }
  if (on) armIdle()
  else clearTimeout(idleTimer)
}

export function reveal(nid: string) {
  if (get(revealedNote) === null) watchActivity(true)
  revealedNote.set(nid)
}

// Conceal the given note (only if it's the revealed one), or whichever is.
export function conceal(nid?: string) {
  const cur = get(revealedNote)
  if (cur === null || (nid !== undefined && nid !== cur)) return
  watchActivity(false)
  revealedNote.set(null)
}

authStore.subscribe((s) => {
  if (!s.isAuth) conceal()
})

export const isConcealed = (note: { id: string; hidden?: boolean } | null | undefined, revealed: string | null) =>
  !!note?.hidden && note.id !== revealed
