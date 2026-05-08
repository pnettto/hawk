import { writable } from 'svelte/store'
import { authCheck, login as apiLogin, logout as apiLogout } from '../api/auth'

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
      const isAuth = await authCheck()
      set({ isAuth, isGuest: false, isCheckingAuth: false })
    },
    async login(password: string): Promise<boolean> {
      const { ok } = await apiLogin(password)
      if (ok) set({ isAuth: true, isGuest: false, isCheckingAuth: false })
      return ok
    },
    enterGuest() {
      // Transient guest mode — read-only browsing, no token saved.
      set({ isAuth: true, isGuest: true, isCheckingAuth: false })
    },
    async logout() {
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
