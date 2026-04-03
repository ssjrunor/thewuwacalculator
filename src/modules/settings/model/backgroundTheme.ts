import { loadImageBlob, saveImageBlob } from '@/infra/persistence/blobImageStore'

const ACTIVE_BACKGROUND_STORAGE_KEY = 'activeBgKey'
const BACKGROUND_MAIN_COLOR_STORAGE_KEY = 'user-bg-main-color'

export interface BackgroundWallpaperPreset {
  id: string
  label: string
  src: string
  preview: string
}

export interface ResolvedBackgroundWallpaper {
  url: string
  revoke?: () => void
}

const LEGACY_BACKGROUND_CACHE_PREFIX = 'user-upload-bg:'

export const BACKGROUND_WALLPAPER_PRESETS: BackgroundWallpaperPreset[] = [
  {
    id: 'builtin:wallpaperflare1.jpg',
    label: 'wallpaper 1',
    src: '/assets/backgrounds/wallpaperflare1.jpg',
    preview: 'linear-gradient(135deg, #4f6fa9 0%, #d49bc8 52%, #f4d5b4 100%)',
  },
  {
    id: 'builtin:wallpaperflare2.jpg',
    label: 'wallpaper 2',
    src: '/assets/backgrounds/wallpaperflare2.jpg',
    preview: 'linear-gradient(135deg, #34577b 0%, #9fb9d6 48%, #e8d6b5 100%)',
  },
  {
    id: 'builtin:wallpaperflare3.jpg',
    label: 'wallpaper 3',
    src: '/assets/backgrounds/wallpaperflare3.jpg',
    preview: 'linear-gradient(135deg, #3a4b2c 0%, #9fb36d 52%, #efe2a1 100%)',
  },
  {
    id: 'builtin:wallpaperflare4.jpg',
    label: 'wallpaper 4',
    src: '/assets/backgrounds/wallpaperflare4.jpg',
    preview: 'linear-gradient(135deg, #2d4f65 0%, #7eb5ca 48%, #f0d2a6 100%)',
  },
  {
    id: 'builtin:wallpaperflare5.jpg',
    label: 'wallpaper 5',
    src: '/assets/backgrounds/wallpaperflare5.jpg',
    preview: 'linear-gradient(135deg, #3e355d 0%, #8579be 50%, #f2b6a7 100%)',
  },
  {
    id: 'builtin:wallpaperflare6.jpg',
    label: 'wallpaper 6',
    src: '/assets/backgrounds/wallpaperflare6.jpg',
    preview: 'linear-gradient(135deg, #61423a 0%, #c47d61 50%, #f0d5a4 100%)',
  },
  {
    id: 'builtin:wallpaperflare7.jpg',
    label: 'wallpaper 7',
    src: '/assets/backgrounds/wallpaperflare7.jpg',
    preview: 'linear-gradient(135deg, #3d5468 0%, #7fa1c8 46%, #f3cad1 100%)',
  },
  {
    id: 'builtin:wallpaperflare8.jpg',
    label: 'wallpaper 8',
    src: '/assets/backgrounds/wallpaperflare8.jpg',
    preview: 'linear-gradient(135deg, #25484f 0%, #6ab6b0 50%, #dceab5 100%)',
  },
  {
    id: 'builtin:wallpaperflare10.jpg',
    label: 'wallpaper 10',
    src: '/assets/backgrounds/wallpaperflare10.jpg',
    preview: 'linear-gradient(135deg, #353763 0%, #7d86d1 52%, #f0d8a4 100%)',
  },
  {
    id: 'builtin:wallpaperflare11.jpg',
    label: 'wallpaper 11',
    src: '/assets/backgrounds/wallpaperflare11.jpg',
    preview: 'linear-gradient(135deg, #1e2f48 0%, #516b95 44%, #b4bcd2 72%, #efe3c0 100%)',
  },
  {
    id: 'builtin:wallpaperflare12.jpg',
    label: 'wallpaper 12',
    src: '/assets/backgrounds/wallpaperflare12.jpg',
    preview: 'linear-gradient(135deg, #364562 0%, #7d90ba 48%, #d6c1e5 100%)',
  },
  {
    id: 'builtin:augusta-iuno-wuthering-waves-2k-wallpaper-uhdpaper.com-891@5@h.jpg',
    label: 'augusta iuno',
    src: '/assets/backgrounds/augusta-iuno-wuthering-waves-2k-wallpaper-uhdpaper.com-891@5@h.jpg',
    preview: 'linear-gradient(135deg, #57607f 0%, #aab3d2 46%, #f1d6b9 100%)',
  },
]

export const DEFAULT_BACKGROUND_WALLPAPER_KEY = BACKGROUND_WALLPAPER_PRESETS[0]?.id ?? 'builtin:wallpaperflare1.jpg'

