import { api, ApiError, apiOrigin, getToken, removeToken, saveToken } from './client'

export type LoginFailReason = 'invalid' | 'rate_limited' | 'network'

export async function login(
  password: string,
): Promise<{ ok: true; token?: string } | { ok: false; reason: LoginFailReason }> {
  try {
    const res = await fetch(apiOrigin() + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.status === 429) return { ok: false, reason: 'rate_limited' }
    if (!res.ok) return { ok: false, reason: 'invalid' }
    const { token } = (await res.json()) as { token?: string }
    if (token) saveToken(token)
    return { ok: true, token }
  } catch (e) {
    console.error('Login failed:', e)
    return { ok: false, reason: 'network' }
  }
}

export async function logout(): Promise<void> {
  try {
    removeToken()
    await fetch(apiOrigin() + '/api/logout', {
      method: 'GET',
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    })
  } catch (e) {
    console.error('Logout failed:', e)
  }
}

export async function authCheck(): Promise<boolean> {
  try {
    const res = await api.get<{ authenticated?: boolean }>('/api/auth-check')
    return res.authenticated === true
  } catch {
    return false
  }
}

// Checks the main password without starting a new session (reveals hidden
// notes). Goes through the API client, so guest mode answers locally.
export async function verifyPassword(password: string): Promise<'ok' | LoginFailReason> {
  try {
    const res = await api.post<{ ok?: boolean }>('/api/verify-password', { password })
    return res.ok === true ? 'ok' : 'invalid'
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) return 'rate_limited'
    if (e instanceof ApiError && e.status === 400) return 'invalid'
    console.error('Password check failed:', e)
    return 'network'
  }
}
