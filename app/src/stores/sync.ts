import { writable } from 'svelte/store'
import { apiBase, getClientId, getToken } from '../api/client'
import { authStore } from './auth'
import { notesStore } from './notes'
import { logsStore } from './logs'

export type SyncEventType =
  | 'note.saved'
  | 'note.trashed'
  | 'note.restored'
  | 'note.deleted'
  | 'trash.emptied'
  | 'collection.saved'
  | 'collection.deleted'
  | 'log.saved'

export interface SyncEvent {
  id: string
  type: SyncEventType
  ref: string
  cid?: string
  originClientId?: string
  ts: number
}

interface SyncState {
  connected: boolean
}

function createSyncStore() {
  const { subscribe, set } = writable<SyncState>({ connected: false })

  let es: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
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
    if (es) {
      try { es.close() } catch { /* noop */ }
      es = null
    }
    set({ connected: false })
  }

  function start() {
    if (stopped) stopped = false
    if (es) return // already running
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

  function open() {
    teardown()
    const token = getToken()
    if (!token) return // not authenticated yet
    const url = `${apiBase()}/api/sync/stream?token=${encodeURIComponent(
      token,
    )}&clientId=${encodeURIComponent(getClientId())}`

    let source: EventSource
    try {
      source = new EventSource(url)
    } catch (e) {
      console.error('[sync] EventSource construct failed', e)
      scheduleReconnect()
      return
    }
    es = source

    source.addEventListener('hello', () => {
      attempt = 0
      failuresSinceHello = 0
      set({ connected: true })
    })

    source.addEventListener('error', () => {
      // EventSource auto-reconnects, but we want jittered backoff and the
      // ability to give up after repeated failures (e.g. expired token).
      const wasConnected = source.readyState === EventSource.OPEN
      try { source.close() } catch { /* noop */ }
      if (es === source) es = null
      set({ connected: false })

      if (!wasConnected) {
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
    })

    const dispatch = (evt: SyncEvent) => {
      try {
        if (evt.type === 'log.saved') {
          logsStore.applySyncEvent(evt)
        } else {
          notesStore.applySyncEvent(evt)
        }
      } catch (e) {
        console.error('[sync] dispatch failed', evt, e)
      }
    }

    const onMessage = (e: MessageEvent<string>) => {
      try {
        dispatch(JSON.parse(e.data) as SyncEvent)
      } catch (err) {
        console.error('[sync] bad payload', e.data, err)
      }
    }

    const types: SyncEventType[] = [
      'note.saved',
      'note.trashed',
      'note.restored',
      'note.deleted',
      'trash.emptied',
      'collection.saved',
      'collection.deleted',
      'log.saved',
    ]
    for (const t of types) source.addEventListener(t, onMessage as EventListener)
  }

  return { subscribe, start, stop }
}

export const syncStore = createSyncStore()
