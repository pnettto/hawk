import { get, writable } from 'svelte/store'
import { getClientId, isGuestMode } from '../api/client'
import { getPomodoro, savePomodoro, type PomodoroRecord } from '../api/pomodoro'
import { appStore } from './app'
import { logsStore } from './logs'
import { preferencesStore } from './preferences'
import { showToast } from './toast'
import {
  extensionChoice,
  extensionNumber,
  extensionState,
  extensionSwitch,
} from '../lib/extensions/registry'

// A single focus timer, shared across devices. The server stores the running
// state; localStorage keeps a copy so the widget paints immediately on reload.
// Every session renders the same countdown, but only the session that started
// the current pomodoro shows the end-of-block notification. If it closes, the
// server hands that duty to another session, preferring a tab in the same
// browser. The block lengths come from the Pomodoro extension's settings.

export const FOCUS_MS = 25 * 60_000
export const BREAK_MS = 5 * 60_000
export const EXTENSION_ID = 'pomodoro'
const MINUTE = 60_000
const STORAGE_KEY = 'hawk_pomodoro'
// A phase that expired this long ago isn't worth a notification when another
// session picks the timer back up; treat it like reopening hours later. Kept
// above a background tab's timer throttling so a late tick still reports.
const STALE_AFTER_MS = 5 * 60_000

export type PomodoroMode = 'focus' | 'break'

export interface Durations {
  focusMs: number
  breakMs: number
}

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
  // Block lengths for the current session, frozen at start so changing the
  // settings doesn't move the goalposts mid-block.
  focusMs: number
  breakMs: number
  // Focus sessions finished in the current shared timer.
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
  focusMs: FOCUS_MS,
  breakMs: BREAK_MS,
  completed: 0,
}

// Current block lengths from the extension settings.
function configuredDurations(): Durations {
  const ext = extensionState(get(preferencesStore).extensions, EXTENSION_ID)
  return {
    focusMs: Math.round(extensionNumber(ext, 'focusMinutes', FOCUS_MS / MINUTE) * MINUTE),
    breakMs: Math.round(extensionNumber(ext, 'breakMinutes', BREAK_MS / MINUTE) * MINUTE),
  }
}

// Whether each new block starts on its own, or waits to be resumed. Read from
// the extension settings at the moment a block ends.
export function autoStarts(): boolean {
  const ext = extensionState(get(preferencesStore).extensions, EXTENSION_ID)
  return extensionSwitch(ext, 'autoStart', true)
}

function chimeSettings(): { sound: string; volume: number } {
  const ext = extensionState(get(preferencesStore).extensions, EXTENSION_ID)
  return {
    sound: extensionChoice(ext, 'chime', 'double'),
    volume: extensionNumber(ext, 'volume', 60),
  }
}

function nextFocusSession(state: PomodoroState, now: number): PomodoroState {
  return {
    ...state,
    mode: 'focus',
    running: true,
    endsAt: now + state.focusMs,
    remainingMs: state.focusMs,
  }
}

// Back to a fresh focus phase, keeping the configured lengths and count.
function idleFrom(state: PomodoroState): PomodoroState {
  return {
    ...IDLE,
    focusMs: state.focusMs,
    breakMs: state.breakMs,
    remainingMs: state.focusMs,
    completed: state.completed,
  }
}

