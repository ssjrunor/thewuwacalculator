/*
  Author      : Runor Ewhro
  Description : Wraps the application in global providers and manages
                debounced persistence flushing and global providers.
*/
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { GoogleOAuthProvider as GglOAuthProv } from '@react-oauth/google'
import { useAppStore } from '@/domain/state/store'
import {
  consumePersist,
  saveAppState,
  sbscToDrtyPr,
} from '@/infra/persistence/storage'
import { selectPersisted } from '@/domain/state/serialization'
import {
  applyBgColor,
  applyBgToDoc,
  dtctBgClr,
  dtctBgTxtMod,
  getImmBgUrl,
  readActBgKey,
  readStoredBg,
  resolveBg,
  writeStrdBgC,
} from '@/modules/settings/model/backgroundTheme'
import { applyBodyFon } from '@/modules/settings/model/typography'
import { AppTltpProv } from '@/shared/ui/Tooltip'
import { AppCtxMenuPr } from '@/shared/ui/AppContextMenu'
import { FltnSelCtnsP } from '@/shared/ui/FloatingSelectionActions'
import { getSystTheme } from '@/shared/lib/systemTheme'

interface AppPrvdPrps {
  children: ReactNode
}

const PERSIST_DELAY = 250
const GOOGLE_ID_MISS = 'missing-google-client-id'

export function AppProviders({ children }: AppPrvdPrps) {
  const theme = useAppStore((state) => state.ui.theme)
  const themePref = useAppStore((state) => state.ui.themePreference)
  const bgTextMode = useAppStore((state) => state.ui.backgroundTextMode)
  const setBgTextMod = useAppStore((state) => state.setBgTxtMode)
  const syncThemeWit = useAppStore((state) => state.syncTheme)
  const bodyFontName = useAppStore((state) => state.ui.bodyFontName)
  const bodyFontUrl = useAppStore((state) => state.ui.bodyFontUrl)

  useEffect(() => {
    let persistTimer: number | null = null

    const flush = () => {
      if (persistTimer !== null) {
        window.clearTimeout(persistTimer)
        persistTimer = null
      }

      const dirtyDomains = consumePersist()
      if (dirtyDomains.length > 0) {
        saveAppState(selectPersisted(useAppStore.getState()), { domains: dirtyDomains })
      }
    }

    const schdFlsh = () => {
      if (persistTimer !== null) {
        window.clearTimeout(persistTimer)
      }

      persistTimer = window.setTimeout(flush, PERSIST_DELAY)
    }

    const onVisChng = () => {
      if (document.visibilityState === 'hidden') {
        flush()
      }
    }

    const unsubscribe = sbscToDrtyPr(schdFlsh)

    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisChng)

    return () => {
      flush()
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisChng)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    void applyBodyFon(bodyFontName, bodyFontUrl)
  }, [bodyFontName, bodyFontUrl])

  useEffect(() => {
    if (themePref !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    // keep the resolved ui theme in lockstep with the system while system mode is selected.
    const applySystThe = () => {
      syncThemeWit(getSystTheme())
    }

    applySystThe()
    mediaQuery.addEventListener('change', applySystThe)

    return () => {
      mediaQuery.removeEventListener('change', applySystThe)
    }
  }, [syncThemeWit, themePref])

  useEffect(() => {
    let cancelled = false
    let clnpRslvWllp: (() => void) | null = null
    let skipNextFcs = false
    let lastPpldBgKe: string | null = null

    const applyActBg = async () => {
      if (skipNextFcs) {
        skipNextFcs = false
        return
      }

      const activeKey = useAppStore.getState().ui.backgroundImageKey || readActBgKey()
      if (activeKey && activeKey === lastPpldBgKe) {
        const storedMainColor = readStoredBg()
        if (storedMainColor) {
          applyBgColor(storedMainColor)
        }
        return
      }

      const mmdtWllpUrl = activeKey ? getImmBgUrl(activeKey) : null
      if (mmdtWllpUrl) {
        clnpRslvWllp?.()
        clnpRslvWllp = null
        applyBgToDoc(mmdtWllpUrl)
        lastPpldBgKe = activeKey

        const storedMainColor = readStoredBg()
        if (storedMainColor) {
          applyBgColor(storedMainColor)
        }
        return
      }

      const resolved = await resolveBg(activeKey)
      if (cancelled) {
        resolved.revoke?.()
        return
      }

      clnpRslvWllp?.()
      clnpRslvWllp = resolved.revoke ?? null
      applyBgToDoc(resolved.url)
      lastPpldBgKe = activeKey

      const storedMainColor = readStoredBg()
      if (storedMainColor) {
        applyBgColor(storedMainColor)
      }
    }

    void applyActBg()

    const onFocus = () => {
      void applyActBg()
    }

    const onDcmnClck = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement && target.type === 'file') {
        skipNextFcs = true
      }
    }

    window.addEventListener('focus', onFocus)
    window.addEventListener('popstate', onFocus)
    window.addEventListener('hashchange', onFocus)
    document.addEventListener('click', onDcmnClck, true)

    return () => {
      cancelled = true
      clnpRslvWllp?.()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('popstate', onFocus)
      window.removeEventListener('hashchange', onFocus)
      document.removeEventListener('click', onDcmnClck, true)
    }
  }, [])

  useEffect(() => {
    if (theme !== 'background') {
      return
    }

    let cancelled = false

    const syncBgTextMo = async () => {
      const activeKey = useAppStore.getState().ui.backgroundImageKey || readActBgKey()
      const nextTextMode = await dtctBgTxtMod(activeKey)
      if (!cancelled && nextTextMode !== bgTextMode) {
        setBgTextMod(nextTextMode)
      }

      const storedMainColor = readStoredBg()
      if (storedMainColor) {
        applyBgColor(storedMainColor)
        return
      }

      const nextMainClr = await dtctBgClr(activeKey, nextTextMode)
      if (!cancelled) {
        writeStrdBgC(nextMainClr)
        applyBgColor(nextMainClr)
      }
    }

    void syncBgTextMo()

    return () => {
      cancelled = true
    }
  }, [bgTextMode, setBgTextMod, theme])

  return (
    <GglOAuthProv clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID ?? GOOGLE_ID_MISS}>
      <AppTltpProv>
        <AppCtxMenuPr>
          <FltnSelCtnsP>{children}</FltnSelCtnsP>
        </AppCtxMenuPr>
      </AppTltpProv>
    </GglOAuthProv>
  )
}
