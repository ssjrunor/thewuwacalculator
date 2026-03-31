/*
  Author      : Runor Ewhro
  Description : Wraps the application in global providers and manages
                persistent state sync with debounced localStorage writes.
*/
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { useAppStore } from '@/domain/state/store'
import { savePersistedAppState } from '@/infra/persistence/storage'
import { selectPersistedState, type PersistedSliceKey } from '@/domain/state/serialization'
import { detectBackgroundTextMode, resolveBackgroundWallpaper } from '@/modules/settings/model/backgroundTheme'
import { applyBodyFontSelection } from '@/modules/settings/model/typography'
import { AppTooltipProvider } from '@/shared/ui/Tooltip'
import type { PersistedAppState } from '@/domain/entities/appState'
import { getSystemThemeMode } from '@/shared/lib/systemTheme'

interface AppProvidersProps {
  children: ReactNode
}

const PERSIST_DEBOUNCE_MS = 250
const GOOGLE_CLIENT_ID_FALLBACK = 'missing-google-client-id'

interface PersistedStateRefs {
  version: PersistedAppState['version']
  ui: PersistedAppState['ui']
  session: PersistedAppState['calculator']['session']
  profiles: PersistedAppState['calculator']['profiles']
  optimizerContext: PersistedAppState['calculator']['optimizerContext']
  suggestionsByResonatorId: PersistedAppState['calculator']['suggestionsByResonatorId']
  inventoryEchoes: PersistedAppState['calculator']['inventoryEchoes']
  inventoryBuilds: PersistedAppState['calculator']['inventoryBuilds']
  inventoryRotations: PersistedAppState['calculator']['inventoryRotations']
  inventoryHydrated: boolean
}

function selectPersistedStateRefs(state: ReturnType<typeof useAppStore.getState>): PersistedStateRefs {
  return {
    version: state.version,
    ui: state.ui,
    session: state.calculator.session,
    profiles: state.calculator.profiles,
    optimizerContext: state.calculator.optimizerContext,
    suggestionsByResonatorId: state.calculator.suggestionsByResonatorId,
    inventoryEchoes: state.calculator.inventoryEchoes,
    inventoryBuilds: state.calculator.inventoryBuilds,
    inventoryRotations: state.calculator.inventoryRotations,
    inventoryHydrated: state.inventoryHydrated,
  }
}

function getChangedPersistedSlices(left: PersistedStateRefs, right: PersistedStateRefs): PersistedSliceKey[] {
  const changed = new Set<PersistedSliceKey>()

  if (
    left.version !== right.version
    || left.ui !== right.ui
    || left.session !== right.session
  ) {
    changed.add('session')
  }

  if (
    left.version !== right.version
    || left.profiles !== right.profiles
    || left.optimizerContext !== right.optimizerContext
    || left.suggestionsByResonatorId !== right.suggestionsByResonatorId
  ) {
    changed.add('profiles')
  }

  if (
    right.inventoryHydrated
    && (
      left.version !== right.version
      || left.inventoryHydrated !== right.inventoryHydrated
      || left.inventoryEchoes !== right.inventoryEchoes
      || left.inventoryBuilds !== right.inventoryBuilds
      || left.inventoryRotations !== right.inventoryRotations
    )
  ) {
    changed.add('inventory')
  }

  return [...changed]
}

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
    let lastSavedRefs = selectPersistedStateRefs(useAppStore.getState())
    let persistTimer: number | null = null

    const flush = () => {
      if (persistTimer !== null) {
        window.clearTimeout(persistTimer)
        persistTimer = null
      }

      const nextRefs = selectPersistedStateRefs(useAppStore.getState())
      const changedSlices = getChangedPersistedSlices(lastSavedRefs, nextRefs)
      if (changedSlices.length > 0) {
        savePersistedAppState(selectPersistedState(useAppStore.getState()), { slices: changedSlices })
        lastSavedRefs = nextRefs
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

    const unsubscribe = useAppStore.subscribe((state) => {
      const nextRefs = selectPersistedStateRefs(state)
      if (getChangedPersistedSlices(lastSavedRefs, nextRefs).length === 0) {
        return
      }

      scheduleFlush()
    })

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
