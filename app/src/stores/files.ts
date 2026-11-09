import { writable, get } from 'svelte/store'
import * as filesApi from '../api/files'
import { savingStore } from './saving'
import { showError, showToast } from './toast'
import { confirm } from './confirm'
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

function createFilesStore() {
  const { subscribe, update } = writable<FilesState>({ files: [], uploads: [], loaded: false })
  const blobUrls = new Map<string, Promise<string>>()

  async function load() {
    try {
      const files = await filesApi.listFiles()
      update((s) => ({ ...s, files, loaded: true }))
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

  // Asks first, then deletes for real — no undo window.
  async function remove(ids: string[]): Promise<boolean> {
    const all = get({ subscribe }).files
    const targets = all.filter((f) => ids.includes(f.id))
    if (!targets.length) return false
    const ok = await confirm({
      title: targets.length === 1 ? `Delete “${targets[0].name}”?` : `Delete ${targets.length} files?`,
      message:
        targets.some((f) => f.inline)
          ? 'This can’t be undone. Notes that show these images will show a broken image.'
          : 'This can’t be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return false
    const idSet = new Set(targets.map((f) => f.id))
    update((s) => ({ ...s, files: s.files.filter((f) => !idSet.has(f.id)) }))
    try {
      await savingStore.track(filesApi.deleteFiles([...idSet]))
      for (const id of idSet) {
        const url = blobUrls.get(id)
        blobUrls.delete(id)
        if (url) url.then((u) => URL.revokeObjectURL(u)).catch(() => {})
      }
      showToast(targets.length === 1 ? 'File deleted' : `${targets.length} files deleted`)
      return true
    } catch (e) {
      console.error('[files] delete failed', e)
      showError('Couldn’t delete files.')
      void load()
      return false
    }
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

  function saveBlobUrl(url: string, name: string) {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function download(file: FileMeta) {
    try {
      saveBlobUrl(await blobUrl(file.id), file.name)
    } catch (e) {
      console.error('[files] download failed', e)
      showError('Couldn’t download file.')
    }
  }

  // Several files → one zip (browsers block or nag about a burst of
  // separate downloads). Stored uncompressed: most uploads are already
  // compressed media, and it keeps zipping instant.
  async function downloadMany(files: FileMeta[]) {
    if (files.length === 1) return download(files[0])
    const dismiss = showToast(`Preparing ${files.length} files…`, { duration: 120_000 })
    try {
      const { zip } = await import('fflate')
      const entries: Record<string, Uint8Array> = {}
      const used = new Set<string>()
      for (const f of files) {
        const blob = await (await fetch(await blobUrl(f.id))).blob()
        // Keep names unique inside the archive: "a.png", "a (2).png", …
        let name = f.name
        for (let n = 2; used.has(name.toLowerCase()); n++) {
          const dot = f.name.lastIndexOf('.')
          name = dot > 0 ? `${f.name.slice(0, dot)} (${n})${f.name.slice(dot)}` : `${f.name} (${n})`
        }
        used.add(name.toLowerCase())
        entries[name] = new Uint8Array(await blob.arrayBuffer())
      }
      const data = await new Promise<Uint8Array>((resolve, reject) =>
        zip(entries, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out))),
      )
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/zip' }))
      saveBlobUrl(url, `hawk-files-${new Date().toISOString().slice(0, 10)}.zip`)
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      console.error('[files] zip download failed', e)
      showError('Couldn’t download files.')
    } finally {
      dismiss()
    }
  }

  function applySyncEvent() {
    if (get({ subscribe }).loaded) void load()
  }

  return { subscribe, load, upload, rename, remove, blobUrl, download, downloadMany, applySyncEvent }
}

export const filesStore = createFilesStore()
