/*
  Author      : Runor Ewhro
  Description : Wraps the application in global providers and manages
                debounced persistence flushing and global providers.
*/
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { useAppStore } from '@/domain/state/store'
import {
  consumeDirtyPersistedDomains,
  savePersistedAppState,
  subscribeToDirtyPersistedDomains,
} from '@/infra/persistence/storage'
import { selectPersistedState } from '@/domain/state/serialization'
import { detectBackgroundTextMode, resolveBackgroundWallpaper } from '@/modules/settings/model/backgroundTheme'
import { applyBodyFontSelection } from '@/modules/settings/model/typography'
import { AppTooltipProvider } from '@/shared/ui/Tooltip'
import { getSystemThemeMode } from '@/shared/lib/systemTheme'

interface AppProvidersProps {
  children: ReactNode
}

const PERSIST_DEBOUNCE_MS = 250
const GOOGLE_CLIENT_ID_FALLBACK = 'missing-google-client-id'

export function AppProviders({ children }: AppProvidersProps) {
  const theme = useAppStore((state) => state.ui.theme)
  const themePreference = useAppStore((state) => state.ui.themePreference)
  const backgroundImageKey = useAppStore((state) => state.ui.backgroundImageKey)
  const backgroundTextMode = useAppStore((state) => state.ui.backgroundTextMode)
  const setBackgroundTextMode = useAppStore((state) => state.setBackgroundTextMode)
  const syncThemeWithSystem = useAppStore((state) => state.syncThemeWithSystem)
  const bodyFontName = useAppStore((state) => state.ui.bodyFontName)
  const bodyFontUrl = useAppStore((state) => state.ui.bodyFontUrl)

  useEffect(() => {
    let persistTimer: number | null = null

    const flush = () => {
      if (persistTimer !== null) {
        window.clearTimeout(persistTimer)
        persistTimer = null
      }

      const dirtyDomains = consumeDirtyPersistedDomains()
      if (dirtyDomains.length > 0) {
        savePersistedAppState(selectPersistedState(useAppStore.getState()), { domains: dirtyDomains })
      }
    }

    const scheduleFlush = () => {
      if (persistTimer !== null) {
        window.clearTimeout(persistTimer)
      }

      persistTimer = window.setTimeout(flush, PERSIST_DEBOUNCE_MS)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flush()
      }
    }

    const unsubscribe = subscribeToDirtyPersistedDomains(scheduleFlush)

    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      flush()
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    void applyBodyFontSelection(bodyFontName, bodyFontUrl)
  }, [bodyFontName, bodyFontUrl])

  useEffect(() => {
    if (themePreference !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    // keep the resolved ui theme in lockstep with the system while system mode is selected.
    const applySystemTheme = () => {
      syncThemeWithSystem(getSystemThemeMode())
    }

    applySystemTheme()
    mediaQuery.addEventListener('change', applySystemTheme)

    return () => {
      mediaQuery.removeEventListener('change', applySystemTheme)
    }
  }, [syncThemeWithSystem, themePreference])

  useEffect(() => {
    let cancelled = false
    let cleanupResolvedWallpaper: (() => void) | null = null

    const root = document.documentElement

    const applyBackgroundThemeImage = async () => {
      const resolved = await resolveBackgroundWallpaper(backgroundImageKey)
      if (cancelled) {
        resolved.revoke?.()
        return
      }

      cleanupResolvedWallpaper?.()
      cleanupResolvedWallpaper = resolved.revoke ?? null
      root.style.setProperty('--background-wallpaper-image', `url("${resolved.url}")`)

      if (theme !== 'background') {
        return
      }

      const nextTextMode = await detectBackgroundTextMode(backgroundImageKey)
      if (!cancelled && nextTextMode !== backgroundTextMode) {
        setBackgroundTextMode(nextTextMode)
      }
    }

    void applyBackgroundThemeImage()

    return () => {
      cancelled = true
      cleanupResolvedWallpaper?.()
    }
  }, [backgroundImageKey, backgroundTextMode, setBackgroundTextMode, theme])

  return (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID ?? GOOGLE_CLIENT_ID_FALLBACK}>
      <AppTooltipProvider>{children}</AppTooltipProvider>
    </GoogleOAuthProvider>
  )
}
