import type { ThemeMode } from '@/domain/entities/appState'

export type ResolvedSystemThemeMode = Exclude<ThemeMode, 'background'>

// resolve the browser's current light or dark preference with a light fallback outside the browser.
export function getSystemThemeMode(): ResolvedSystemThemeMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
