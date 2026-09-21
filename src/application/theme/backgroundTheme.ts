/*
  Author: Runor Ewhro
  Description: Resolves persisted wallpaper references and applies their derived document theme variables.
*/

import { loadMgBlob, saveMgBlob } from '@/application/media/blobImageStore'
import {
  BG_PRESETS,
  DEF_BG_KEY,
  type BgPreset,
} from '@/domain/entities/appearance.ts'

const ACTBGSTOREKE = 'activeBgKey'
const BGCLRSTOREKE = 'user-bg-main-color'

export interface ResolvedBg {
  url: string
  revoke?: () => void
}

const LEGBGCCHPRFX = 'user-upload-bg:'

export function readActiveBgKey(fallback: string = DEF_BG_KEY): string {
  if (typeof window === 'undefined') {
    return fallback
  }

  const raw = window.localStorage.getItem(ACTBGSTOREKE)
  if (!raw) {
    return fallback
  }

  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'string' && parsed ? parsed : fallback
  } catch {
    return raw || fallback
  }
}

export function writeActiveBgKey(key: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(ACTBGSTOREKE, JSON.stringify(key))
}

export function readStoredBg(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(BGCLRSTOREKE)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'string' && parsed ? parsed : null
  } catch {
    return raw || null
  }
}

export function writeStoredBgColor(color: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(BGCLRSTOREKE, JSON.stringify(color))
}

function sntzFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function readMgBrgh(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) {
        resolve(160)
        return
      }

      const width = 64
      const height = Math.max(1, Math.round((image.height / image.width) * width))
      canvas.width = width
      canvas.height = height
      context.drawImage(image, 0, 0, width, height)

      const { data } = context.getImageData(0, 0, width, height)
      let total = 0
      for (let index = 0; index < data.length; index += 4) {
        total += (data[index] + data[index + 1] + data[index + 2]) / 3
      }

      resolve(total / Math.max(1, data.length / 4))
    }
    image.onerror = () => reject(new Error('Failed to analyze background image brightness.'))
    image.src = url
  })
}

function readImgColor(url: string, isDark: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) {
        resolve(isDark ? '#34465c' : '#c9d9f0')
        return
      }

      const width = image.width
      const height = image.height
      canvas.width = width
      canvas.height = height
      context.drawImage(image, 0, 0, width, height)
      const { data } = context.getImageData(0, 0, width, height)

      const colorCount = new Map<string, number>()
      for (let index = 0; index < data.length; index += 40) {
        const red = Math.floor(data[index] / 32) * 32
        const green = Math.floor(data[index + 1] / 32) * 32
        const blue = Math.floor(data[index + 2] / 32) * 32
        const key = `${red},${green},${blue}`
        colorCount.set(key, (colorCount.get(key) ?? 0) + 1)
      }

      let dominant = '192,208,224'
      let maxCount = -1
      for (const [key, count] of colorCount.entries()) {
        if (count > maxCount) {
          dominant = key
          maxCount = count
        }
      }

      let [red, green, blue] = dominant.split(',').map((value) => Number(value))
      const adjustFactor = isDark ? 0.7 : 1.3
      red = Math.min(255, Math.max(0, Math.round(red * adjustFactor)))
      green = Math.min(255, Math.max(0, Math.round(green * adjustFactor)))
      blue = Math.min(255, Math.max(0, Math.round(blue * adjustFactor)))

      const hex = `#${((1 << 24) + (red << 16) + (green << 8) + blue).toString(16).slice(1)}`
      resolve(hex)
    }
    image.onerror = () => reject(new Error('Failed to analyze background image main color.'))
    image.src = url
  })
}

export function getBgPreset(key: string): BgPreset | null {
  return BG_PRESETS.find((preset) => preset.id === key) ?? null
}

export function getImmediateBgUrl(key: string): string | null {
  return getBgPreset(key)?.src ?? null
}

export function isUploadedBgKey(key: string): boolean {
  return key.startsWith('upload:')
}