export function phaseMs(state: PomodoroState): number {
  return state.mode === 'focus' ? state.focusMs : state.breakMs
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

// Point an active focus block at a different task without restarting it: the
// clock, phase and completed count stay exactly as they were.
export function retargetSession(state: PomodoroState, target: FocusTarget): PomodoroState {
  return {
    ...state,
    taskId: target.id,
    taskText: target.text,
    dateStr: target.dateStr,
  }
}

export function startSession(
  state: PomodoroState,
  target: FocusTarget,
  now: number,
  durations: Durations,
): PomodoroState {
  return {
    ...state,
    taskId: target.id,
    taskText: target.text,
    dateStr: target.dateStr,
    mode: 'focus',
    running: true,
    endsAt: now + durations.focusMs,
    remainingMs: durations.focusMs,
    focusMs: durations.focusMs,
    breakMs: durations.breakMs,
  }
}

export function pause(state: PomodoroState, now: number): PomodoroState {
  if (!state.running) return state
  return { ...state, running: false, remainingMs: remainingMs(state, now), endsAt: null }
}

export function resume(state: PomodoroState, now: number): PomodoroState {
  if (state.running) return state
  const ms = state.remainingMs > 0 ? state.remainingMs : phaseMs(state)
  return { ...state, running: true, endsAt: now + ms, remainingMs: ms }
}

function breakSession(state: PomodoroState, now: number): PomodoroState {
  return {
    ...state,
    mode: 'break',
    running: true,
    endsAt: now + state.breakMs,
    remainingMs: state.breakMs,
  }
}

// With auto-start off the new phase is parked at full length, paused, so it
// waits for the user instead of running on.
function parked(state: PomodoroState): PomodoroState {
  return { ...state, running: false, endsAt: null, remainingMs: phaseMs(state) }
}

// Move the clock on to `now`. Reports the phase that just ran out, if any.
export function advance(
  state: PomodoroState,
  now: number,
  autoStart = true,
): { state: PomodoroState; finished: PomodoroMode | null } {
  const left = remainingMs(state, now)
  if (!state.running || left > 0) return { state: { ...state, remainingMs: left }, finished: null }
  if (state.mode === 'focus') {
    const next = { ...breakSession(state, now), completed: state.completed + 1 }
    return { state: autoStart ? next : parked(next), finished: 'focus' }
  }
  // Blocks alternate until the timer is stopped: the break hands straight
  // over to the next focus block on the same task.
  const next = nextFocusSession(state, now)
  return { state: autoStart ? next : parked(next), finished: 'break' }
}

// End the current phase early. A skipped focus session isn't counted.
export function skip(state: PomodoroState, now: number): PomodoroState {
  if (state.mode === 'focus') return breakSession(state, now)
  return nextFocusSession(state, now)
}

// ---- persistence ---------------------------------------------------------

function persist(state: PomodoroState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* localStorage unavailable */
  }
}

function parseStored(raw: string | null): PomodoroState | null {
  if (!raw) return null
  try {
    const saved = JSON.parse(raw) as Partial<PomodoroState>
    if (saved.mode !== 'focus' && saved.mode !== 'break') return null
    if (typeof saved.remainingMs !== 'number') return null
    return {
      taskId: typeof saved.taskId === 'string' ? saved.taskId : null,
      taskText: typeof saved.taskText === 'string' ? saved.taskText : '',
      dateStr: typeof saved.dateStr === 'string' ? saved.dateStr : null,
      mode: saved.mode,
      running: saved.running === true && typeof saved.endsAt === 'number',
      endsAt: typeof saved.endsAt === 'number' ? saved.endsAt : null,
      remainingMs: saved.remainingMs,
      focusMs: typeof saved.focusMs === 'number' ? saved.focusMs : FOCUS_MS,
      breakMs: typeof saved.breakMs === 'number' ? saved.breakMs : BREAK_MS,
      completed: typeof saved.completed === 'number' ? saved.completed : 0,
    }
  } catch {
    return null
  }
}

function restore(now: number): PomodoroState {
  try {
    let state = parseStored(localStorage.getItem(STORAGE_KEY))
    if (!state) return IDLE
    // The clock kept running while the tab was closed. A phase that ran out
    // in the meantime is just over — reopening shouldn't dump you into a
    // break that started hours ago.
    if (state.running) {
      const { state: next, finished } = advance(state, now)
      state = finished ? idleFrom(next) : next
    }
    persist(state)
    return state
  } catch {
    return IDLE
  }
}

// One AudioContext for the whole tab: browsers cap how many you can create.
let audioCtx: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      audioCtx = new Ctor()
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    return audioCtx
  } catch {
    return null
  }
}

interface ChimeNote {
  freq: number
  // Seconds after the previous phase ended.
  at: number
  dur: number
  wave: OscillatorType
}

interface Chime {
  // Relative loudness, for tones that should sit further back.
  gain?: number
  notes: ChimeNote[]
}

