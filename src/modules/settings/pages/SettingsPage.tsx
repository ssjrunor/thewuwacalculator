/*
  Author: Runor Ewhro
  Description: renders the settings page.
*/

import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, CSSProperties as CssProps } from 'react'
import { useAppStore } from '@/domain/state/store'
import { CnfrMdl } from '@/shared/ui/ConfirmationModal'
import { useCnfr } from '@/app/hooks/useConfirmation.ts'
import { mainPortal } from '@/shared/lib/portalTarget'
import { clrPrssAppSt, parsePersisted, saveAppState, APP_STORAGE_KEY } from '@/infra/persistence/storage'
import { rstrLtstSnap, pldSnapToDrv } from '@/infra/googleDrive/driveSync'
import { importLegacyApp } from '@/domain/services/legacyAppStateImport'
import { selectPersisted } from '@/domain/state/serialization'
import {
  applyBgColor,
  applyBgToDoc,
  BG_PRESETS,
  dtctBgClr,
  dtctBgTxtMod,
  getBgPreset,
  isCustomBgKey,
  resolveBg,
  switchBg,
  writeStrdBgC,
} from '@/modules/settings/model/backgroundTheme'
import { resolveImageRef } from '@/shared/lib/imageUpload.ts'
import type { StoredImage } from '@/shared/lib/imageUpload.ts'
import { useAppModal } from '@/shared/ui/useAppModal'
import { ImageUploadModal } from '@/shared/ui/ImageUploadModal'
import {
  BODYFONTPRST,
  applyBodyFon,
  applyPrvwBod,
  xtrcGglFontF,
  getPrstBodyF,
  SYSTUIFONTNA,
} from '@/modules/settings/model/typography'
import { useGglDrvAut } from '@/app/hooks/useGoogleDriveAuth'
import { DATAXPRTCTNS, mkDataXprtFi, resMprtData } from '@/modules/settings/model/dataManagement'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { toTitle } from '@/shared/lib/format'
import { CllpPageHeyf } from '@/shared/ui/CollapsiblePageHero'
import { LiquidSelect, type SelectOption } from '@/shared/ui/LiquidSelect'
import {
  THEME_PREVIEW,
  THEME_BY_MODE,
  type BgThemeVar,
  type DarkThemeVar,
  type LightThemeVar,
  type ThemeVariant,
} from '@/domain/entities/themes'
import {
  Palette,
  Layers,
  Sparkles,
  Cloud,
  Type,
  Database,
  Download,
  Upload,
  Trash2,
  Archive,
} from 'lucide-react'
import {
  mkPrefGrps,
  PrefSelBrnc,
  ToggleSwitch,
} from '@/modules/settings/model/preferences'

function waitForNextP(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0)
      return
    }

    window.requestAnimationFrame(() => resolve())
  })
}