export function readActiveBackgroundKey(fallback: string = DEFAULT_BACKGROUND_WALLPAPER_KEY): string {
  if (typeof window === 'undefined') {
    return fallback
  }

  const raw = window.localStorage.getItem(ACTIVE_BACKGROUND_STORAGE_KEY)
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

export function writeActiveBackgroundKey(key: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(ACTIVE_BACKGROUND_STORAGE_KEY, JSON.stringify(key))
}

export function readStoredBackgroundMainColor(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(BACKGROUND_MAIN_COLOR_STORAGE_KEY)
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

export function writeStoredBackgroundMainColor(color: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(BACKGROUND_MAIN_COLOR_STORAGE_KEY, JSON.stringify(color))
}

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function readImageBrightness(url: string): Promise<number> {
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

function readImageMainColor(url: string, isDark: boolean): Promise<string> {
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

export function getBackgroundWallpaperPreset(key: string): BackgroundWallpaperPreset | null {
  return BACKGROUND_WALLPAPER_PRESETS.find((preset) => preset.id === key) ?? null
}

export function getImmediateBackgroundWallpaperUrl(key: string): string | null {
  return getBackgroundWallpaperPreset(key)?.src ?? null
}

export function isUploadedBackgroundKey(key: string): boolean {
  return key.startsWith('upload:')
}

// stores an uploaded wallpaper and returns the persisted key used by the app.
export async function saveUploadedBackgroundImage(file: File): Promise<string> {
  const key = `upload:${Date.now()}-${sanitizeFileName(file.name || 'custom-background')}`
  await saveImageBlob(key, file)
  return key
}

// resolves a wallpaper key to either a bundled asset path or an object url.
export async function resolveBackgroundWallpaper(key: string): Promise<ResolvedBackgroundWallpaper> {
  const preset = getBackgroundWallpaperPreset(key)
  if (preset) {
    return { url: preset.src }
  }

  if (isUploadedBackgroundKey(key)) {
    const blob = await loadImageBlob(key)
    if (blob) {
      const url = URL.createObjectURL(blob)
      return {
        url,
        revoke: () => URL.revokeObjectURL(url),
      }
    }
  }

  return { url: BACKGROUND_WALLPAPER_PRESETS[0]?.src ?? '/assets/backgrounds/wallpaperflare1.jpg' }
}

function buildLegacyBackgroundCacheKey(source: Blob | string): string {
  if (source instanceof File) {
    return `${LEGACY_BACKGROUND_CACHE_PREFIX}${source.name || 'custom'}`
  }

  return `${LEGACY_BACKGROUND_CACHE_PREFIX}custom`
}

export function applyBackgroundWallpaperToDocument(url: string) {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement
  root.style.setProperty('--background-wallpaper-image', `url("${url}")`)
  root.style.backgroundImage = `url(${url})`
  root.style.backgroundSize = 'cover'
  root.style.backgroundPosition = 'center'
  root.style.backgroundAttachment = 'fixed'
  root.style.backgroundRepeat = 'no-repeat'
}

export function applyBackgroundMainColorToDocument(color: string) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.style.setProperty('--bg-main-color', color)
}

export async function switchBackgroundWallpaper(source: Blob | string, activeKey?: string): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return
  }

  const nextActiveKey = activeKey ?? buildLegacyBackgroundCacheKey(source)
  writeActiveBackgroundKey(nextActiveKey)

  let url: string
  if (typeof source === 'string' && getBackgroundWallpaperPreset(nextActiveKey)) {
    url = source
  } else {
    const blob = source instanceof Blob ? source : await (await fetch(source)).blob()
    if (!(activeKey && isUploadedBackgroundKey(activeKey))) {
      await saveImageBlob(nextActiveKey, blob)
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
      applyBackgroundWallpaperToDocument(url)
      fade.remove()
      resolve()
    }, 800)
  })
}

export async function resolveStoredActiveBackgroundWallpaper(): Promise<ResolvedBackgroundWallpaper> {
  const activeKey = readActiveBackgroundKey('')

  if (activeKey) {
    const blob = await loadImageBlob(activeKey)
    if (blob) {
      const url = URL.createObjectURL(blob)
      return {
        url,
        revoke: () => URL.revokeObjectURL(url),
      }
    }

    return resolveBackgroundWallpaper(activeKey)
  }

  return { url: BACKGROUND_WALLPAPER_PRESETS[0]?.src ?? '/assets/backgrounds/wallpaperflare1.jpg' }
}

// picks whether frosted background mode should render dark or light text over the wallpaper.
export async function detectBackgroundTextMode(key: string): Promise<'light' | 'dark'> {
  try {
    const resolved = await resolveBackgroundWallpaper(key)
    const brightness = await readImageBrightness(resolved.url)
    resolved.revoke?.()
    return brightness < 130 ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export async function detectBackgroundMainColor(key: string, textMode: 'light' | 'dark'): Promise<string> {
  const resolved = await resolveBackgroundWallpaper(key)
  try {
    return await readImageMainColor(resolved.url, textMode === 'dark')
  } finally {
    resolved.revoke?.()
  }
}
