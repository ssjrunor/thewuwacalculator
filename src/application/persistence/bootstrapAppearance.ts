/*
  Author: Runor Ewhro
  Description: Restores persisted appearance without depending on the main
               application graph or its state initialization.
*/

import type { UiState, ThemeMode } from '@/domain/entities/appState'
import { BG_PRESETS, DEFAULT_BODY_FONT, DEF_BG_KEY } from '@/domain/entities/appearance'
import { BG_THEMES, DARK_THEMES, LIGHT_THEMES } from '@/domain/entities/themes'
import { getSystTheme } from '@/shared/lib/systemTheme'
import { applyDocumentTheme } from '@/application/theme/documentTheme'
import { applyBodyFon, resolveBodyFont } from '@/application/theme/typography'
import { APP_STORAGE_KEY, APPSTOREUIPP } from './storageKeys'

type StoredAppearance = Partial<Pick<UiState,
  | 'theme' | 'themePreference' | 'lightVariant' | 'darkVariant'
  | 'backgroundVariant' | 'backgroundImageKey' | 'backgroundTextMode'
  | 'bodyFontName' | 'bodyFontUrl' | 'blurMode' | 'entranceAnimations'
>>

function readAppearance(): StoredAppearance {
  for (const key of [APPSTOREUIPP, APP_STORAGE_KEY]) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as { ui?: unknown }
      if (parsed?.ui && typeof parsed.ui === 'object') return parsed.ui as StoredAppearance
    } catch {
      // Ignore malformed optional appearance state and continue with defaults.
    }
  }
  return {}
}

function readStoredString(key: string): string | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      return typeof parsed === 'string' && parsed ? parsed : null
    } catch {
      return raw
    }
  } catch {
    return null
  }
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'background'
}

function selectVariant(appearance: StoredAppearance, mode: ThemeMode): string {
  if (mode === 'background') {
    return BG_THEMES.find((variant) => variant === appearance.backgroundVariant) ?? BG_THEMES[0]
  }
  if (mode === 'light') {
    return LIGHT_THEMES.find((variant) => variant === appearance.lightVariant) ?? LIGHT_THEMES[0]
  }
  return DARK_THEMES.find((variant) => variant === appearance.darkVariant) ?? DARK_THEMES[0]
}

export function applyBootstrapAppearance(): string | null {
  const appearance = readAppearance()
  const mode = appearance.themePreference === 'system'
    ? getSystTheme()
    : isThemeMode(appearance.themePreference)
      ? appearance.themePreference
      : isThemeMode(appearance.theme) ? appearance.theme : 'dark'
  const variant = selectVariant(appearance, mode)
  const textMode = mode === 'background'
    ? appearance.backgroundTextMode === 'light' ? 'light' : 'dark'
    : mode
  applyDocumentTheme(variant, textMode, !!appearance.blurMode, appearance.entranceAnimations !== false)
  const root = document.documentElement

  const fontName = typeof appearance.bodyFontName === 'string' ? appearance.bodyFontName : DEFAULT_BODY_FONT
  const fontUrl = typeof appearance.bodyFontUrl === 'string' ? appearance.bodyFontUrl : ''
  root.style.setProperty('--body-font', resolveBodyFont(fontName, fontUrl).fontStack)
  void applyBodyFon(fontName, fontUrl).catch(() => undefined)

  if (mode !== 'background') return null

  const color = readStoredString('user-bg-main-color')
  if (color) root.style.setProperty('--bg-main-color', color)

  const key = (typeof appearance.backgroundImageKey === 'string' && appearance.backgroundImageKey)
    || readStoredString('activeBgKey')
    || DEF_BG_KEY
  const preset = BG_PRESETS.find((entry) => entry.id === key)
  const immediateUrl = preset?.src ?? (/^(https?:|data:)/.test(key) ? key : null)
  if (immediateUrl) {
    root.style.setProperty('--background-wallpaper-image', `url(${JSON.stringify(immediateUrl)})`)
    return null
  }
  return key.startsWith('upload:') ? key : null
}

export async function applyBootstrapUploadedWallpaper(key: string): Promise<void> {
  const { resolveBg, applyBgToDocument } = await import('@/application/theme/backgroundTheme')
  const resolved = await resolveBg(key)
  applyBgToDocument(resolved.url)
  if (resolved.revoke) window.addEventListener('pagehide', resolved.revoke, { once: true })
}
