import { loadImageBlob, saveImageBlob } from '@/infra/persistence/blobImageStore'

export interface BackgroundWallpaperPreset {
  id: string
  label: string
  src: string
}

export interface ResolvedBackgroundWallpaper {
  url: string
  revoke?: () => void
}

export const BACKGROUND_WALLPAPER_PRESETS: BackgroundWallpaperPreset[] = [
  { id: 'builtin:wallpaperflare1.jpg', label: 'wallpaper 1', src: '/assets/backgrounds/wallpaperflare1.jpg' },
  { id: 'builtin:wallpaperflare2.jpg', label: 'wallpaper 2', src: '/assets/backgrounds/wallpaperflare2.jpg' },
  { id: 'builtin:wallpaperflare3.jpg', label: 'wallpaper 3', src: '/assets/backgrounds/wallpaperflare3.jpg' },
  { id: 'builtin:wallpaperflare4.jpg', label: 'wallpaper 4', src: '/assets/backgrounds/wallpaperflare4.jpg' },
  { id: 'builtin:wallpaperflare5.jpg', label: 'wallpaper 5', src: '/assets/backgrounds/wallpaperflare5.jpg' },
  { id: 'builtin:wallpaperflare6.jpg', label: 'wallpaper 6', src: '/assets/backgrounds/wallpaperflare6.jpg' },
  { id: 'builtin:wallpaperflare7.jpg', label: 'wallpaper 7', src: '/assets/backgrounds/wallpaperflare7.jpg' },
  { id: 'builtin:wallpaperflare8.jpg', label: 'wallpaper 8', src: '/assets/backgrounds/wallpaperflare8.jpg' },
  { id: 'builtin:wallpaperflare10.jpg', label: 'wallpaper 10', src: '/assets/backgrounds/wallpaperflare10.jpg' },
  { id: 'builtin:wallpaperflare11.jpg', label: 'wallpaper 11', src: '/assets/backgrounds/wallpaperflare11.jpg' },
  { id: 'builtin:wallpaperflare12.jpg', label: 'wallpaper 12', src: '/assets/backgrounds/wallpaperflare12.jpg' },
  {
    id: 'builtin:augusta-iuno-wuthering-waves-2k-wallpaper-uhdpaper.com-891@5@h.jpg',
    label: 'augusta iuno',
    src: '/assets/backgrounds/augusta-iuno-wuthering-waves-2k-wallpaper-uhdpaper.com-891@5@h.jpg',
  },
]

export const DEFAULT_BACKGROUND_WALLPAPER_KEY = BACKGROUND_WALLPAPER_PRESETS[0]?.id ?? 'builtin:wallpaperflare1.jpg'

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

export function getBackgroundWallpaperPreset(key: string): BackgroundWallpaperPreset | null {
  return BACKGROUND_WALLPAPER_PRESETS.find((preset) => preset.id === key) ?? null
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