const CHIMES: Record<string, Chime> = {
  double: {
    notes: [
      { freq: 880, at: 0, dur: 0.4, wave: 'sine' },
      { freq: 660, at: 0.18, dur: 0.45, wave: 'sine' },
    ],
  },
  single: { notes: [{ freq: 880, at: 0, dur: 0.45, wave: 'sine' }] },
  soft: {
    gain: 0.6,
    notes: [
      { freq: 523.25, at: 0, dur: 0.7, wave: 'triangle' },
      { freq: 392, at: 0.22, dur: 0.9, wave: 'triangle' },
    ],
  },
  bell: {
    gain: 0.7,
    notes: [
      { freq: 1046.5, at: 0, dur: 1.1, wave: 'sine' },
      { freq: 2093, at: 0, dur: 0.45, wave: 'sine' },
    ],
  },
  rise: {
    notes: [
      { freq: 523.25, at: 0, dur: 0.3, wave: 'triangle' },
      { freq: 659.25, at: 0.11, dur: 0.3, wave: 'triangle' },
      { freq: 783.99, at: 0.22, dur: 0.35, wave: 'triangle' },
    ],
  },
  knock: {
    gain: 0.8,
    notes: [
      { freq: 320, at: 0, dur: 0.07, wave: 'sine' },
      { freq: 240, at: 0.09, dur: 0.09, wave: 'sine' },
    ],
  },
}

export const CHIME_IDS = Object.keys(CHIMES)

function chime(sound: string, volume: number) {
  const preset = CHIMES[sound]
  if (!preset || volume <= 0) return
  const ctx = audio()
  if (!ctx) return
  const peak = 0.12 * (volume / 100) * (preset.gain ?? 1)
  for (const note of preset.notes) {
    const start = ctx.currentTime + note.at
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = note.wave
    osc.frequency.value = note.freq
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + note.dur + 0.05)
  }
}

// Play the configured sound at the configured volume, for the settings page.
export function previewChime() {
  const settings = chimeSettings()
  chime(settings.sound, settings.volume)
}

// ---- notifications -------------------------------------------------------

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

// The Pomodoro notifications go through a service worker (app/public/sw.js):
// that's the only way to get action buttons, and the only way notifications
// work at all on mobile browsers.
let swRegistration: Promise<ServiceWorkerRegistration | null> | null = null

export function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null)
  }
  if (!swRegistration) {
    swRegistration = navigator.serviceWorker
      .register('/sw.js')
      // `ready` waits until it is active; `showNotification` needs that.
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null)
  }
  return swRegistration
}

// Ask the browser for permission. Only prompts the first time; a blocked
// permission can't be re-requested from here, so say so.
export async function requestNotificationPermission(): Promise<void> {
  if (!notificationsSupported()) return
  // Prompt first, while the click still counts as a user gesture.
  let permission = Notification.permission
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission()
    } catch {
      permission = Notification.permission
    }
  }
  if (permission === 'denied') showToast('Notifications are blocked in your browser')
  if (permission === 'granted') await ensureServiceWorker()
}

// TypeScript's DOM lib dropped `actions` and `renotify`, but browsers that can
// show action buttons still read them.
interface PhaseNotificationOptions extends NotificationOptions {
  actions?: { action: string; title: string }[]
  renotify?: boolean
}

// Copy for the notification that reports a finished block.
function phaseCopy(state: PomodoroState, finished: PomodoroMode) {
  const auto = autoStarts()
  const task = state.taskText ? ` — ${state.taskText}` : ''
  if (finished === 'focus') {
    return {
      title: auto ? 'Break started' : 'Break ready',
      body: auto ? `Time to rest${task}` : `Start your break when you're ready${task}`,
      action: 'Start break',
    }
  }
  return {
    title: auto ? 'Focus started' : 'Focus ready',
    body: auto ? `Back to work${task}` : `Start focusing when you're ready${task}`,
    action: 'Start focus',
  }
}

// Show a system notification whenever a block ends, whether or not the app is
// in focus.
async function notifyPhaseChange(state: PomodoroState, finished: PomodoroMode) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  await showPhaseNotification(state, finished)
}

