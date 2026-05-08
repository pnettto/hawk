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

  function show(message: string, opts: ToastOpts = {}): () => void {
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

    const dismiss = () => update((list) => list.filter((t) => t.id !== id))
    setTimeout(dismiss, toast.duration)
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
