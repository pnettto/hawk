// Typed fetch wrapper. Replaces app-legacy/js/utils/storage.js.
// Same-origin in prod (Hono serves the SPA), Vite-proxied in dev.
// For non-same-origin contexts (Chrome extension), API_BASE points at the backend.

const TOKEN_KEY = 'hawk_token'
const API_BASE_KEY = 'hawk_api_base'
// Per-tab so each open tab is its own SSE subscriber and gets each other's
// edits live. localStorage would coalesce all tabs into one origin.
const CLIENT_ID_KEY = 'hawk_client_id'

// In a Chrome extension, location.origin is `chrome-extension://<id>` so relative
// `/api/...` requests would go nowhere. Fall back to the deployed backend.
const PROD_API_BASE = 'https://hawk.pnettto.deno.net'
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

// Used by stores/sync.ts to build the SSE URL.
export const apiBase = (): string => getApiBase()

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

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = opts
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
  })

  if (res.status === 401) {
    // Surface to the auth store so the UI can drop into the login overlay.
    const { authStore } = await import('../stores/auth')
    authStore.markUnauthenticated()
    throw new ApiError(401, 'Unauthorized')
  }

  if (!res.ok) throw new ApiError(res.status, `Request failed: ${res.status}`)

  // Some endpoints return text (e.g. /api/day stores raw JSON strings).
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return (await res.json()) as T
  return (await res.text()) as unknown as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