// Hosted/inline image keys: the key IS the image url (an imgbb link, or a data
// url on localhost). These persist as a short string and need no blob store.
export function isUrlBgKey(key: string): boolean {
  return key.startsWith('http') || key.startsWith('data:')
}

// Either an IndexedDB-backed upload or a hosted-url upload (vs a bundled preset).
export function isCustomBgKey(key: string): boolean {
  return isUploadedBgKey(key) || isUrlBgKey(key)
}

// stores an uploaded wallpaper and returns the persisted key used by the app.
export async function savePlddBgIm(file: File): Promise<string> {
  const key = `upload:${Date.now()}-${sntzFileName(file.name || 'custom-background')}`
  await saveMgBlob(key, file)
  return key
}

// resolves a wallpaper key to either a bundled asset path or an object url.
export async function resolveBg(key: string): Promise<ResolvedBg> {
  const preset = getBgPreset(key)
  if (preset) {
    return { url: preset.src }
  }

  if (isUrlBgKey(key)) {
    return { url: key }
  }

  if (isUploadedBgKey(key)) {
    const blob = await loadMgBlob(key)
    if (blob) {
      const url = URL.createObjectURL(blob)
      return {
        url,
        revoke: () => URL.revokeObjectURL(url),
      }
    }
  }

  return { url: BG_PRESETS[0]?.src ?? '/assets/app/backgrounds/wallpaperflare1.jpg' }
}

function mkLegBgCchKe(source: Blob | string): string {
  if (source instanceof File) {
    return `${LEGBGCCHPRFX}${source.name || 'custom'}`
  }

  return `${LEGBGCCHPRFX}custom`
}

export function applyBgToDocument(url: string) {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement
  // The wallpaper is painted by the .app-wallpaper layer in the shell (which
  // reads this variable) so it can be blurred independently. We deliberately do not set
  // background-image on the root itself, or a sharp copy would show through.
  root.style.setProperty('--background-wallpaper-image', `url("${url}")`)
}

export function applyBgColor(color: string) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.style.setProperty('--bg-main-color', color)
}

export async function switchBg(source: Blob | string, activeKey?: string): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return
  }

  const nextActKey = activeKey ?? mkLegBgCchKe(source)
  writeActiveBgKey(nextActKey)

  let url: string
  if (typeof source === 'string' && (getBgPreset(nextActKey) || isUrlBgKey(nextActKey))) {
    url = source
  } else {
    const blob = source instanceof Blob ? source : await (await fetch(source)).blob()
    if (!(activeKey && isUploadedBgKey(activeKey))) {
      await saveMgBlob(nextActKey, blob)
    }
    url = URL.createObjectURL(blob)
  }

  const image = new Image()
  image.src = url
  await image.decode().catch(() => undefined)

  const fade = document.createElement('div')
  Object.assign(fade.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    zIndex: '0',
    pointerEvents: 'none',
    backgroundImage: `url(${url})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed',
    backgroundRepeat: 'no-repeat',
    opacity: '0',
    transition: 'opacity 0.8s ease-in-out',
    willChange: 'opacity',
  })

  document.body.prepend(fade)

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      fade.style.opacity = '1'
    })

    window.setTimeout(() => {
      applyBgToDocument(url)
      fade.remove()
      resolve()
    }, 800)
  })
}

// picks whether frosted background mode should render dark or light text over the wallpaper.
export async function dtctBgTxtMod(key: string): Promise<'light' | 'dark'> {
  try {
    const resolved = await resolveBg(key)
    const brightness = await readMgBrgh(resolved.url)
    resolved.revoke?.()
    return brightness < 130 ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export async function dtctBgClr(key: string, textMode: 'light' | 'dark'): Promise<string> {
  const resolved = await resolveBg(key)
  try {
    return await readImgColor(resolved.url, textMode === 'dark')
  } finally {
    resolved.revoke?.()
  }
}
