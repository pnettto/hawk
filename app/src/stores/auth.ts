import { writable } from 'svelte/store'
import {
  authCheck,
  login as apiLogin,
  logout as apiLogout,
  type LoginFailReason,
} from '../api/auth'
import { isGuestMode, setGuestMode } from '../api/client'

interface AuthState {
  isAuth: boolean
  isGuest: boolean
  isCheckingAuth: boolean
}

function createAuthStore() {
  const { subscribe, set, update } = writable<AuthState>({
    isAuth: false,
    isGuest: false,
    isCheckingAuth: true,
  })

  return {
    subscribe,
    async checkSession() {
      if (isGuestMode()) {
        set({ isAuth: true, isGuest: true, isCheckingAuth: false })
        return
      }
      const isAuth = await authCheck()
      set({ isAuth, isGuest: false, isCheckingAuth: false })
    },
    async login(
      password: string,
    ): Promise<{ ok: true } | { ok: false; reason: LoginFailReason }> {
      const res = await apiLogin(password)
      if (res.ok) {
        setGuestMode(false)
        set({ isAuth: true, isGuest: false, isCheckingAuth: false })
        return { ok: true }
      }
      return res
    },
    enterGuest() {
      // Demo mode: the API is served from localStorage (api/guest.ts).
      // Reload so no stores hold data from a previous session; the flag
      // survives it and checkSession resumes the demo.
      setGuestMode(true)
      location.reload()
    },
    async logout() {
      if (isGuestMode()) {
        // Leaving the demo keeps its data for next time. Reload so demo
        // notes in memory can't be saved to a real account after login.
        setGuestMode(false)
        location.reload()
        return
      }
      // Tear down sync first so an in-flight reconnect doesn't fire a 401 and
      // bounce us back into login mid-logout. Imported lazily to avoid a
      // circular import (sync.ts depends on authStore for unauth signaling).
      const { syncStore } = await import('./sync')
      syncStore.stop()
      await apiLogout()
      set({ isAuth: false, isGuest: false, isCheckingAuth: false })
    },
    markUnauthenticated() {
      // Called by api/client.ts on 401 — kicks the UI back to the login overlay.
      update((s) => ({ ...s, isAuth: false, isGuest: false }))
    },
  }
}

export const authStore = createAuthStore()
