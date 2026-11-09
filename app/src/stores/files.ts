import { writable, get } from 'svelte/store'
import * as filesApi from '../api/files'
import { savingStore } from './saving'
import { showError, showToast } from './toast'
import type { FileMeta } from '../types/models'

export const MAX_FILE_BYTES = 25 * 1024 * 1024

export interface Upload {
  key: string
  name: string
  size: number
  progress: number
  error?: string
}

interface FilesState {
  files: FileMeta[]
  uploads: Upload[]
  loaded: boolean
}

const UNDO_MS = 6000

function createFilesStore() {
  const { subscribe, update } = writable<FilesState>({ files: [], uploads: [], loaded: false })
  // Files hidden while their delete waits out the Undo window.
  const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>()
  const blobUrls = new Map<string, Promise<string>>()

  async function load() {
    try {
      const files = await filesApi.listFiles()
      update((s) => ({ ...s, files: files.filter((f) => !pendingDeletes.has(f.id)), loaded: true }))
    } catch (e) {
      console.error('[files] load failed', e)
      update((s) => ({ ...s, loaded: true }))
    }
  }

  function setUpload(key: string, patch: Partial<Upload> | null) {
    update((s) => ({
      ...s,
      uploads: patch === null
        ? s.uploads.filter((u) => u.key !== key)
        : s.uploads.map((u) => (u.key === key ? { ...u, ...patch } : u)),
    }))
  }

  async function uploadOne(file: File) {
    const key = crypto.randomUUID()
    const name = file.name || `Pasted file ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
    update((s) => ({ ...s, uploads: [...s.uploads, { key, name, size: file.size, progress: 0 }] }))
    if (file.size > MAX_FILE_BYTES) {
      setUpload(key, { error: 'Too large (max 25 MB)' })
      setTimeout(() => setUpload(key, null), 5000)
      return
    }
    savingStore.markPending(`upload:${key}`)
    try {
      const meta = await savingStore.track(
        filesApi.uploadFile(file, name, { onProgress: (p) => setUpload(key, { progress: p }) }),
      )
      update((s) => ({
        ...s,
        files: [meta, ...s.files.filter((f) => f.id !== meta.id)],
        uploads: s.uploads.filter((u) => u.key !== key),
      }))
    } catch (e) {
      console.error('[files] upload failed', e)
      setUpload(key, { error: e instanceof Error ? e.message : 'Upload failed' })
      setTimeout(() => setUpload(key, null), 6000)
    } finally {
      savingStore.clearPending(`upload:${key}`)
    }
  }

  // Uploads run two at a time — enough to overlap latency without starving
  // the connection on mobile.
  async function upload(files: File[]) {
    const queue = [...files]
    const worker = async () => {
      while (queue.length) await uploadOne(queue.shift()!)
    }
    await Promise.all([worker(), worker()])
  }

  async function rename(id: string, name: string) {
    const trimmed = name.trim()
    const cur = get({ subscribe }).files.find((f) => f.id === id)
    if (!cur || !trimmed || trimmed === cur.name) return
    update((s) => ({ ...s, files: s.files.map((f) => (f.id === id ? { ...f, name: trimmed } : f)) }))
    try {
      await savingStore.track(filesApi.renameFile(id, trimmed))
    } catch (e) {
      console.error('[files] rename failed', e)
      update((s) => ({ ...s, files: s.files.map((f) => (f.id === id ? cur : f)) }))
      showError('Couldn’t rename file.')
    }
  }

  function remove(id: string) {
    const original = get({ subscribe }).files
    const file = original.find((f) => f.id === id)
    if (!file) return
    update((s) => ({ ...s, files: s.files.filter((f) => f.id !== id) }))
    const timer = setTimeout(async () => {
      pendingDeletes.delete(id)
      try {
        await savingStore.track(filesApi.deleteFile(id))
        const url = blobUrls.get(id)
        blobUrls.delete(id)
        if (url) URL.revokeObjectURL(await url)
      } catch (e) {
        console.error('[files] delete failed', e)
        showError('Couldn’t delete file.')
        void load()
      }
    }, UNDO_MS)
    pendingDeletes.set(id, timer)
    showToast(`Deleted “${file.name}”`, {
      action: 'Undo',
      duration: UNDO_MS,
      onAction: () => {
        clearTimeout(timer)
        pendingDeletes.delete(id)
        update((s) => ({
          ...s,
          files: [...s.files, file].sort((a, b) => b.createdAt - a.createdAt),
        }))
      },
    })
  }

  // Authenticated object URL for previews/thumbnails; cached per file id.
  function blobUrl(id: string): Promise<string> {
    let p = blobUrls.get(id)
    if (!p) {
      p = filesApi.fetchFileBlob(id).then((b) => URL.createObjectURL(b))
      p.catch(() => blobUrls.delete(id))
      blobUrls.set(id, p)
    }
    return p
  }

  async function download(file: FileMeta) {
    try {
      const url = await blobUrl(file.id)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) {
      console.error('[files] download failed', e)
      showError('Couldn’t download file.')
    }
  }

  function applySyncEvent() {
    if (get({ subscribe }).loaded) void load()
  }

  return { subscribe, load, upload, rename, remove, blobUrl, download, applySyncEvent }
}

export const filesStore = createFilesStore()
