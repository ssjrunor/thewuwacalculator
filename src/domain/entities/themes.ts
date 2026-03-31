/*
  Author: Runor Ewhro
  Description: Defines theme variant constants, grouped theme mappings,
               preview swatches, and shared theme-related types.
*/

export const LIGHT_THEME_VARIANTS = [
  'light',
  'pastel-pink',
  'pastel-blue',
  'vibrant-citrus',
  'glassy-rainbow',
  'sunlit-haze',
] as const

export const DARK_THEME_VARIANTS = [
  'dark',
  'dark-alt',
  'cosmic-rainbow',
  'scarlet-nebula',
  'emerald-forest',
  'graphite-pop',
] as const

export const BACKGROUND_THEME_VARIANTS = ['frosted-aurora'] as const

// theme variants grouped by mode
export const THEME_VARIANTS_BY_MODE = {
  light: LIGHT_THEME_VARIANTS,
  dark: DARK_THEME_VARIANTS,
  background: BACKGROUND_THEME_VARIANTS,
} as const

// flat list of all theme variants
export const ALL_THEME_VARIANTS = [
  ...LIGHT_THEME_VARIANTS,
  ...DARK_THEME_VARIANTS,
  ...BACKGROUND_THEME_VARIANTS,
] as const

export type LightThemeVariant = (typeof LIGHT_THEME_VARIANTS)[number]
export type DarkThemeVariant = (typeof DARK_THEME_VARIANTS)[number]
export type BackgroundThemeVariant = (typeof BACKGROUND_THEME_VARIANTS)[number]
export type ThemeVariant = (typeof ALL_THEME_VARIANTS)[number]

export type BlurMode = 'on' | 'off'

// preview swatches used in theme selection ui
export const THEME_PREVIEWS: Record<ThemeVariant, string> = {
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