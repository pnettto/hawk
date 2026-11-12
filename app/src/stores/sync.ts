import { writable } from 'svelte/store'
import { apiBase, getBrowserId, getClientId, getToken } from '../api/client'
import { authStore } from './auth'
import { notesStore } from './notes'
import { logsStore } from './logs'
import { preferencesStore } from './preferences'
import { filesStore } from './files'
import { pomodoroStore } from './pomodoro'

export type SyncEventType =
  | 'note.saved'
  | 'note.trashed'
  | 'note.restored'
  | 'note.deleted'
  | 'trash.emptied'
  | 'log.saved'
  | 'preferences.saved'
  | 'pomodoro.saved'
  | 'files.changed'

export interface SyncEvent {
  id: string
  type: SyncEventType
  ref: string
  originClientId?: string
  ts: number
}

interface SyncState {
  connected: boolean
}

// Keepalive: the server's runtime answers "ping" with "pong" without waking
// the backend. If nothing comes back for a while the socket is dead (sleep,
// network change) even though no close event fired, so we reconnect.
const PING_MS = 30_000
const DEAD_AFTER_MS = 75_000

function syncUrl(token: string): string {
  const base = apiBase() || location.origin
  const url = new URL('/api/sync/ws', base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('token', token)
  url.searchParams.set('clientId', getClientId())
  url.searchParams.set('browserId', getBrowserId())
  return url.toString()
}

function createSyncStore() {
  const { subscribe, set } = writable<SyncState>({ connected: false })

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let stopped = false
  // Backoff: 1s, 2s, 4s, ... cap 30s, with ±25% jitter.
  let attempt = 0
  // Number of consecutive failures with no `hello` since last good connect.
  let failuresSinceHello = 0

  function nextDelay(): number {
    const base = Math.min(30_000, 1000 * 2 ** attempt)
    const jitter = base * 0.25 * (Math.random() * 2 - 1)
    return Math.max(500, base + jitter)
  }

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function teardown() {
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
    if (ws) {
      const old = ws
      ws = null
      old.onopen = old.onmessage = old.onclose = old.onerror = null
      try { old.close() } catch { /* noop */ }
    }
    set({ connected: false })
  }

  function start() {
    if (stopped) stopped = false
    if (ws) return // already running
    open()
  }

  function stop() {
    stopped = true
    clearReconnect()
    teardown()
    attempt = 0
    failuresSinceHello = 0
  }

  function scheduleReconnect() {
    if (stopped) return
    clearReconnect()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (stopped) return
      open()
    }, nextDelay())
    attempt += 1
  }

  const dispatch = (evt: SyncEvent) => {
    try {
      if (evt.type === 'log.saved') {
        logsStore.applySyncEvent(evt)
      } else if (evt.type === 'preferences.saved') {
        preferencesStore.loadFromServer()
      } else if (evt.type === 'pomodoro.saved') {
        pomodoroStore.loadFromServer()
      } else if (evt.type === 'files.changed') {
        filesStore.applySyncEvent()
      } else {
        notesStore.applySyncEvent(evt)
      }
    } catch (e) {
      console.error('[sync] dispatch failed', evt, e)
    }
  }

  function open() {
    teardown()
    const token = getToken()
    if (!token) return // not authenticated yet

    let socket: WebSocket
    try {
      socket = new WebSocket(syncUrl(token))
    } catch (e) {
      console.error('[sync] WebSocket construct failed', e)
      scheduleReconnect()
      return
    }
    ws = socket
    let sawHello = false
    let lastHeard = Date.now()

    socket.onmessage = (e: MessageEvent) => {
      lastHeard = Date.now()
      if (e.data === 'pong') return
      let msg: SyncEvent | { type: 'hello' }
      try {
        msg = JSON.parse(String(e.data))
      } catch (err) {
        console.error('[sync] bad payload', e.data, err)
        return
      }
      if (msg.type === 'hello') {
        sawHello = true
        attempt = 0
        failuresSinceHello = 0
        set({ connected: true })
        // Pomodoro events aren't replayed; catch up on the timer (and its
        // notification owner) after a reconnect.
        void pomodoroStore.loadFromServer()
        return
      }
      dispatch(msg as SyncEvent)
    }

    socket.onopen = () => {
      pingTimer = setInterval(() => {
        if (Date.now() - lastHeard > DEAD_AFTER_MS) {
          // Treat a silent socket like a dropped one.
          socket.onclose?.(new CloseEvent('close'))
          return
        }
        try { socket.send('ping') } catch { /* closing */ }
      }, PING_MS)
    }

    // A rejected handshake (bad token, server down) surfaces as a close
    // without a `hello`. Errors are always followed by a close.
    socket.onclose = () => {
      if (ws !== socket) return
      teardown()
      if (!sawHello) {
        failuresSinceHello += 1
        if (failuresSinceHello >= 3) {
          // Likely an auth problem (or the server is down hard). Bounce the
          // user to the login screen; the auth store will tear us down again.
          authStore.markUnauthenticated()
          stop()
          return
        }
      }
      scheduleReconnect()
    }
  }

  return { subscribe, start, stop }
}

export const syncStore = createSyncStore()
