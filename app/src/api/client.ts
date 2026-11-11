// Typed fetch wrapper. Replaces app-legacy/js/utils/storage.js.
// Same-origin in prod (the Worker serves the SPA), Vite-proxied in dev.
// For non-same-origin contexts (Chrome extension), API_BASE points at the backend.

const TOKEN_KEY = 'hawk_token'
const API_BASE_KEY = 'hawk_api_base'
// Per-tab so each open tab is its own sync subscriber and gets each other's
// edits live. localStorage would coalesce all tabs into one origin.
const CLIENT_ID_KEY = 'hawk_client_id'

// In a Chrome extension, location.origin is `chrome-extension://<id>` so relative
// `/api/...` requests would go nowhere. Fall back to the deployed backend.
const PROD_API_BASE = 'https://hawk.pedro-535.workers.dev'
const isExtension = location.protocol === 'chrome-extension:'

// Resolution order: runtime localStorage override → build-time VITE_API_BASE →
// hardcoded prod URL (extension only) → '' (same-origin web app).
const buildTimeBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
function getApiBase(): string {
  try {
    const override = localStorage.getItem(API_BASE_KEY)
    if (override) return override.replace(/\/$/, '')
  } catch {
    /* localStorage unavailable */
  }
  if (buildTimeBase) return buildTimeBase.replace(/\/$/, '')
  if (isExtension) return PROD_API_BASE
  return ''
}

export const setApiBase = (url: string): void => localStorage.setItem(API_BASE_KEY, url)

// Use this when you need the absolute origin for shareable URLs (Chrome extension
// can't use location.origin since that's chrome-extension://...).
export const apiOrigin = (): string => getApiBase() || location.origin

// Used by stores/sync.ts to build the WebSocket URL.
export const apiBase = (): string => getApiBase()

// Guest mode ("Let me test it"): requests go to the in-browser stand-in in
// guest.ts instead of the server. Remembered so a reload stays in the demo.
const GUEST_KEY = 'hawk_guest'
let guestMode = (() => {
  try {
    return localStorage.getItem(GUEST_KEY) === '1'
  } catch {
    return false
  }
})()
export const isGuestMode = (): boolean => guestMode
export function setGuestMode(on: boolean): void {
  guestMode = on
  try {
    if (on) localStorage.setItem(GUEST_KEY, '1')
    else localStorage.removeItem(GUEST_KEY)
  } catch {
    /* localStorage unavailable */
  }
}

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY)
export const saveToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token)
export const removeToken = (): void => localStorage.removeItem(TOKEN_KEY)

export function getClientId(): string {
  try {
    let id = sessionStorage.getItem(CLIENT_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(CLIENT_ID_KEY, id)
    }
    return id
  } catch {
    // sessionStorage unavailable (rare); fall back to a process-lifetime id.
    return fallbackClientId
  }
}
const fallbackClientId = crypto.randomUUID()

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

// Result of a write that may be rejected because the server holds a newer
// revision than the one the client edited from.
export type ConflictResult<T> =
  | { ok: true; data: T }
  | { ok: false; conflict: T }

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  allowConflict?: boolean
  keepalive?: boolean
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, keepalive } = opts
  if (guestMode) {
    const { guestRequest } = await import('./guest')
    return guestRequest<T>(method, path, body)
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Id': getClientId(),
  }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(getApiBase() + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
    // Lets a save fired from pagehide/beforeunload outlive the page.
    keepalive,
  })

  if (res.status === 401) {
    // Surface to the auth store so the UI can drop into the login overlay.
    const { authStore } = await import('../stores/auth')
    authStore.markUnauthenticated()
    throw new ApiError(401, 'Unauthorized')
  }

  if (res.status === 409 && opts.allowConflict) {
    return { __conflict: true, data: await res.json() } as T
  }

  if (!res.ok) {
    let msg = `Request failed: ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) msg = body.error
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg)
  }

  // Some endpoints return text (e.g. /api/day stores raw JSON strings).
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return (await res.json()) as T
  return (await res.text()) as unknown as T
}

async function postWithConflict<T>(
  path: string,
  body: unknown,
  opts: { keepalive?: boolean } = {},
): Promise<ConflictResult<T>> {
  const res = await request<T | { __conflict: true; data: T }>(path, {
    method: 'POST',
    body,
    allowConflict: true,
    // keepalive bodies are capped at 64 KiB by browsers.
    keepalive: opts.keepalive && JSON.stringify(body).length < 60_000,
  })
  if (res && typeof res === 'object' && '__conflict' in res) {
    return { ok: false, conflict: res.data }
  }
  return { ok: true, data: res as T }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown, opts: { keepalive?: boolean } = {}) =>
    request<T>(path, { method: 'POST', body, keepalive: opts.keepalive }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postWithConflict,
}
