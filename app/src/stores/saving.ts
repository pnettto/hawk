import { writable, derived } from 'svelte/store'

interface SavingState {
  // Saves currently waiting on a network response.
  inFlight: number
  // Debounced edits typed but not yet flushed (pre-save).
  pending: number
  hasError: boolean
}

function createSavingStore() {
  const { subscribe, update } = writable<SavingState>({
    inFlight: 0,
    pending: 0,
    hasError: false,
  })

  // Set guards against double-mark/double-clear so callers don't have to count.
  const pendingKeys = new Set<string>()

  function markPending(key: string) {
    if (pendingKeys.has(key)) return
    pendingKeys.add(key)
    update((s) => ({ ...s, pending: s.pending + 1 }))
  }

  function clearPending(key: string) {
    if (!pendingKeys.delete(key)) return
    update((s) => ({ ...s, pending: Math.max(0, s.pending - 1) }))
  }

  async function track<T>(promise: Promise<T>): Promise<T> {
    update((s) => ({ ...s, inFlight: s.inFlight + 1, hasError: false }))
    try {
      const result = await promise
      update((s) => ({ ...s, inFlight: Math.max(0, s.inFlight - 1) }))
      return result
    } catch (err) {
      update((s) => ({ ...s, inFlight: Math.max(0, s.inFlight - 1), hasError: true }))
      throw err
    }
  }

  function clearError() {
    update((s) => ({ ...s, hasError: false }))
  }

  return { subscribe, track, markPending, clearPending, clearError }
}

export const savingStore = createSavingStore()

// `isSaving` drives the visual indicator — only network activity, not typing.
export const isSaving = derived(savingStore, (s) => s.inFlight > 0)
// `hasUnsavedWork` drives the beforeunload guard — also blocks if a debounce
// hasn't flushed yet, so a fast reload after typing doesn't lose data.
export const hasUnsavedWork = derived(
  savingStore,
  (s) => s.inFlight > 0 || s.pending > 0,
)
