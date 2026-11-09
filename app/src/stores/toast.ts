import { writable } from 'svelte/store'

export type ToastType = 'info' | 'error'

export interface Toast {
  id: number
  message: string
  type: ToastType
  action?: string
  onAction?: () => void
  duration: number
}

interface ToastOpts {
  type?: ToastType
  action?: string
  onAction?: () => void
  duration?: number
}

function createToastStore() {
  const { subscribe, update } = writable<Toast[]>([])
  let nextId = 1

  // Live timers, so a repeated message refreshes instead of stacking.
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  function show(message: string, opts: ToastOpts = {}): () => void {
    let existing: Toast | undefined
    const unsub = subscribe((list) => (existing = list.find((t) => t.message === message && !t.action && !opts.action)))
    unsub()
    if (existing) {
      const id = existing.id
      const dismiss = () => update((list) => list.filter((t) => t.id !== id))
      clearTimeout(timers.get(id))
      timers.set(id, setTimeout(dismiss, existing.duration))
      return dismiss
    }
    const id = nextId++
    const toast: Toast = {
      id,
      message,
      type: opts.type ?? 'info',
      action: opts.action,
      onAction: opts.onAction,
      duration: opts.duration ?? (opts.type === 'error' ? 5000 : 4000),
    }
    update((list) => [...list, toast])

    const dismiss = () => {
      clearTimeout(timers.get(id))
      timers.delete(id)
      update((list) => list.filter((t) => t.id !== id))
    }
    timers.set(id, setTimeout(dismiss, toast.duration))
    return dismiss
  }

  return {
    subscribe,
    show,
    error: (message: string, opts: ToastOpts = {}) =>
      show(message, { ...opts, type: 'error' }),
    dismiss: (id: number) => update((list) => list.filter((t) => t.id !== id)),
  }
}

export const toastStore = createToastStore()
export const showToast = (msg: string, opts?: ToastOpts) => toastStore.show(msg, opts)
export const showError = (msg: string, opts?: ToastOpts) => toastStore.error(msg, opts)
