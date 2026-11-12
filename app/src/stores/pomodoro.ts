import { get, writable } from 'svelte/store'
import { logsStore } from './logs'
import { showToast } from './toast'

// A single focus timer that follows the tab around. Nothing here touches the
// server: the running session is rebuilt from localStorage on reload, so
// leaving the page or reloading doesn't lose the countdown.

export const FOCUS_MS = 25 * 60_000
export const BREAK_MS = 5 * 60_000
const STORAGE_KEY = 'hawk_pomodoro'

export type PomodoroMode = 'focus' | 'break'

export interface PomodoroState {
  taskId: string | null
  // Copy of the task text, used when the day isn't loaded (e.g. after reload).
  taskText: string
  dateStr: string | null
  mode: PomodoroMode
  running: boolean
  // Epoch ms when the current phase ends; null while paused or idle.
  endsAt: number | null
  // Time left as of the last tick; authoritative while paused.
  remainingMs: number
  // Focus sessions finished in this tab.
  completed: number
}

export interface FocusTarget {
  id: string
  text: string
  dateStr: string
}

export const IDLE: PomodoroState = {
  taskId: null,
  taskText: '',
  dateStr: null,
  mode: 'focus',
  running: false,
  endsAt: null,
  remainingMs: FOCUS_MS,
  completed: 0,
}

export function phaseMs(mode: PomodoroMode): number {
  return mode === 'focus' ? FOCUS_MS : BREAK_MS
}

// "24:59" — rounds up so the clock only reads 0:00 once the phase is over.
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function remainingMs(state: PomodoroState, now: number): number {
  if (!state.running || state.endsAt === null) return Math.max(0, state.remainingMs)
  return Math.max(0, state.endsAt - now)
}

export function startSession(
  state: PomodoroState,
  target: FocusTarget,
  now: number,
): PomodoroState {
  return {
    ...state,
    taskId: target.id,
    taskText: target.text,
    dateStr: target.dateStr,
    mode: 'focus',
    running: true,
    endsAt: now + FOCUS_MS,
    remainingMs: FOCUS_MS,
  }
}

export function pause(state: PomodoroState, now: number): PomodoroState {
  if (!state.running) return state
  return { ...state, running: false, remainingMs: remainingMs(state, now), endsAt: null }
}

export function resume(state: PomodoroState, now: number): PomodoroState {
  if (state.running) return state
  const ms = state.remainingMs > 0 ? state.remainingMs : phaseMs(state.mode)
  return { ...state, running: true, endsAt: now + ms, remainingMs: ms }
}

function breakSession(state: PomodoroState, now: number): PomodoroState {
  return { ...state, mode: 'break', running: true, endsAt: now + BREAK_MS, remainingMs: BREAK_MS }
}

// Move the clock on to `now`. Reports the phase that just ran out, if any.
export function advance(
  state: PomodoroState,
  now: number,
): { state: PomodoroState; finished: PomodoroMode | null } {
  const left = remainingMs(state, now)
  if (!state.running || left > 0) return { state: { ...state, remainingMs: left }, finished: null }
  if (state.mode === 'focus') {
    return {
      state: { ...breakSession(state, now), completed: state.completed + 1 },
      finished: 'focus',
    }
  }
  return { state: { ...IDLE, completed: state.completed }, finished: 'break' }
}

// End the current phase early. A skipped focus session isn't counted.
export function skip(state: PomodoroState, now: number): PomodoroState {
  if (state.mode === 'focus') return breakSession(state, now)
  return { ...IDLE, completed: state.completed }
}

// ---- persistence ---------------------------------------------------------

function persist(state: PomodoroState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* localStorage unavailable */
  }
}

function restore(now: number): PomodoroState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return IDLE
    const saved = JSON.parse(raw) as Partial<PomodoroState>
    if (saved.mode !== 'focus' && saved.mode !== 'break') return IDLE
    if (typeof saved.remainingMs !== 'number') return IDLE
    let state: PomodoroState = {
      taskId: typeof saved.taskId === 'string' ? saved.taskId : null,
      taskText: typeof saved.taskText === 'string' ? saved.taskText : '',
      dateStr: typeof saved.dateStr === 'string' ? saved.dateStr : null,
      mode: saved.mode,
      running: saved.running === true && typeof saved.endsAt === 'number',
      endsAt: typeof saved.endsAt === 'number' ? saved.endsAt : null,
      remainingMs: saved.remainingMs,
      completed: typeof saved.completed === 'number' ? saved.completed : 0,
    }
    // The clock kept running while the tab was closed. A phase that ran out
    // in the meantime is just over — reopening shouldn't dump you into a
    // break that started hours ago.
    if (state.running) {
      const { state: next, finished } = advance(state, now)
      state = finished ? { ...IDLE, completed: next.completed } : next
    }
    persist(state)
    return state
  } catch {
    return IDLE
  }
}

function chime() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    if (ctx.state === 'suspended') void ctx.resume()
    const notes = [880, 660]
    notes.forEach((freq, i) => {
      const start = ctx.currentTime + i * 0.18
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.5)
    })
  } catch {
    /* audio unavailable */
  }
}

function announce(state: PomodoroState, finished: PomodoroMode) {
  chime()
  if (finished === 'break') {
    showToast('Break over')
    return
  }
  const id = state.taskId
  const dateStr = state.dateStr
  const task = id && dateStr
    ? get(logsStore).byDate[dateStr]?.tasks.find((t) => t.id === id)
    : undefined
  if (task && !task.done) {
    showToast('Focus done — break time', {
      action: 'Mark done',
      duration: 8000,
      onAction: () => logsStore.editTask(dateStr!, id!, { done: true }, { immediate: true }),
    })
    return
  }
  showToast('Focus done — break time')
}

function createPomodoroStore() {
  const { subscribe, set } = writable<PomodoroState>(restore(Date.now()))

  function commit(next: PomodoroState, finished: PomodoroMode | null = null) {
    set(next)
    persist(next)
    if (finished) announce(next, finished)
  }

  return {
    subscribe,
    // Start on this task, or pause/resume if it's the one already running.
    focusOn(target: FocusTarget) {
      const state = get({ subscribe })
      const now = Date.now()
      if (state.taskId === target.id && state.mode === 'focus') {
        commit(state.running ? pause(state, now) : resume(state, now))
        return
      }
      commit(startSession(state, target, now))
    },
    toggle() {
      const state = get({ subscribe })
      const now = Date.now()
      commit(state.running ? pause(state, now) : resume(state, now))
    },
    skip() {
      commit(skip(get({ subscribe }), Date.now()))
    },
    stop() {
      commit({ ...IDLE, completed: get({ subscribe }).completed })
    },
    tick() {
      const { state, finished } = advance(get({ subscribe }), Date.now())
      if (finished) commit(state, finished)
      else set(state)
    },
  }
}

export const pomodoroStore = createPomodoroStore()
