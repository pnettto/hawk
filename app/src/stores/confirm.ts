import { writable } from 'svelte/store'

export interface ConfirmRequest {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  // Start on the cancel button, so a stray Enter takes the safe way out.
  focusCancel?: boolean
  danger?: boolean
  resolve: (ok: boolean) => void
}

// One dialog at a time; ConfirmDialog.svelte (mounted in App) renders it.
export const confirmStore = writable<ConfirmRequest | null>(null)

export function confirm(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    confirmStore.update((cur) => {
      cur?.resolve(false)
      return { ...opts, resolve }
    })
  })
}
