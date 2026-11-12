import { writable } from 'svelte/store'

export interface MapPromptRequest {
  title: string
  submitLabel: string
  source: string
  onSave: (source: string) => void
  onCancel?: () => void
}

// One map editor at a time; MapPrompt.svelte (mounted in RichEditor) renders it.
export const mapPromptStore = writable<MapPromptRequest | null>(null)

export function openMapPrompt(request: MapPromptRequest) {
  mapPromptStore.set(request)
}

export function closeMapPrompt() {
  mapPromptStore.set(null)
}
