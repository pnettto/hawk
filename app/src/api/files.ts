import { api, apiBase, ApiError, getClientId, getToken, isGuestMode } from './client'
import type { FileMeta } from '../types/models'

export const listFiles = () => api.get<FileMeta[]>('/api/files')

export const renameFile = (id: string, name: string) =>
  api.post<FileMeta>(`/api/files/${id}`, { name })

export const setFilePublic = (id: string, isPublic: boolean) =>
  api.post<FileMeta>(`/api/files/${id}/public`, { isPublic })

export const deleteFile = (id: string) => api.del(`/api/files/${id}`)

export const deleteFiles = (ids: string[]) =>
  api.post<{ deleted: string[] }>('/api/files/delete', { ids })

// XHR rather than fetch so we get upload progress events.
export function uploadFile(
  file: File | Blob,
  name: string,
  opts: { inline?: boolean; onProgress?: (fraction: number) => void } = {},
): Promise<FileMeta> {
  if (isGuestMode()) return Promise.reject(new ApiError(403, 'Uploads aren’t available in the demo'))
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${apiBase()}/api/files${opts.inline ? '?inline=1' : ''}`)
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('X-Client-Id', getClientId())
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(name))
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as FileMeta)
        return
      }
      let msg = `Upload failed (${xhr.status})`
      try {
        msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg
      } catch {
        /* non-JSON body */
      }
      reject(new ApiError(xhr.status, msg))
    }
    xhr.onerror = () => reject(new ApiError(0, 'Network error'))
    xhr.send(file)
  })
}

// Authenticated blob fetch — works in the extension too, where the auth
// cookie isn't sent. Callers own the returned object URL.
export async function fetchFileBlob(id: string): Promise<Blob> {
  const token = getToken()
  const res = await fetch(`${apiBase()}/api/files/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`)
  return await res.blob()
}

// Stable URL for editor-embedded images (served without auth; see files.ts).
export const publicFileUrl = (id: string) =>
  `${apiBase() || location.origin}/api/public/files/${id}`

// Shared-file link: same public route, but always as a download.
export const publicFileDownloadUrl = (id: string) => `${publicFileUrl(id)}?download=1`
