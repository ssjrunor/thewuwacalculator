/*
  Author: Runor Ewhro
  Description: Resolves the browser's active system theme in a way that stays
               safe during server-side or non-browser execution.
*/

import type { ThemeMode } from '@/domain/entities/appState'

export type RslvSystThem = Exclude<ThemeMode, 'background'>

// resolve the browser's current light or dark preference with a light fallback outside the browser.
export function getSystTheme(): RslvSystThem {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
