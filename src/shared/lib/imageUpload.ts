/*
  Author: Runor Ewhro
  Description: stores an uploaded image under a chosen persistence mode and
               resolves stored references back to a usable url. Session keeps the
               image only for this load (data url); indexeddb stores the blob
               locally; imgbb hosts it and keeps just the url. A pasted link or a
               hosted url is already a persistable reference and needs no store.
*/

import { saveMgBlob, loadMgBlob } from '@/infra/persistence/blobImageStore'
import type { UploadPersistMode } from '@/domain/entities/preferences'

export type UploadMode = 'session' | UploadPersistMode

export interface StoredImage {
  ref: string
  persisted: boolean
}

export interface ResolvedImage {
  url: string
  revoke?: () => void
}

const IMGBB_ENDPOINT = 'https://api.imgbb.com/1/upload'

// Re-encodes an image so its longest edge is at most maxEdge px, keeping aspect
// ratio. Returns the original file untouched when it's already within bounds, when
// maxEdge is null (keep original), or when decoding fails so the caller always
// gets a usable file. PNGs stay PNG to preserve transparency for cut-out portraits;
// anything else is re-encoded to JPEG.
export async function downscaleImageFile(file: File, maxEdge: number | null): Promise<File> {
  if (maxEdge == null || !Number.isFinite(maxEdge) || maxEdge <= 0) return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  const longest = Math.max(bitmap.width, bitmap.height)
  if (longest <= maxEdge) {
    bitmap.close()
    return file
  }
  const ratio = maxEdge / longest
  const w = Math.round(bitmap.width * ratio)
  const h = Math.round(bitmap.height * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const isPng = file.type === 'image/png'
  const type = isPng ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, isPng ? undefined : 0.92),
  )
  if (!blob) return file
  const name = isPng ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], name, { type })
}

export function fileToDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve(null)
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

// ImgBB wants the raw base64 payload, without the `data:image/...;base64,` prefix.
function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

function sanitizeName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'image'
  )
}

async function uploadToImgbb(file: File, apiKey: string): Promise<string | null> {
  const dataUrl = await fileToDataUrl(file)
  if (!dataUrl) return null
  try {
    const body = new FormData()
    body.append('image', dataUrlToBase64(dataUrl))
    const response = await fetch(`${IMGBB_ENDPOINT}?key=${apiKey}`, { method: 'POST', body })
    if (!response.ok) throw new Error(`ImgBB API error: ${response.status}`)
    const data = await response.json()
    if (data?.success && data.data?.url) return data.data.url as string
    throw new Error('ImgBB upload returned no url')
  } catch (error) {
    console.warn('[imageUpload] imgbb upload failed', error)
    return null
  }
}

// Returns the persistable reference for a file under the chosen mode, or null if
// the file cannot be read. ImgBB without a key (or a failed upload) degrades to a
// non-persisted data url so the image still appears for this session.
export async function storeUploadedImage(
  file: File,
  mode: UploadMode,
  apiKey?: string,
  maxEdge?: number | null,
): Promise<StoredImage | null> {
  const sized = await downscaleImageFile(file, maxEdge ?? null)
  if (mode === 'imgbb') {
    const key = (apiKey || '').trim()
    if (key) {
      const url = await uploadToImgbb(sized, key)
      if (url) return { ref: url, persisted: true }
    }
    const dataUrl = await fileToDataUrl(sized)
    return dataUrl ? { ref: dataUrl, persisted: false } : null
  }

  if (mode === 'indexeddb') {
    const ref = `upload:${Date.now()}-${sanitizeName(sized.name)}`
    await saveMgBlob(ref, sized)
    return { ref, persisted: true }
  }

  const dataUrl = await fileToDataUrl(sized)
  return dataUrl ? { ref: dataUrl, persisted: false } : null
}

// Turns a stored reference into a usable url. IndexedDB refs resolve to an object
// url that the caller must revoke; everything else is already a url.
export async function resolveImageRef(ref: string): Promise<ResolvedImage | null> {
  if (!ref) return null
  if (ref.startsWith('upload:')) {
    const blob = await loadMgBlob(ref)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    return { url, revoke: () => URL.revokeObjectURL(url) }
  }
  return { url: ref }
}