// Builds and shows the notification. Returns false if the browser refused.
async function showPhaseNotification(state: PomodoroState, finished: PomodoroMode): Promise<boolean> {
  const { title, body, action } = phaseCopy(state, finished)
  const auto = autoStarts()
  const options: PhaseNotificationOptions = {
    body,
    tag: 'hawk-pomodoro',
    // PNG, not the SVG favicon: Chromium can't draw SVG notification icons.
    icon: '/notification-icon.png',
    // Same tag for every block, but still alert when it replaces the old one.
    renotify: true,
    // Let the OS play its notification sound. Browsers can't pick the sound.
    silent: false,
    // With auto-start off the block waits for you, so keep it on screen.
    requireInteraction: !auto,
    actions: auto
      ? [{ action: 'dismiss', title: 'Dismiss' }]
      : [
          { action: 'resume', title: action },
          { action: 'dismiss', title: 'Dismiss' },
        ],
  }
  const registration = await ensureServiceWorker()
  if (registration) {
    try {
      await registration.showNotification(title, options)
      return true
    } catch {
      /* fall back to the page's own notification */
    }
  }
  try {
    const notification = new Notification(title, { body, tag: options.tag, icon: options.icon })
    // Bring the tab forward and show the Journal where the timer lives.
    notification.onclick = () => {
      window.focus()
      showTimer()
      notification.close()
    }
    return true
  } catch {
    /* mobile browsers only have the service worker route */
    return false
  }
}

// Show the end-of-focus notification now, regardless of focus, so the
// browser and OS settings can be checked without waiting for a block to end.
export async function sendTestNotification(): Promise<void> {
  if (!notificationsSupported()) {
    showToast("This browser doesn't support notifications")
    return
  }
  if (Notification.permission !== 'granted') await requestNotificationPermission()
  if (Notification.permission !== 'granted') return
  const state = get(pomodoroStore)
  const shown = await showPhaseNotification(
    { ...state, taskText: state.taskText || 'Test task' },
    'focus',
  )
  showToast(
    shown
      ? "Notification sent. If it didn't appear, check your system's notification settings."
      : "Couldn't show a notification.",
  )
}

// Open the Journal where the timer lives, starting the block if it was waiting.
function showTimer() {
  appStore.setCurrentPage('app')
  appStore.setJournalTab('tasks')
  pomodoroStore.resume()
}

function announce(state: PomodoroState, finished: PomodoroMode) {
  const settings = chimeSettings()
  chime(settings.sound, settings.volume)
  notifyPhaseChange(state, finished)
  const auto = autoStarts()
  if (finished === 'break') {
    showToast(auto ? 'Break over — back to focus' : 'Break over — focus ready')
    return
  }
  const id = state.taskId
  const dateStr = state.dateStr
  const task = id && dateStr
    ? get(logsStore).byDate[dateStr]?.tasks.find((t) => t.id === id)
    : undefined
  const message = auto ? 'Focus done — break time' : 'Focus done — break ready'
  if (task && !task.done) {
    showToast(message, {
      action: 'Mark done',
      duration: 8000,
      onAction: () => logsStore.editTask(dateStr!, id!, { done: true }, { immediate: true }),
    })
    return
  }
  showToast(message)
}

// Ask for notification permission the first time a block is started: the click
// is the user gesture browsers want, and it covers anyone who switched the
// extension on before notifications existed.
function askForNotifications() {
  if (!notificationsSupported() || Notification.permission !== 'default') return
  void requestNotificationPermission()
}

function hasActiveTimer(state: PomodoroState): boolean {
  return state.running || state.taskId !== null || state.mode === 'break'
}

function isPomodoroRecord(value: unknown): value is PomodoroRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<PomodoroRecord>
  return typeof record.rev === 'number' &&
    !!record.state &&
    (record.state.mode === 'focus' || record.state.mode === 'break')
}

