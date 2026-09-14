/*
  Author: Runor Ewhro
  Description: Defines theme variant constants, grouped theme mappings,
               preview swatches, and shared theme-related types.
*/

export const LIGHT_THEMES = [
  'light',
  'pastel-pink',
  'pastel-blue',
  'vibrant-citrus',
  'glassy-rainbow',
  'sunlit-haze',
] as const

export const DARK_THEMES = [
  'dark',
  'dark-alt',
  'cosmic-rainbow',
  'scarlet-nebula',
  'emerald-forest',
  'graphite-pop',
] as const

export const BG_THEMES = ['frosted-aurora'] as const

// theme variants grouped by mode
export const THEME_BY_MODE = {
  light: LIGHT_THEMES,
  dark: DARK_THEMES,
  background: BG_THEMES,
} as const

// flat list of all theme variants
export const ALL_THEMES = [
  ...LIGHT_THEMES,
  ...DARK_THEMES,
  ...BG_THEMES,
] as const

export type LightThemeVar = (typeof LIGHT_THEMES)[number]
export type DarkThemeVar = (typeof DARK_THEMES)[number]
export type BgThemeVar = (typeof BG_THEMES)[number]
export type ThemeVariant = (typeof ALL_THEMES)[number]

export type BlurMode = boolean

// preview swatches used in theme selection ui
export const THEME_PREVIEW: Record<ThemeVariant, string> = {
  light: '#f9f9f9',
  'pastel-pink': 'linear-gradient(135deg, #ffe4e9 0%, #ffd8e0 100%)',
  'pastel-blue': 'linear-gradient(135deg, #e4f2ff 0%, #d8ebff 100%)',
  'vibrant-citrus': 'linear-gradient(135deg, #fff6ea 0%, #ffe083 55%, #ffb74d 100%)',
  'glassy-rainbow':
      'linear-gradient(135deg, #ff9aa2 0%, #ffd3b6 28%, #fdffb6 50%, #caffbf 72%, #a0c4ff 100%)',
  'sunlit-haze':
      'linear-gradient(135deg, #e8f4fd 0%, #d4ecff 30%, #fef6e4 65%, #fde8c8 100%)',
  dark: '#131922',
  'dark-alt': '#0b0f16',
  'cosmic-rainbow': 'linear-gradient(135deg, #0f1022 0%, #25356e 50%, #5f2a89 100%)',
  'scarlet-nebula': 'linear-gradient(135deg, #16080c 0%, #48131c 55%, #8c1d2d 100%)',
  'emerald-forest': 'linear-gradient(135deg, #021a0e 0%, #0a2f1a 50%, #1a3a2a 100%)',
  'graphite-pop': 'linear-gradient(135deg, #1a1a1a 0%, #333333 50%, #444444 100%)',
  'frosted-aurora':
      'linear-gradient(135deg, rgba(240, 255, 255, 0.55) 0%, rgba(170, 220, 255, 0.45) 100%)',
}
/** The four tokens a theme card needs to paint itself as a small portrait of
 *  the app wearing that theme. Kept here beside THEME_PREVIEW rather than read
 *  off a live element, because the variant classes carry decoration that has no
 *  business inside a card. */
export interface ThemeInk {
  bg: string
  surface: string
  text: string
  accent: string
}

export const THEME_INK: Record<ThemeVariant, ThemeInk> = {
  light: { bg: '#f9f9f9', surface: '#ffffff', text: '#1f2b3f', accent: '#20bfb9' },
  'pastel-pink': { bg: '#ffe4e9', surface: '#ffeef1', text: '#521d2f', accent: '#ff6884' },
  'pastel-blue': { bg: '#e4f2ff', surface: '#eff7ff', text: '#143056', accent: '#338bff' },
  'vibrant-citrus': { bg: '#fff2d7', surface: '#fff8e8', text: '#4d2f12', accent: '#ff5ea8' },
  'glassy-rainbow': { bg: '#ffffff', surface: '#fdfbff', text: '#222222', accent: '#ff00c8' },
  'sunlit-haze': { bg: '#e8f4fd', surface: '#f4faff', text: '#2c3e50', accent: '#c8960c' },
  dark: { bg: '#131922', surface: '#161e2c', text: '#dddddd', accent: '#20bfb9' },
  'dark-alt': { bg: '#000000', surface: '#131417', text: '#dddddd', accent: '#2ab6ab' },
  'cosmic-rainbow': { bg: '#080815', surface: '#0e0a22', text: '#e4e7ff', accent: '#8bdfff' },
  'scarlet-nebula': { bg: '#0f0000', surface: '#1a0708', text: '#ffeaea', accent: '#ff8f84' },
  'emerald-forest': { bg: '#020c08', surface: '#0a1a12', text: '#e0f0e8', accent: '#5eeaaa' },
  'graphite-pop': { bg: '#101010', surface: '#2a2a2a', text: '#e8e8e8', accent: '#f5a742' },
  'frosted-aurora': { bg: '#dbe8f9', surface: 'rgba(255, 255, 255, 0.34)', text: '#001f37', accent: '#2f9fd6' },
}
