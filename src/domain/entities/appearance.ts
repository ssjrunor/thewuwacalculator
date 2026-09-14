/*
  Author: Runor Ewhro
  Description: Defines appearance data contracts and state invariants.
*/

export const SYSTEM_FONT_NAME = 'System UI'
export const SYSTEM_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'
export const WUWA_FONT_NAME = 'Wuthering Waves'
export const WUWA_FONT_STACK = 'var(--wuwa-font)'
export const DEFAULT_BODY_FONT = WUWA_FONT_NAME
export const DEFAULT_FONT_STACK = WUWA_FONT_STACK

export const BODY_FONT_LINKS = {
  Onest: 'https://fonts.googleapis.com/css2?family=Onest:wght@100..900&display=swap',
  Fredoka: 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600&display=swap',
  Quicksand: 'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600&display=swap',
  'Comic Neue': 'https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap',
  Caveat: 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;600&display=swap',
} as const

export const BODY_FONT_PRESETS = [
  WUWA_FONT_NAME,
  SYSTEM_FONT_NAME,
  ...Object.keys(BODY_FONT_LINKS),
] as const

export interface ResolvedBodyFont {
  fontName: string
  fontStack: string
  validLink: boolean
}

export function makeFontStack(fontName: string): string {
  if (fontName === SYSTEM_FONT_NAME) {
    return SYSTEM_FONT_STACK
  }

  if (fontName === WUWA_FONT_NAME) {
    return WUWA_FONT_STACK
  }

  return `'${fontName}', sans-serif`
}

/** The stylesheet a preset font needs loaded, or '' for the bundled ones. */
export function getPresetFontUrl(fontName: string): string {
  if (fontName === SYSTEM_FONT_NAME || fontName === WUWA_FONT_NAME) {
    return ''
  }

  return BODY_FONT_LINKS[fontName as keyof typeof BODY_FONT_LINKS] ?? ''
}

export interface BgPreset {
  id: string
  label: string
  src: string
  preview: string
}

export const BG_PRESETS: BgPreset[] = [
  {
    id: 'builtin:wallpaperflare1.jpg',
    label: 'wallpaper 1',
    src: '/assets/app/backgrounds/wallpaperflare1.jpg',
    preview: 'linear-gradient(135deg, #4f6fa9 0%, #d49bc8 52%, #f4d5b4 100%)',
  },
  {
    id: 'builtin:wallpaperflare2.jpg',
    label: 'wallpaper 2',
    src: '/assets/app/backgrounds/wallpaperflare2.jpg',
    preview: 'linear-gradient(135deg, #34577b 0%, #9fb9d6 48%, #e8d6b5 100%)',
  },
  {
    id: 'builtin:wallpaperflare3.jpg',
    label: 'wallpaper 3',
    src: '/assets/app/backgrounds/wallpaperflare3.jpg',
    preview: 'linear-gradient(135deg, #3a4b2c 0%, #9fb36d 52%, #efe2a1 100%)',
  },
  {
    id: 'builtin:wallpaperflare4.jpg',
    label: 'wallpaper 4',
    src: '/assets/app/backgrounds/wallpaperflare4.jpg',
    preview: 'linear-gradient(135deg, #2d4f65 0%, #7eb5ca 48%, #f0d2a6 100%)',
  },
  {
    id: 'builtin:wallpaperflare5.jpg',
    label: 'wallpaper 5',
    src: '/assets/app/backgrounds/wallpaperflare5.jpg',
    preview: 'linear-gradient(135deg, #3e355d 0%, #8579be 50%, #f2b6a7 100%)',
  },
  {
    id: 'builtin:wallpaperflare6.jpg',
    label: 'wallpaper 6',
    src: '/assets/app/backgrounds/wallpaperflare6.jpg',
    preview: 'linear-gradient(135deg, #61423a 0%, #c47d61 50%, #f0d5a4 100%)',
  },
  {
    id: 'builtin:wallpaperflare7.jpg',
    label: 'wallpaper 7',
    src: '/assets/app/backgrounds/wallpaperflare7.jpg',
    preview: 'linear-gradient(135deg, #3d5468 0%, #7fa1c8 46%, #f3cad1 100%)',
  },
  {
    id: 'builtin:wallpaperflare8.jpg',
    label: 'wallpaper 8',
    src: '/assets/app/backgrounds/wallpaperflare8.jpg',
    preview: 'linear-gradient(135deg, #25484f 0%, #6ab6b0 50%, #dceab5 100%)',
  },
  {
    id: 'builtin:wallpaperflare10.jpg',
    label: 'wallpaper 10',
    src: '/assets/app/backgrounds/wallpaperflare10.jpg',
    preview: 'linear-gradient(135deg, #353763 0%, #7d86d1 52%, #f0d8a4 100%)',
  },
  {
    id: 'builtin:wallpaperflare11.jpg',
    label: 'wallpaper 11',
    src: '/assets/app/backgrounds/wallpaperflare11.jpg',
    preview: 'linear-gradient(135deg, #1e2f48 0%, #516b95 44%, #b4bcd2 72%, #efe3c0 100%)',
  },
  {
    id: 'builtin:wallpaperflare12.jpg',
    label: 'wallpaper 12',
    src: '/assets/app/backgrounds/wallpaperflare12.jpg',
    preview: 'linear-gradient(135deg, #364562 0%, #7d90ba 48%, #d6c1e5 100%)',
  },
  {
    id: 'builtin:augusta-iuno-wuthering-waves-2k-wallpaper-uhdpaper.com-891@5@h.jpg',
    label: 'augusta iuno',
    src: '/assets/app/backgrounds/augusta-iuno-wuthering-waves-2k-wallpaper-uhdpaper.com-891@5@h.jpg',
    preview: 'linear-gradient(135deg, #57607f 0%, #aab3d2 46%, #f1d6b9 100%)',
  },
]

export const DEF_BG_KEY = BG_PRESETS[0]?.id ?? 'builtin:wallpaperflare1.jpg'