export function SettingsPage() {
  const ui = useAppStore((state) => state.ui)
  const setTheme = useAppStore((state) => state.setTheme)
  const setThemePref = useAppStore((state) => state.setThemePref)
  const setLghtVar = useAppStore((state) => state.setLightVar)
  const setDarkVar = useAppStore((state) => state.setDarkVar)
  const setBgVar = useAppStore((state) => state.setBgVar)
  const setBgMgKey = useAppStore((state) => state.setBgImgKey)
  const setBgTextMod = useAppStore((state) => state.setBgTxtMode)
  const setBodyFontS = useAppStore((state) => state.setBodyFont)
  const setBlurMode = useAppStore((state) => state.setBlurMode)
  const setNtrnNmtn = useAppStore((state) => state.setEntrAnim)
  const setCtxMenu = useAppStore((state) => state.setCtxMenu)
  const setUpdTst = useAppStore((state) => state.setUpdToast)
  const setRcmmMenuT = useAppStore((state) => state.setRecMenus)
  const setBenchStates = useAppStore((state) => state.setBenchStates)
  const setMaxResInit = useAppStore((state) => state.setMaxResInit)
  const setCmpcInv = useAppStore((state) => state.setCmpInv)
  const setSeeQppd = useAppStore((state) => state.setSeeEqp)
  const setHaveHist = useAppStore((state) => state.setHistOn)
  const setHistMax = useAppStore((state) => state.setHistMax)
  const setUploadPersist = useAppStore((state) => state.setUploadPersist)
  const setImgbbApiKey = useAppStore((state) => state.setImgbbApiKey)
  const bgUploadModal = useAppModal()

  const hydrate = useAppStore((state) => state.hydrate)
  const resetState = useAppStore((state) => state.resetState)
  const ensInvHydr = useAppStore((state) => state.ensInvHydr)
  const showToast = useTstStr((state) => state.show)

  const confirmation = useCnfr()
  const portalTarget = mainPortal()
  const {
    accessToken: gglDrvCcssTk,
    connect: cnncGglDrv,
    disconnect: dscnGglDrv,
    error: gglDrvAuthRr,
    isConfigured: isGglDrvCnfg,
    isConnected: isGglDrvCnnc,
    refresh: rfrsGglDrvCc,
    user: gglDrvUser,
  } = useGglDrvAut()

  const [bckgPrvwUrl, setBckgPrvwU] = useState<string | null>(null)
  const [snapshotJson, setSnpsJson] = useState('')
  const [snpsStts, setSnpsStts] = useState<string | null>(null)
  const [snpsRrr, setSnpsRrr] = useState<string | null>(null)
  const [drftFontName, setDrftFNam] = useState(ui.bodyFontName)
  const [drftFontUrl, setDrftFUrl] = useState(ui.bodyFontUrl)
  const [fontPrvwLdng, setFontPrvwL] = useState(false)
  const [fontLinkVld, setFontLinkV] = useState(true)
  const [cldSyncStts, setCldSyncSt] = useState<string | null>(null)
  const [cldSyncRrr, setCldSyncRr] = useState<string | null>(null)
  const [cldSyncBusyC, setCldSyncBu] = useState<'sync' | 'restore' | null>(null)
  const [lgcyMprtJson, setLgcyMprtJ] = useState('')
  const [lgcyMprtStts, setLgcyMprtS] = useState<string | null>(null)
  const [lgcyMprtRrr, setLgcyMprtR] = useState<string | null>(null)
  const fontChanged =
    drftFontName !== ui.bodyFontName
    || drftFontUrl.trim() !== ui.bodyFontUrl.trim()
  const canApplyFont = drftFontName === SYSTUIFONTNA || fontLinkVld
  const selFontIsPrs = BODYFONTPRST.includes(drftFontName as typeof BODYFONTPRST[number])
  const fontOptions = useMemo<SelectOption<string>[]>(() => {
    const presets = BODYFONTPRST.map((fontName) => ({
      value: fontName,
      label: fontName,
    }))
    return selFontIsPrs
      ? presets
      : [{ value: drftFontName, label: drftFontName }, ...presets]
  }, [drftFontName, selFontIsPrs])
  const prefGrps = mkPrefGrps({
    ui,
    setBlurMode,
    setNtrnAnim: setNtrnNmtn,
    setCtxMenu,
    setPdtTst: setUpdTst,
    setRcmmMenyu: setRcmmMenuT,
    setBenchStates,
    setMaxResInit,
    setHaveHist: setHaveHist,
    setHistMax: setHistMax,
    setCmpcInv: setCmpcInv,
    setSeeQppd: setSeeQppd,
  })

  const mkCurSnapJso = () => {
    // hydrate inventory first so exports always capture the fully realized
    // persisted snapshot instead of a lazily trimmed view.
    useAppStore.getState().ensInvHydr()
    const snapshot = selectPersisted(useAppStore.getState())
    return JSON.stringify(snapshot, null, 2)
  }

  useEffect(() => {
    let cancelled = false
    let rlsPrvw: (() => void) | null = null

    const loadBgPrvw = async () => {
      const resolved = await resolveBg(ui.backgroundImageKey)
      if (cancelled) {
        resolved.revoke?.()
        return
      }

      rlsPrvw?.()
      rlsPrvw = resolved.revoke ?? null
      setBckgPrvwU(resolved.url)
    }

    void loadBgPrvw()

    return () => {
      cancelled = true
      rlsPrvw?.()
    }
  }, [ui.backgroundImageKey])

  useEffect(() => {
    setDrftFNam(ui.bodyFontName)
    setDrftFUrl(ui.bodyFontUrl)
  }, [ui.bodyFontName, ui.bodyFontUrl])

  useEffect(() => {
    let cancelled = false

    const loadPreview = async () => {
      setFontPrvwL(true)
      // preview font loading is intentionally decoupled from persisted apply so
      // users can experiment with links before committing the selection.
      const resolved = await applyPrvwBod(drftFontName, drftFontUrl)
      if (cancelled) {
        return
      }

      setFontLinkV(resolved.validLink)
      setFontPrvwL(false)
    }

    void loadPreview()

    return () => {
      cancelled = true
      void applyPrvwBod(ui.bodyFontName, ui.bodyFontUrl)
    }
  }, [drftFontName, drftFontUrl, ui.bodyFontName, ui.bodyFontUrl])

  const dwnlJsonFile = (raw: string, filename: string) => {
    const blob = new Blob([raw], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const clearAllData = () => {
    clrPrssAppSt()
    resetState()
    window.location.href = '/'
  }

  const onXprtSnap = () => {
    ensInvHydr()
    const raw = mkCurSnapJso()
    const filename = `wwcalc-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
    dwnlJsonFile(raw, filename)

    setSnpsJson(raw)
    setSnpsRrr(null)
    setSnpsStts(`Exported current snapshot to ${filename}.`)
  }

  const onXprtDataBn = (kind: typeof DATAXPRTCTNS[number]['kind']) => {
    try {
      ensInvHydr()
      const result = mkDataXprtFi(useAppStore.getState(), kind)
      dwnlJsonFile(result.raw, result.fileName)
      setSnpsJson(result.raw)
      setSnpsRrr(null)
      setSnpsStts(`Exported ${result.label} to ${result.fileName}.`)
    } catch (error) {
      setSnpsStts(null)
      setSnpsRrr(error instanceof Error ? error.message : 'Data export failed.')
    }
  }

  const onCldSyncTgl = (checked: boolean) => {
    setCldSyncSt(null)
    setCldSyncRr(null)

    if (checked) {
      if (!isGglDrvCnfg) {
        setCldSyncRr('Set VITE_GOOGLE_CLIENT_ID before enabling Google Drive sync.')
        return
      }

      cnncGglDrv()
      return
    }

    dscnGglDrv()
    setCldSyncSt('Disconnected Google Drive sync for this browser.')
  }

  const applyBgSel = async (bgKey: string, source: Blob | string) => {
    setTheme('background')
    setBgMgKey(bgKey)

    // apply the wallpaper first, then recompute text mode and accent color from
    // the resolved image so the theme stays readable after each switch.
    await switchBg(source, bgKey)

    const nextTextMode = await dtctBgTxtMod(bgKey)
    setBgTextMod(nextTextMode)
    const nextMainClr = await dtctBgClr(bgKey, nextTextMode)
    writeStrdBgC(nextMainClr)
    applyBgColor(nextMainClr)
  }

  const onBltnBgSel = async (bgKey: string) => {
    const preset = getBgPreset(bgKey)
    if (!preset) {
      return
    }

    await applyBgSel(bgKey, preset.src)
  }

  const handleBgApply = async (result: StoredImage) => {
    try {
      if (result.persisted) {
        await applyBgSel(result.ref, result.ref)
      } else {
        // session: show it now without persisting the active key.
        const resolved = await resolveImageRef(result.ref)
        if (resolved) applyBgToDoc(resolved.url)
      }
      showToast({ content: 'Applied as the background wallpaper.', variant: 'success' })
    } catch (error) {
      showToast({
        content: error instanceof Error ? error.message : 'Failed to apply background image.',
        variant: 'error',
      })
    }
  }

  const onFontPrstCh = (fontName: string) => {
    setDrftFNam(fontName)
    setDrftFUrl(getPrstBodyF(fontName))
  }

  const onFontUrlChn = (value: string) => {
    setDrftFUrl(value)

    const xtrcFmly = xtrcGglFontF(value)
    if (xtrcFmly) {
      setDrftFNam(xtrcFmly)
      return
    }

    if (!value.trim() && !selFontIsPrs) {
      setDrftFNam(ui.bodyFontName)
    }
  }

  const onApplyTypg = async () => {
    try {
      setFontPrvwL(true)
      const resolved = await applyBodyFon(drftFontName, drftFontUrl)
      const nextFontUrl = drftFontName === SYSTUIFONTNA
        ? ''
        : drftFontUrl.trim()

      setBodyFontS(resolved.fontName, nextFontUrl)
      showToast({
        content: `Applied ${resolved.fontName} as the body font.`,
        variant: 'success',
      })
    } finally {
      setFontPrvwL(false)
    }
  }

  const onSyncToDrv = async () => {
    if (!gglDrvCcssTk) {
      setCldSyncRr('Sign in to Google Drive before uploading a backup.')
      return
    }

    try {
      setCldSyncBu('sync')
      setCldSyncRr(null)
      setCldSyncSt(null)

      const accessToken = await rfrsGglDrvCc()
      if (!accessToken) {
        throw new Error('Google Drive session expired. Sign in again to continue.')
      }

      // Let React paint the busy state before snapshot serialization runs.
      await waitForNextP()
      const raw = mkCurSnapJso()
      const result = await pldSnapToDrv(accessToken, raw)
      setCldSyncSt(`Uploaded ${result.fileName} to Google Drive app data.`)
      showToast({
        content: 'Snapshot uploaded to Google Drive.',
        variant: 'success',
      })
    } catch (error) {
      setCldSyncSt(null)
      setCldSyncRr(error instanceof Error ? error.message : 'Google Drive backup failed.')
    } finally {
      setCldSyncBu(null)
    }
  }

  const onRstrFromDr = async () => {
    if (!gglDrvCcssTk) {
      setCldSyncRr('Sign in to Google Drive before restoring a backup.')
      return
    }

    try {
      setCldSyncBu('restore')
      setCldSyncRr(null)
      setCldSyncSt(null)

      const accessToken = await rfrsGglDrvCc()
      if (!accessToken) {
        throw new Error('Google Drive session expired. Sign in again to continue.')
      }

      const result = await rstrLtstSnap(accessToken)
      if (!result) {
        setCldSyncSt('No Google Drive snapshots were found for this app.')
        return
      }

      // validate and persist the restored snapshot before reporting success so
      // the drive restore message always reflects the actual live app state.
      const snapshot = parsePersisted(result.raw)
      hydrate(snapshot)
      saveAppState(snapshot)
      setSnpsJson(result.raw)
      setSnpsRrr(null)
      setSnpsStts(`Imported snapshot from ${result.fileName}.`)
      setCldSyncSt(`Restored the latest Drive backup from ${result.fileName}.`)
      showToast({
        content: 'Restored the latest Google Drive snapshot.',
        variant: 'success',
      })
    } catch (error) {
      setCldSyncSt(null)
      setCldSyncRr(error instanceof Error ? error.message : 'Google Drive restore failed.')
    } finally {
      setCldSyncBu(null)
    }
  }

  const runSnapMprt = (raw: string) => {
    try {
      const result = resMprtData(raw, useAppStore.getState())
      hydrate(result.snapshot)
      saveAppState(result.snapshot)
      setSnpsRrr(null)
      setSnpsStts(`Imported ${result.label} into the current app state.`)
    } catch (error) {
      setSnpsStts(null)
      setSnpsRrr(error instanceof Error ? error.message : 'Data import failed.')
    }
  }

  const onSnapFileCh = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const raw = await file.text()
    setSnpsJson(raw)
    setSnpsStts(null)
    setSnpsRrr(null)
    event.target.value = ''
  }

  const runLegAppMpr = (raw: string) => {
    try {
      const result = importLegacyApp(raw)
      const hasMprtData =
        result.report.importedProfileIds.length > 0
        || result.report.importedInventoryEchoes > 0
        || result.report.importedInventoryBuilds > 0

      if (!hasMprtData) {
        setLgcyMprtS(null)
        setLgcyMprtR('No valid legacy app-state data was found. Current state was left unchanged.')
        return
      }

      hydrate(result.snapshot)
      saveAppState(result.snapshot)
      setLgcyMprtR(null)
      setLgcyMprtS([
        `Imported ${result.report.importedProfileIds.length} profiles, ${result.report.importedInventoryEchoes} bag echoes, and ${result.report.importedInventoryBuilds} saved builds.`,
        result.report.skippedProfileIds.length > 0
          ? `Skipped ${result.report.skippedProfileIds.length} missing or unsupported profile${result.report.skippedProfileIds.length === 1 ? '' : 's'}.`
          : null,
        result.report.issues.length > 0
          ? `Recorded ${result.report.issues.length} migration note${result.report.issues.length === 1 ? '' : 's'} during conversion.`
          : null,
      ].filter(Boolean).join(' '))
      showToast({
        content: 'Imported legacy v1 backup into the current app state.',
        variant: 'success',
      })
    } catch (error) {
      setLgcyMprtS(null)
      setLgcyMprtR(error instanceof Error ? error.message : 'Legacy app-state import failed.')
    }
  }

  const onLegFileChn = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const raw = await file.text()
    setLgcyMprtJ(raw)
    setLgcyMprtS(null)
    setLgcyMprtR(null)
    event.target.value = ''
  }

  const renderSwatch = (
    variant: ThemeVariant,
    selected: boolean,
    onSelect: () => void,
  ) => {
    const preview = THEME_PREVIEW[variant]

    return (
      <button
        key={variant}
        type="button"
        className={`settings-background-card settings-background-card--theme ${selected ? 'settings-background-card--active' : ''}`}
        onClick={onSelect}
        title={toTitle(variant)}
      >
        <div
          aria-hidden="true"
          className="settings-background-card-preview settings-background-card-preview--theme"
          style={{ '--background-preview': preview } as CssProps}
        />
        <span className="settings-background-card-label">{toTitle(variant)}</span>
      </button>
    )
  }

  return (
    <div className="settings page">
      <CllpPageHeyf
        eyebrow="Configuration"
        title="Settings"
        subtitle="Personalize your workspace, manage themes, and control your data."
        layoutKey="settings-hero"
      />

      <div className="page-content">
        <section className="settings-prefs-panel">
          <div className="tile-header">
            <div className="tile-icon"><Sparkles /></div>
            <div className="tile-header-text">
              <h3>Preferences</h3>
              <p>You know what to do.</p>
            </div>
          </div>

          <div className="settings-prefs-categories">
            {prefGrps.map((group) => (
              <div key={group.title} className="settings-prefs-category">
                <div className="settings-prefs-category-header">
                  <span className="settings-prefs-category-label">{group.title}</span>
                  <span className="settings-prefs-category-desc">{group.description}</span>
                </div>
                <div className="settings-prefs-category-items">
                  {group.items.map((item) => (
                    <div key={item.label} className="settings-pref-item">
                      <ToggleSwitch
                        label={item.label}
                        description={item.description}
                        checked={item.checked}
                        onChange={item.onChange}
                        disabled={item.disabled}
                      />
                      {item.child ? (
                        <PrefSelBrnc item={item.child} open={item.checked} />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        <div className="page-bento">

          <section className="page-tile page-tile--full">
            <div className="tile-header">
              <div className="tile-icon"><Palette /></div>
              <div className="tile-header-text">
                <h3>Appearance</h3>
                <p>Choose your theme mode and visual style</p>
              </div>
            </div>

            <div className="mode-switch">
              {(['system', 'light', 'dark', 'background'] as const).map((option) => (
                  <button
                      key={option}
                      type="button"
                      className={`mode-switch-btn ${ui.themePreference === option ? 'active' : ''}`}
                      onClick={() => {
                        if (option === 'system') {
                          setThemePref('system')
                          return
                        }

                        setTheme(option)
                      }}
                  >
                    {toTitle(option)}
                  </button>
              ))}
            </div>

            {ui.themePreference === 'system' && (
                <div className="settings-data-note">
                  Following your device theme right now: <strong>{toTitle(ui.theme)}</strong>.
                </div>
            )}

            <div className="settings-swatch-section">
              <div className="settings-swatch-label">Light</div>
              <div className="settings-swatch-grid">
                {THEME_BY_MODE.light.map((variant) =>
                    renderSwatch(
                        variant,
                        ui.lightVariant === variant,
                        () => setLghtVar(variant as LightThemeVar),
                    ),
                )}
              </div>
            </div>

            <div className="settings-swatch-section">
              <div className="settings-swatch-label">Dark</div>
              <div className="settings-swatch-grid">
                {THEME_BY_MODE.dark.map((variant) =>
                    renderSwatch(
                        variant,
                        ui.darkVariant === variant,
                        () => setDarkVar(variant as DarkThemeVar),
                    ),
                )}
              </div>
            </div>

            <div className="settings-swatch-section">
              <div className="settings-swatch-label">Background</div>
              <div className="settings-swatch-grid">
                {THEME_BY_MODE.background.map((variant) =>
                    renderSwatch(
                        variant,
                        ui.backgroundVariant === variant,
                        () => setBgVar(variant as BgThemeVar),
                    ),
                )}
              </div>
            </div>

            {ui.theme === 'background' ? (
                <div className="settings-background-panel">
                  <div className="settings-swatch-label">Wallpapers</div>
                  <div className="settings-background-grid">
                    {BG_PRESETS.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            className={`settings-background-card ${ui.backgroundImageKey === preset.id ? 'settings-background-card--active' : ''}`}
                            onClick={() => {
                              void onBltnBgSel(preset.id)
                            }}
                        >
                          <div
                              aria-hidden="true"
                              className="settings-background-card-preview"
                              style={{ '--background-preview': preset.preview } as CssProps}
                          />
                          <span className="settings-background-card-label">{preset.label}</span>
                        </button>
                    ))}
                    {isCustomBgKey(ui.backgroundImageKey) && bckgPrvwUrl ? (
                        <button
                            type="button"
                            className="settings-background-card settings-background-card--active"
                            onClick={() => setTheme('background')}
                        >
                          <img
                              src={bckgPrvwUrl}
                              alt="custom wallpaper"
                              className="settings-background-card-image"
                          />
                          <span className="settings-background-card-label">custom upload</span>
                        </button>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className="settings-dropzone settings-dropzone--compact settings-dropzone--btn"
                    onClick={() => bgUploadModal.show()}
                  >
                    <div className="settings-dropzone-text">
                      <strong>Choose an image</strong> to replace the active wallpaper
                    </div>
                  </button>
                </div>
            ) : null}

            <div className="settings-uploads">
              <div className="settings-uploads-head">
                <span className="settings-uploads-title">Persist uploads</span>
                <span className="settings-uploads-sub">Where uploaded images (wallpaper, showcase cards) are kept</span>
              </div>
              <div className="settings-uploads-modes">
                <button
                  type="button"
                  className="settings-uploads-mode"
                  data-on={ui.preferences.uploadPersist === 'indexeddb' ? 'true' : undefined}
                  onClick={() => setUploadPersist('indexeddb')}
                >
                  <strong>This device</strong>
                  <span>Saved in this browser. Private, persists, this browser only.</span>
                </button>
                <button
                  type="button"
                  className="settings-uploads-mode"
                  data-on={ui.preferences.uploadPersist === 'imgbb' ? 'true' : undefined}
                  onClick={() => setUploadPersist('imgbb')}
                >
                  <strong>ImgBB</strong>
                  <span>Hosted under your key. Persists and works across devices.</span>
                </button>
              </div>
              {ui.preferences.uploadPersist === 'imgbb' ? (
                <label className="settings-uploads-key">
                  <span>ImgBB API key</span>
                  <input
                    type="text"
                    placeholder="Paste your ImgBB key"
                    value={ui.preferences.imgbbApiKey}
                    className="settings-font-input"
                    onChange={(event) => setImgbbApiKey(event.target.value)}
                  />
                  <a href="https://imgbb.com/api" target="_blank" rel="noreferrer">Get a free key →</a>
                </label>
              ) : null}
            </div>
          </section>
           <section className="page-tile page-tile--wide">
              <div className="tile-header">
                <div className="tile-icon"><Type /></div>
                <div className="tile-header-text">
                  <h3>Typography</h3>
                  <p>Customize the body font with presets or a Google Fonts link</p>
                </div>
              </div>

              <div className="settings-font-stack">
                <LiquidSelect
                  className="settings-font-select"
                  value={drftFontName}
                  options={fontOptions}
                  onChange={onFontPrstCh}
                  ariaLabel="Body font preset"
                  prfrPlcm="down"
                />

                <input
                    type="url"
                    className="settings-font-input"
                    value={drftFontUrl}
                    placeholder="https://fonts.googleapis.com/css2?family=Caveat"
                    onChange={(event) => onFontUrlChn(event.target.value)}
                />

                <div className="settings-font-preview">
                  {fontPrvwLdng ? (
                      <span className="settings-font-preview-copy">Loading font preview...</span>
                  ) : canApplyFont ? (
                      <span
                          className="settings-font-preview-copy"
                          style={{ fontFamily: 'var(--preview-font)' }}
                      >
                  ₊✩‧₊˚౨ৎ˚₊✩‧₊ you (yes you) are amazinggg~! ₊✩‧₊˚౨ৎ˚₊✩‧₊
                </span>
                  ) : (
                      <span className="settings-font-preview-copy settings-font-preview-copy--invalid">
                  not a valid google fonts link dude/dudette~!
                </span>
                  )}
                </div>

                <div className="settings-font-meta">
                  <a
                      href="https://fonts.google.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="settings-font-link"
                  >
                    Browse Google Fonts
                  </a>
                  <span className="settings-font-helper">
                Current body font: {ui.bodyFontName}. Paste a `fonts.googleapis.com` URL to use a custom one.
              </span>
                </div>

                <button
                    type="button"
                    className="settings-action-btn"
                    disabled={!fontChanged || !canApplyFont || fontPrvwLdng}
                    onClick={() => {
                      void onApplyTypg()
                    }}
                >
                  Apply Typography
                </button>
              </div>
            </section>

            <section className="page-tile page-tile--narrow">
              <div className="tile-header">
                <div className="tile-icon"><Cloud /></div>
                <div className="tile-header-text">
                  <h3>Cloud Sync</h3>
                  <p>Back up to Google Drive for cross-device access</p>
                </div>
              </div>

              <ToggleSwitch
                  label="Google Drive Sync"
                  description="Sync your builds and inventory"
                  checked={isGglDrvCnnc}
                  onChange={onCldSyncTgl}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
            <span className={`settings-sync-status ${isGglDrvCnnc ? 'settings-sync-status--on' : 'settings-sync-status--off'}`}>
              <span className="settings-sync-dot" />
              {isGglDrvCnnc ? `Connected${gglDrvUser?.email ? ` as ${gglDrvUser.email}` : ''}` : 'Not connected'}
            </span>
                <button
                    type="button"
                    className="settings-action-btn"
                    disabled={!isGglDrvCnnc || cldSyncBusyC !== null}
                    onClick={() => {
                      void onSyncToDrv()
                    }}
                >
                  {cldSyncBusyC === 'sync' ? 'Syncing...' : 'Sync Now'}
                </button>
                <button
                    type="button"
                    className="settings-action-btn"
                    disabled={!isGglDrvCnnc || cldSyncBusyC !== null}
                    onClick={() => confirmation.confirm({
                      title: 'Restore the latest Google Drive backup?',
                      message: 'This will overwrite the current local state with the latest snapshot stored in Google Drive.',
                      confirmLabel: 'Restore backup',
                      cancelLabel: 'Keep local state',
                      variant: 'danger',
                      onConfirm: () => {
                        void onRstrFromDr()
                      },
                    })}
                >
                  {cldSyncBusyC === 'restore' ? 'Restoring...' : 'Restore Latest'}
                </button>
              </div>

              {!isGglDrvCnfg ? (
                  <div className="settings-status settings-status--error" style={{ marginTop: '0.8rem' }}>
                    Google Drive sync needs `VITE_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`.
                  </div>
              ) : null}
              {gglDrvAuthRr && (
                  <div className="settings-status settings-status--error" style={{ marginTop: '0.8rem' }}>
                    {gglDrvAuthRr}
                  </div>
              )}
              {cldSyncStts && (
                  <div className="settings-status settings-status--success" style={{ marginTop: '0.8rem' }}>
                    {cldSyncStts}
                  </div>
              )}
              {cldSyncRrr && (
                  <div className="settings-status settings-status--error" style={{ marginTop: '0.8rem' }}>
                    {cldSyncRrr}
                  </div>
              )}
            </section>

            <section className="page-tile page-tile--full">
              <div className="tile-header">
                <div className="tile-icon"><Database /></div>
                <div className="tile-header-text">
                  <h3>Data Management</h3>
                  <p>Export, import, and manage your workspace data</p>
                </div>
              </div>

              <div className="settings-storage-badge">
                <Layers size={12} />
                Storage key: {APP_STORAGE_KEY}
              </div>

              <div className="settings-data-actions">
                <button type="button" className="settings-action-btn" onClick={onXprtSnap}>
                  <Download /> Export Snapshot
                </button>
                <button
                    type="button"
                    className="settings-action-btn"
                    disabled={!snapshotJson.trim()}
                    onClick={() => runSnapMprt(snapshotJson)}
                >
                  <Upload /> Import Data
                </button>
                <button
                    type="button"
                    className="settings-action-btn settings-action-btn--danger"
                    onClick={() => confirmation.confirm({
                      title: 'Delete all local data? (\u00B0\u2313 \u00B0;)',
                      message: 'This will permanently erase all your saved builds, echoes, rotations, and settings. This cannot be undone. Like for real...',
                      confirmLabel: 'YESSS EVERYTHING!!',
                      cancelLabel: 'I\'ll pass...',
                      variant: 'danger',
                      onConfirm: clearAllData,
                    })}
                >
                  <Trash2 /> Delete All Local Data
                </button>
              </div>

              <div className="settings-data-note">
                Need something smaller than a full snapshot? Export just the slice you want and import it through the same file box below.
              </div>

              <div className="settings-data-actions settings-data-actions--subtle">
                {DATAXPRTCTNS.map((action) => (
                    <button
                        key={action.kind}
                        type="button"
                        className="settings-action-btn settings-action-btn--quiet"
                        onClick={() => onXprtDataBn(action.kind)}
                    >
                      {action.label}
                    </button>
                ))}
              </div>

              <div className="settings-dropzone">
                <input
                    type="file"
                    accept=".json,application/json"
                    onChange={onSnapFileCh}
                />
                <div className="settings-dropzone-text">
                  <strong>Choose a file</strong> or drag and drop snapshot, resonator, inventory, settings, or session JSON
                </div>
              </div>

              <textarea
                  className="settings-textarea"
                  rows={8}
                  value={snapshotJson}
                  onChange={(event) => {
                    setSnpsJson(event.target.value)
                    setSnpsStts(null)
                    setSnpsRrr(null)
                  }}
                  placeholder="Paste a full snapshot or one of the smaller export JSON files here..."
              />

              {snpsStts && (
                  <div className="settings-status settings-status--success">{snpsStts}</div>
              )}
              {snpsRrr && (
                  <div className="settings-status settings-status--error">{snpsRrr}</div>
              )}
            </section>

            <section className="page-tile page-tile--full">
              <div className="tile-header">
                <div className="tile-icon"><Archive /></div>
                <div className="tile-header-text">
                  <h3>Legacy App Import</h3>
                  <p>Import a full v1 backup and convert it into the current persisted app state</p>
                </div>
              </div>

              <div className="settings-legacy-import-stack">
                <div className="settings-dropzone">
                  <input
                      type="file"
                      accept=".json,application/json"
                      onChange={onLegFileChn}
                  />
                  <div className="settings-dropzone-text">
                    <strong>Choose a file</strong> or drag a legacy v1 backup JSON
                  </div>
                </div>

                <div className="settings-data-actions">
                  <button
                      type="button"
                      className="settings-action-btn"
                      disabled={!lgcyMprtJson.trim()}
                      onClick={() => runLegAppMpr(lgcyMprtJson)}
                  >
                    <Upload /> Import Legacy Backup
                  </button>
                </div>

                {lgcyMprtStts && (
                    <div className="settings-status settings-status--success">{lgcyMprtStts}</div>
                )}
                {lgcyMprtRrr && (
                    <div className="settings-status settings-status--error">{lgcyMprtRrr}</div>
                )}

                <textarea
                    className="settings-textarea"
                    rows={6}
                    value={lgcyMprtJson}
                    onChange={(event) => {
                      setLgcyMprtJ(event.target.value)
                      setLgcyMprtS(null)
                      setLgcyMprtR(null)
                    }}
                    placeholder='Paste the v1 "All Data" backup JSON here. The importer will recover profile, inventory, build, and settings data while letting the current app fill in default-only state.'
                />
              </div>
            </section>
        </div>
      </div>

      <CnfrMdl
        visible={confirmation.visible}
        open={confirmation.open}
        closing={confirmation.closing}
        portalTarget={portalTarget}
        title={confirmation.title}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        cancelLabel={confirmation.cancelLabel}
        variant={confirmation.variant}
        onConfirm={confirmation.onConfirm}
        onCancel={confirmation.onCancel}
      />
      <ImageUploadModal
        state={bgUploadModal.dialogProps}
        title="Background image"
        onClose={bgUploadModal.hide}
        onApply={handleBgApply}
      />
    </div>
  )
}
