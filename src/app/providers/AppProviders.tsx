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
import {
  applyBackgroundMainColorToDocument,
  applyBackgroundWallpaperToDocument,
  detectBackgroundMainColor,
  detectBackgroundTextMode,
  getImmediateBackgroundWallpaperUrl,
  readActiveBackgroundKey,
  readStoredBackgroundMainColor,
  resolveBackgroundWallpaper,
  writeStoredBackgroundMainColor,
} from '@/modules/settings/model/backgroundTheme'
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
    let skipNextFocus = false
    let lastAppliedBackgroundKey: string | null = null

    const applyActiveBackground = async () => {
      if (skipNextFocus) {
        skipNextFocus = false
        return
      }

      const activeKey = useAppStore.getState().ui.backgroundImageKey || readActiveBackgroundKey()
      if (activeKey && activeKey === lastAppliedBackgroundKey) {
        const storedMainColor = readStoredBackgroundMainColor()
        if (storedMainColor) {
          applyBackgroundMainColorToDocument(storedMainColor)
        }
        return
      }

      const immediateWallpaperUrl = activeKey ? getImmediateBackgroundWallpaperUrl(activeKey) : null
      if (immediateWallpaperUrl) {
        cleanupResolvedWallpaper?.()
        cleanupResolvedWallpaper = null
        applyBackgroundWallpaperToDocument(immediateWallpaperUrl)
        lastAppliedBackgroundKey = activeKey

        const storedMainColor = readStoredBackgroundMainColor()
        if (storedMainColor) {
          applyBackgroundMainColorToDocument(storedMainColor)
        }
        return
      }

      const resolved = await resolveBackgroundWallpaper(activeKey)
      if (cancelled) {
        resolved.revoke?.()
        return
      }

      cleanupResolvedWallpaper?.()
      cleanupResolvedWallpaper = resolved.revoke ?? null
      applyBackgroundWallpaperToDocument(resolved.url)
      lastAppliedBackgroundKey = activeKey

      const storedMainColor = readStoredBackgroundMainColor()
      if (storedMainColor) {
        applyBackgroundMainColorToDocument(storedMainColor)
      }
    }

    void applyActiveBackground()

    const onFocus = () => {
      void applyActiveBackground()
    }

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement && target.type === 'file') {
        skipNextFocus = true
      }
    }

    window.addEventListener('focus', onFocus)
    window.addEventListener('popstate', onFocus)
    window.addEventListener('hashchange', onFocus)
    document.addEventListener('click', onDocumentClick, true)

    return () => {
      cancelled = true
      cleanupResolvedWallpaper?.()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('popstate', onFocus)
      window.removeEventListener('hashchange', onFocus)
      document.removeEventListener('click', onDocumentClick, true)
    }
  }, [])

  useEffect(() => {
    if (theme !== 'background') {
      return
    }

    let cancelled = false

    const syncBackgroundTextMode = async () => {
      const activeKey = useAppStore.getState().ui.backgroundImageKey || readActiveBackgroundKey()
      const nextTextMode = await detectBackgroundTextMode(activeKey)
      if (!cancelled && nextTextMode !== backgroundTextMode) {
        setBackgroundTextMode(nextTextMode)
      }

      const storedMainColor = readStoredBackgroundMainColor()
      if (storedMainColor) {
        applyBackgroundMainColorToDocument(storedMainColor)
        return
      }

      const nextMainColor = await detectBackgroundMainColor(activeKey, nextTextMode)
      if (!cancelled) {
        writeStoredBackgroundMainColor(nextMainColor)
        applyBackgroundMainColorToDocument(nextMainColor)
      }
    }

    void syncBackgroundTextMode()

    return () => {
      cancelled = true
    }
  }, [backgroundTextMode, setBackgroundTextMode, theme])

  return (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID ?? GOOGLE_CLIENT_ID_FALLBACK}>
      <AppTooltipProvider>{children}</AppTooltipProvider>
    </GoogleOAuthProvider>
  )
}
