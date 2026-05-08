import { api, apiOrigin, getToken, removeToken, saveToken } from './client'

export async function login(password: string): Promise<{ ok: boolean; token?: string }> {
  try {
    const res = await fetch(apiOrigin() + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!res.ok) return { ok: false }
    const { token } = (await res.json()) as { token?: string }
    if (token) saveToken(token)
    return { ok: true, token }
  } catch (e) {
    console.error('Login failed:', e)
    return { ok: false }
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
    await api.get('/api/auth-check')
    return true
  } catch {
    return false
  }
}