function createPomodoroStore() {
  const { subscribe, set } = writable<PomodoroState>(restore(Date.now()))

  // Server revision this local state is based on.
  let rev = 0
  // Session allowed to show notifications for the current block. Assume this
  // one until the server says otherwise, so a timer restored from
  // localStorage still works if the server can't be reached.
  let ownerClientId: string | null = getClientId()
  // Bumped on every local change, so a late server reply can't overwrite a
  // newer action made while it was in flight.
  let localVersion = 0
  let saveChain: Promise<void> = Promise.resolve()
  let loadInFlight: Promise<void> | null = null
  // A sync event can arrive while a fetch is running; make sure a fresh fetch
  // follows the in-flight one instead of reusing its older result.
  let loadAgain = false
  // Bumped by an event that carries a record, so an older GET can't apply
  // after it (relays change the owner without bumping rev).
  let eventSeq = 0
  // Same-browser tabs exchange accepted records directly as well. The sync
  // socket covers devices, but this keeps tabs in step even if their sockets
  // are reconnecting or were given the same origin by a duplicated tab.
  const channel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('hawk-pomodoro')
    : null

  const current = () => get({ subscribe })
  const isNotifier = () => ownerClientId === getClientId()

  function applyState(next: PomodoroState) {
    set(next)
    persist(next)
  }

  function saveInBackground(state: PomodoroState, version: number, claim = false) {
    if (isGuestMode()) return
    saveChain = saveChain.then(async () => {
      try {
        const res = await savePomodoro(state, rev, claim)
        if (res.ok) {
          if (res.data.rev < rev) return
          rev = res.data.rev
          if (version === localVersion) ownerClientId = res.data.ownerClientId
          channel?.postMessage({ payload: res.data })
          return
        }
        // Someone else wrote a newer state. Apply it unless this tab has
        // already moved on to a newer local change.
        if (!res.conflict || res.conflict.rev < rev) return
        rev = res.conflict.rev
        ownerClientId = res.conflict.ownerClientId
        if (version === localVersion) {
          applyState(res.conflict.state)
          catchUp()
        }
      } catch {
        // Offline or signed out: keep the localStorage copy until the next
        // write goes through.
      }
    })
  }

  // `claim` is set only when this session starts a new pomodoro. Other
  // changes keep the notification duty where it is.
  function commit(
    next: PomodoroState,
    finished: PomodoroMode | null = null,
    claim = false,
  ) {
    localVersion += 1
    const version = localVersion
    if (claim || ownerClientId === null) ownerClientId = getClientId()
    applyState(next)
    saveInBackground(next, version, claim)
    if (finished) announce(next, finished)
  }

  function applyRecord(record: PomodoroRecord): boolean {
    // Ignore an out-of-order response; sync events and fetches can overlap.
    if (record.rev < rev) return false
    rev = record.rev
    ownerClientId = record.ownerClientId
    const next = record.state.running && record.state.endsAt !== null
      ? { ...record.state, remainingMs: remainingMs(record.state, Date.now()) }
      : record.state
    applyState(next)
    catchUp()
    return true
  }

  // A session that has just become the notifier for a phase that has already
  // run out moves the block on and reports it, so a quick handover still gets
  // its notification.
  function catchUp() {
    if (!isNotifier()) return
    const state = current()
    if (!state.running || state.endsAt === null) return
    tick()
  }

  function tick() {
    const state = current()
    const now = Date.now()
    if (!state.running || state.endsAt === null) {
      const left = remainingMs(state, now)
      if (left !== state.remainingMs) set({ ...state, remainingMs: left })
      return
    }
    const left = remainingMs(state, now)
    if (left > 0) {
      set({ ...state, remainingMs: left })
      return
    }
    if (!isNotifier()) {
      // Only the notifier moves the block on; everyone else waits for its
      // update and keeps the clock at zero in the meantime.
      if (state.remainingMs !== 0) set({ ...state, remainingMs: 0 })
      return
    }
    // The notifier came back long after the block ended; don't replay a stale
    // break or focus block. Within the grace window it still counts.
    if (state.endsAt !== null && now - state.endsAt > STALE_AFTER_MS) {
      commit(idleFrom(state))
      return
    }
    const { state: next, finished } = advance(state, now, autoStarts())
    if (finished) commit(next, finished)
    else set(next)
  }

  async function loadOnce() {
    const versionAtLoad = localVersion
    const eventAtLoad = eventSeq
    try {
      const record = await getPomodoro()
      // A local action or a newer event landed while the request was in
      // flight; its result (or the event) wins.
      if (localVersion !== versionAtLoad || eventSeq !== eventAtLoad) return
      if (record) {
        applyRecord(record)
        return
      }
      // First shared timer for this account: publish the local one, if any.
      const local = current()
      if (hasActiveTimer(local)) {
        localVersion += 1
        ownerClientId = getClientId()
        saveInBackground(local, localVersion, true)
      }
    } catch {
      // Offline / signed out: keep the localStorage copy.
    }
  }

  function loadFromServer(): Promise<void> {
    if (isGuestMode()) return Promise.resolve()
    if (loadInFlight) {
      loadAgain = true
      return loadInFlight
    }
    loadInFlight = (async () => {
      try {
        await loadOnce()
      } finally {
        loadInFlight = null
        if (loadAgain) {
          loadAgain = false
          void loadFromServer()
        }
      }
    })()
    return loadInFlight
  }

  // A sync event carries the new record, so apply it straight away. Older
  // servers omitted the payload; fall back to a fetch.
  function applySyncEvent(evt: { payload?: unknown }) {
    if (isPomodoroRecord(evt.payload)) {
      if (applyRecord(evt.payload)) eventSeq += 1
      return
    }
    void loadFromServer()
  }

  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      const payload = (event.data as { payload?: unknown } | null)?.payload
      if (isPomodoroRecord(payload)) applySyncEvent({ payload })
    }
  }

  // The demo has no server or sync socket, so tabs share the localStorage copy
  // directly. Storage events fire in the other tabs, not the writer.
  if (typeof window !== 'undefined' && isGuestMode()) {
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return
      const next = parseStored(event.newValue)
      if (!next) return
      set(next)
    })
  }

  return {
    subscribe,
    loadFromServer,
    applySyncEvent,
    // Start on this task, or pause/resume if it's the one already running.
    focusOn(target: FocusTarget) {
      const state = current()
      const now = Date.now()
      if (state.taskId === target.id && state.mode === 'focus') {
        if (!state.running) askForNotifications()
        commit(state.running ? pause(state, now) : resume(state, now))
        return
      }
      askForNotifications()
      // Switching tasks while a focus block is running keeps the clock going;
      // only its label and task change. A paused, idle or break timer still
      // starts a fresh focus.
      if (state.running && state.mode === 'focus') {
        commit(retargetSession(state, target), null, true)
        return
      }
      commit(startSession(state, target, now, configuredDurations()), null, true)
    },
    toggle() {
      const state = current()
      const now = Date.now()
      if (!state.running) askForNotifications()
      commit(state.running ? pause(state, now) : resume(state, now))
    },
    skip() {
      commit(skip(current(), Date.now()))
    },
    stop() {
      const state = current()
      const durations = configuredDurations()
      commit({
        ...IDLE,
        ...durations,
        remainingMs: durations.focusMs,
        completed: state.completed,
      })
    },
    // Bring a parked phase (auto-start off) back to life, from the
    // notification's action or its click.
    resume() {
      const state = current()
      if (state.running || state.taskId === null) return
      commit(resume(state, Date.now()))
    },
    tick,
  }
}

export const pomodoroStore = createPomodoroStore()

// A notification click lands here. The "start" action only starts the block
// that was waiting, leaving the app where it is; clicking the body brings you
// to the timer.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; action?: string } | null
    if (data?.type !== 'hawk-pomodoro') return
    if (data.action === 'resume') pomodoroStore.resume()
    else showTimer()
  })
}

// Same for a click that had to open the app: the worker puts this on the URL.
if (typeof location !== 'undefined') {
  try {
    const params = new URLSearchParams(location.search)
    if (params.get('pomodoro') === 'resume') {
      params.delete('pomodoro')
      const query = params.toString()
      history.replaceState(
        null,
        '',
        `${location.pathname}${query ? `?${query}` : ''}${location.hash}`,
      )
      pomodoroStore.resume()
    }
  } catch {
    /* malformed URL */
  }
}
