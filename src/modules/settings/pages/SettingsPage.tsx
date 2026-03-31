import { useEffect, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import { useAppStore } from '@/domain/state/store'
import { ConfirmationModal } from '@/shared/ui/ConfirmationModal'
import { useConfirmation } from '@/app/hooks/useConfirmation.ts'
import { getMainContentPortalTarget } from '@/shared/lib/portalTarget'
import { clearPersistedAppState, parsePersistedAppStateJson, savePersistedAppState, APP_STORAGE_KEY } from '@/infra/persistence/storage'
import { restoreLatestSnapshotFromDrive, uploadSnapshotToDrive } from '@/infra/googleDrive/driveSync'
import { importLegacyAppStateJson } from '@/domain/services/legacyAppStateImport'
import { selectPersistedState } from '@/domain/state/serialization'
import {
  BACKGROUND_WALLPAPER_PRESETS,
  isUploadedBackgroundKey,
  resolveBackgroundWallpaper,
  saveUploadedBackgroundImage,
} from '@/modules/settings/model/backgroundTheme'
import {
  BODY_FONT_PRESETS,
  applyBodyFontSelection,
  applyPreviewBodyFontSelection,
  extractGoogleFontFamily,
  getPresetBodyFontLink,
  SYSTEM_UI_FONT_NAME,
} from '@/modules/settings/model/typography'
import { useGoogleDriveAuth } from '@/app/hooks/useGoogleDriveAuth'
import { DATA_EXPORT_ACTIONS, buildDataExportFile, resolveImportedData } from '@/modules/settings/model/dataManagement'
import { useToastStore } from '@/shared/util/toastStore.ts'
import {
  THEME_PREVIEWS,
  THEME_VARIANTS_BY_MODE,
  type BackgroundThemeVariant,
  type DarkThemeVariant,
  type LightThemeVariant,
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

function toTitle(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function ToggleSwitch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      className="settings-toggle"
      onClick={() => onChange(!checked)}
    >
      <div>
        <div className="settings-toggle-label">{label}</div>
        {description && <div className="settings-toggle-desc">{description}</div>}
      </div>
      <div className={`settings-switch ${checked ? 'settings-switch--on' : ''}`} />
    </button>
  )
}

export function SettingsPage() {
  const ui = useAppStore((state) => state.ui)
  const setTheme = useAppStore((state) => state.setTheme)
  const setThemePreference = useAppStore((state) => state.setThemePreference)
  const setLightVariant = useAppStore((state) => state.setLightVariant)
  const setDarkVariant = useAppStore((state) => state.setDarkVariant)
  const setBackgroundVariant = useAppStore((state) => state.setBackgroundVariant)
  const setBackgroundImageKey = useAppStore((state) => state.setBackgroundImageKey)
  const setBodyFontSelection = useAppStore((state) => state.setBodyFontSelection)
  const setBlurMode = useAppStore((state) => state.setBlurMode)
  const setEntranceAnimations = useAppStore((state) => state.setEntranceAnimations)
  const hydrate = useAppStore((state) => state.hydrate)
  const resetState = useAppStore((state) => state.resetState)
  const ensureInventoryHydrated = useAppStore((state) => state.ensureInventoryHydrated)
  const showToast = useToastStore((state) => state.show)

  const confirmation = useConfirmation()
  const portalTarget = getMainContentPortalTarget()
  const {
    accessToken: googleDriveAccessToken,
    connect: connectGoogleDrive,
    disconnect: disconnectGoogleDrive,
    error: googleDriveAuthError,
    isConfigured: isGoogleDriveConfigured,
    isConnected: isGoogleDriveConnected,
    refresh: refreshGoogleDriveAccessToken,
    user: googleDriveUser,
  } = useGoogleDriveAuth()

  const [autoSnapshotEnabled, setAutoSnapshotEnabled] = useState(true)
  const [backgroundPreviewUrl, setBackgroundPreviewUrl] = useState<string | null>(null)
  const [snapshotJson, setSnapshotJson] = useState('')
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [draftBodyFontName, setDraftBodyFontName] = useState(ui.bodyFontName)
  const [draftBodyFontUrl, setDraftBodyFontUrl] = useState(ui.bodyFontUrl)
  const [fontPreviewLoading, setFontPreviewLoading] = useState(false)
  const [fontLinkValid, setFontLinkValid] = useState(true)
  const [cloudSyncStatus, setCloudSyncStatus] = useState<string | null>(null)
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null)
  const [cloudSyncBusyAction, setCloudSyncBusyAction] = useState<'sync' | 'restore' | null>(null)
  const [legacyImportJson, setLegacyImportJson] = useState('')
  const [legacyImportStatus, setLegacyImportStatus] = useState<string | null>(null)
  const [legacyImportError, setLegacyImportError] = useState<string | null>(null)
  const fontChanged =
    draftBodyFontName !== ui.bodyFontName
    || draftBodyFontUrl.trim() !== ui.bodyFontUrl.trim()
  const canApplyFont = draftBodyFontName === SYSTEM_UI_FONT_NAME || fontLinkValid
  const selectedFontIsPreset = BODY_FONT_PRESETS.includes(draftBodyFontName as typeof BODY_FONT_PRESETS[number])

  const buildCurrentSnapshotJson = () => {
    useAppStore.getState().ensureInventoryHydrated()
    const snapshot = selectPersistedState(useAppStore.getState())
    return JSON.stringify(snapshot, null, 2)
  }

  useEffect(() => {
    let cancelled = false
    let releasePreview: (() => void) | null = null

    const loadBackgroundPreview = async () => {
      const resolved = await resolveBackgroundWallpaper(ui.backgroundImageKey)
      if (cancelled) {
        resolved.revoke?.()
        return
      }

      releasePreview?.()
      releasePreview = resolved.revoke ?? null
      setBackgroundPreviewUrl(resolved.url)
    }

    void loadBackgroundPreview()

    return () => {
      cancelled = true
      releasePreview?.()
    }
  }, [ui.backgroundImageKey])

  useEffect(() => {
    setDraftBodyFontName(ui.bodyFontName)
    setDraftBodyFontUrl(ui.bodyFontUrl)
  }, [ui.bodyFontName, ui.bodyFontUrl])

  useEffect(() => {
    let cancelled = false

    const loadPreview = async () => {
      setFontPreviewLoading(true)
      const resolved = await applyPreviewBodyFontSelection(draftBodyFontName, draftBodyFontUrl)
      if (cancelled) {
        return
      }

      setFontLinkValid(resolved.validLink)
      setFontPreviewLoading(false)
    }

    void loadPreview()

    return () => {
      cancelled = true
      void applyPreviewBodyFontSelection(ui.bodyFontName, ui.bodyFontUrl)
    }
  }, [draftBodyFontName, draftBodyFontUrl, ui.bodyFontName, ui.bodyFontUrl])

  const downloadJsonFile = (raw: string, filename: string) => {
    const blob = new Blob([raw], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const clearAllData = () => {
    clearPersistedAppState()
    resetState()
    window.location.href = '/'
  }

  const handleExportSnapshot = () => {
    ensureInventoryHydrated()
    const raw = buildCurrentSnapshotJson()
    const filename = `wwcalc-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
    downloadJsonFile(raw, filename)

    setSnapshotJson(raw)
    setSnapshotError(null)
    setSnapshotStatus(`Exported current snapshot to ${filename}.`)
  }

  const handleExportDataBundle = (kind: typeof DATA_EXPORT_ACTIONS[number]['kind']) => {
    try {
      ensureInventoryHydrated()
      const result = buildDataExportFile(useAppStore.getState(), kind)
      downloadJsonFile(result.raw, result.fileName)
      setSnapshotJson(result.raw)
      setSnapshotError(null)
      setSnapshotStatus(`Exported ${result.label} to ${result.fileName}.`)
    } catch (error) {
      setSnapshotStatus(null)
      setSnapshotError(error instanceof Error ? error.message : 'Data export failed.')
    }
  }

  const handleCloudSyncToggle = (checked: boolean) => {
    setCloudSyncStatus(null)
    setCloudSyncError(null)

    if (checked) {
      if (!isGoogleDriveConfigured) {
        setCloudSyncError('Set VITE_GOOGLE_CLIENT_ID before enabling Google Drive sync.')
        return
      }

      connectGoogleDrive()
      return
    }

    disconnectGoogleDrive()
    setCloudSyncStatus('Disconnected Google Drive sync for this browser.')
  }

  const handleBuiltinBackgroundSelect = (backgroundKey: string) => {
    setTheme('background')
    setBackgroundImageKey(backgroundKey)
  }

  const handleBackgroundUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const backgroundKey = await saveUploadedBackgroundImage(file)
      setTheme('background')
      setBackgroundImageKey(backgroundKey)
      showToast({
        content: `Applied ${file.name} as the background wallpaper.`,
        variant: 'success',
      })
    } catch (error) {
      showToast({
        content: error instanceof Error ? error.message : 'Failed to save background image.',
        variant: 'error',
      })
    } finally {
      event.target.value = ''
    }
  }

  const handleFontPresetChange = (fontName: string) => {
    setDraftBodyFontName(fontName)
    setDraftBodyFontUrl(getPresetBodyFontLink(fontName))
  }

  const handleFontUrlChange = (value: string) => {
    setDraftBodyFontUrl(value)

    const extractedFamily = extractGoogleFontFamily(value)
    if (extractedFamily) {
      setDraftBodyFontName(extractedFamily)
      return
    }

    if (!value.trim() && !selectedFontIsPreset) {
      setDraftBodyFontName(ui.bodyFontName)
    }
  }

  const handleApplyTypography = async () => {
    try {
      setFontPreviewLoading(true)
      const resolved = await applyBodyFontSelection(draftBodyFontName, draftBodyFontUrl)
      const nextFontUrl = draftBodyFontName === SYSTEM_UI_FONT_NAME
        ? ''
        : draftBodyFontUrl.trim()

      setBodyFontSelection(resolved.fontName, nextFontUrl)
      showToast({
        content: `Applied ${resolved.fontName} as the body font.`,
        variant: 'success',
      })
    } finally {
      setFontPreviewLoading(false)
    }
  }

  const handleSyncToDrive = async () => {
    if (!googleDriveAccessToken) {
      setCloudSyncError('Sign in to Google Drive before uploading a backup.')
      return
    }

    try {
      setCloudSyncBusyAction('sync')
      setCloudSyncError(null)
      setCloudSyncStatus(null)

      const accessToken = await refreshGoogleDriveAccessToken()
      if (!accessToken) {
        throw new Error('Google Drive session expired. Sign in again to continue.')
      }

      const raw = buildCurrentSnapshotJson()
      const result = await uploadSnapshotToDrive(accessToken, raw)
      setCloudSyncStatus(`Uploaded ${result.fileName} to Google Drive app data.`)
      showToast({
        content: 'Snapshot uploaded to Google Drive.',
        variant: 'success',
      })
    } catch (error) {
      setCloudSyncStatus(null)
      setCloudSyncError(error instanceof Error ? error.message : 'Google Drive backup failed.')
    } finally {
      setCloudSyncBusyAction(null)
    }
  }

  const handleRestoreFromDrive = async () => {
    if (!googleDriveAccessToken) {
      setCloudSyncError('Sign in to Google Drive before restoring a backup.')
      return
    }

    try {
      setCloudSyncBusyAction('restore')
      setCloudSyncError(null)
      setCloudSyncStatus(null)

      const accessToken = await refreshGoogleDriveAccessToken()
      if (!accessToken) {
        throw new Error('Google Drive session expired. Sign in again to continue.')
      }

      const result = await restoreLatestSnapshotFromDrive(accessToken)
      if (!result) {
        setCloudSyncStatus('No Google Drive snapshots were found for this app.')
        return
      }

      const snapshot = parsePersistedAppStateJson(result.raw)
      hydrate(snapshot)
      savePersistedAppState(snapshot)
      setSnapshotJson(result.raw)
      setSnapshotError(null)
      setSnapshotStatus(`Imported snapshot from ${result.fileName}.`)
      setCloudSyncStatus(`Restored the latest Drive backup from ${result.fileName}.`)
      showToast({
        content: 'Restored the latest Google Drive snapshot.',
        variant: 'success',
      })
    } catch (error) {
      setCloudSyncStatus(null)
      setCloudSyncError(error instanceof Error ? error.message : 'Google Drive restore failed.')
    } finally {
      setCloudSyncBusyAction(null)
    }
  }

  const runSnapshotImport = (raw: string) => {
    try {
      const result = resolveImportedData(raw, useAppStore.getState())
      hydrate(result.snapshot)
      savePersistedAppState(result.snapshot)
      setSnapshotError(null)
      setSnapshotStatus(`Imported ${result.label} into the current app state.`)
    } catch (error) {
      setSnapshotStatus(null)
      setSnapshotError(error instanceof Error ? error.message : 'Data import failed.')
    }
  }

  const handleSnapshotFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const raw = await file.text()
    setSnapshotJson(raw)
    setSnapshotStatus(null)
    setSnapshotError(null)
    event.target.value = ''
  }

  const runLegacyAppImport = (raw: string) => {
    try {
      const result = importLegacyAppStateJson(raw)
      const hasImportedData =
        result.report.importedProfileIds.length > 0
        || result.report.importedInventoryEchoes > 0
        || result.report.importedInventoryBuilds > 0

      if (!hasImportedData) {
        setLegacyImportStatus(null)
        setLegacyImportError('No valid legacy app-state data was found. Current state was left unchanged.')
        return
      }

      hydrate(result.snapshot)
      savePersistedAppState(result.snapshot)
      setLegacyImportError(null)
      setLegacyImportStatus([
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
      setLegacyImportStatus(null)
      setLegacyImportError(error instanceof Error ? error.message : 'Legacy app-state import failed.')
    }
  }

  const handleLegacyFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const raw = await file.text()
    setLegacyImportJson(raw)
    setLegacyImportStatus(null)
    setLegacyImportError(null)
    event.target.value = ''
  }

  const renderSwatch = (
    variant: ThemeVariant,
    selected: boolean,
    onSelect: () => void,
  ) => {
    const preview =
      variant === 'frosted-aurora' && backgroundPreviewUrl
        ? `linear-gradient(135deg, rgba(11, 17, 32, 0.18), rgba(11, 17, 32, 0.28)), url(${backgroundPreviewUrl})`
        : THEME_PREVIEWS[variant]
    const isGradient = preview.includes('gradient')

    return (
      <div key={variant} style={{ display: 'grid', gap: '0.15rem' }}>
        <button
          type="button"
          className={`settings-swatch ${isGradient ? 'settings-swatch--gradient' : 'settings-swatch--plain'} ${selected ? 'settings-swatch--active' : ''}`}
          style={{ '--preview-value': preview } as CSSProperties}
          onClick={onSelect}
          title={toTitle(variant)}
        />
        <div className="settings-swatch-name">{toTitle(variant)}</div>
      </div>
    )
  }

  return (
    <div className="page">
      {/* ── Hero header ── */}
      <header className="page-hero">
        <div className="page-hero-eyebrow">Configuration</div>
        <h1>Settings</h1>
        <p className="page-hero-sub">
          Personalize your workspace, manage themes, and control your data.
        </p>
      </header>

      {/* ── Bento grid ── */}
      <div className="page-bento">

        {/* ── Theme Mode — wide tile ── */}
        <section className="page-tile page-tile--wide">
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
                    setThemePreference('system')
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

          {/* Light variants */}
          <div className="settings-swatch-section">
            <div className="settings-swatch-label">Light</div>
            <div className="settings-swatch-grid">
              {THEME_VARIANTS_BY_MODE.light.map((variant) =>
                renderSwatch(
                  variant,
                  ui.lightVariant === variant,
                  () => setLightVariant(variant as LightThemeVariant),
                ),
              )}
            </div>
          </div>

          {/* Dark variants */}
          <div className="settings-swatch-section">
            <div className="settings-swatch-label">Dark</div>
            <div className="settings-swatch-grid">
              {THEME_VARIANTS_BY_MODE.dark.map((variant) =>
                renderSwatch(
                  variant,
                  ui.darkVariant === variant,
                  () => setDarkVariant(variant as DarkThemeVariant),
                ),
              )}
            </div>
          </div>

          {/* Background variants */}
          <div className="settings-swatch-section">
            <div className="settings-swatch-label">Background</div>
            <div className="settings-swatch-grid">
              {THEME_VARIANTS_BY_MODE.background.map((variant) =>
                renderSwatch(
                  variant,
                  ui.backgroundVariant === variant,
                  () => setBackgroundVariant(variant as BackgroundThemeVariant),
                ),
              )}
            </div>
          </div>

          {ui.theme === 'background' ? (
            <div className="settings-background-panel">
              <div className="settings-swatch-label">Wallpapers</div>
              <div className="settings-background-grid">
                {BACKGROUND_WALLPAPER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`settings-background-card ${ui.backgroundImageKey === preset.id ? 'settings-background-card--active' : ''}`}
                    onClick={() => handleBuiltinBackgroundSelect(preset.id)}
                  >
                    <img
                      src={preset.src}
                      alt={preset.label}
                      className="settings-background-card-image"
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="settings-background-card-label">{preset.label}</span>
                  </button>
                ))}
                {isUploadedBackgroundKey(ui.backgroundImageKey) && backgroundPreviewUrl ? (
                  <button
                    type="button"
                    className="settings-background-card settings-background-card--active"
                    onClick={() => handleBuiltinBackgroundSelect(ui.backgroundImageKey)}
                  >
                    <img
                      src={backgroundPreviewUrl}
                      alt="custom wallpaper"
                      className="settings-background-card-image"
                    />
                    <span className="settings-background-card-label">custom upload</span>
                  </button>
                ) : null}
              </div>

              <div className="settings-dropzone settings-dropzone--compact">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleBackgroundUpload}
                />
                <div className="settings-dropzone-text">
                  <strong>Choose an image</strong> to replace the active wallpaper
                </div>
              </div>

              <div className="settings-data-note">
                Background mode now uses the v1 wallpaper set, keeps uploads in indexeddb, and automatically flips text tone based on image brightness.
              </div>
            </div>
          ) : null}
        </section>

        {/* ── Preferences — narrow tile ── */}
        <section className="page-tile page-tile--narrow">
          <div className="tile-header">
            <div className="tile-icon"><Sparkles /></div>
            <div className="tile-header-text">
              <h3>Preferences</h3>
              <p>Fine-tune your experience</p>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '0.55rem' }}>
            <ToggleSwitch
              label="Glass Blur"
              description="Frosted-glass backdrop effects"
              checked={ui.blurMode === 'on'}
              onChange={(checked) => setBlurMode(checked ? 'on' : 'off')}
            />
            <ToggleSwitch
              label="SOME Animations"
              description="Fade-in effects and some other animations"
              checked={ui.entranceAnimations === 'on'}
              onChange={(checked) => setEntranceAnimations(checked ? 'on' : 'off')}
            />
            <ToggleSwitch
              label="Auto Snapshot"
              description="Automatic state backups"
              checked={autoSnapshotEnabled}
              onChange={setAutoSnapshotEnabled}
            />
          </div>
        </section>

        {/* ── Cloud Sync — half tile ── */}
        <section className="page-tile page-tile--half">
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
            checked={isGoogleDriveConnected}
            onChange={handleCloudSyncToggle}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
            <span className={`settings-sync-status ${isGoogleDriveConnected ? 'settings-sync-status--on' : 'settings-sync-status--off'}`}>
              <span className="settings-sync-dot" />
              {isGoogleDriveConnected ? `Connected${googleDriveUser?.email ? ` as ${googleDriveUser.email}` : ''}` : 'Not connected'}
            </span>
            <button
              type="button"
              className="settings-action-btn"
              disabled={!isGoogleDriveConnected || cloudSyncBusyAction !== null}
              onClick={() => {
                void handleSyncToDrive()
              }}
            >
              {cloudSyncBusyAction === 'sync' ? 'Syncing...' : 'Sync Now'}
            </button>
            <button
              type="button"
              className="settings-action-btn"
              disabled={!isGoogleDriveConnected || cloudSyncBusyAction !== null}
              onClick={() => confirmation.confirm({
                title: 'Restore the latest Google Drive backup?',
                message: 'This will overwrite the current local state with the latest snapshot stored in Google Drive.',
                confirmLabel: 'Restore backup',
                cancelLabel: 'Keep local state',
                variant: 'danger',
                onConfirm: () => {
                  void handleRestoreFromDrive()
                },
              })}
            >
              {cloudSyncBusyAction === 'restore' ? 'Restoring...' : 'Restore Latest'}
            </button>
          </div>

          {!isGoogleDriveConfigured ? (
            <div className="settings-status settings-status--error" style={{ marginTop: '0.8rem' }}>
              Google Drive sync needs `VITE_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`.
            </div>
          ) : null}
          {googleDriveAuthError && (
            <div className="settings-status settings-status--error" style={{ marginTop: '0.8rem' }}>
              {googleDriveAuthError}
            </div>
          )}
          {cloudSyncStatus && (
            <div className="settings-status settings-status--success" style={{ marginTop: '0.8rem' }}>
              {cloudSyncStatus}
            </div>
          )}
          {cloudSyncError && (
            <div className="settings-status settings-status--error" style={{ marginTop: '0.8rem' }}>
              {cloudSyncError}
            </div>
          )}
        </section>

        {/* ── Font — half tile ── */}
        <section className="page-tile page-tile--half">
          <div className="tile-header">
            <div className="tile-icon"><Type /></div>
            <div className="tile-header-text">
              <h3>Typography</h3>
              <p>Customize the body font with presets or a Google Fonts link</p>
            </div>
          </div>

          <div className="settings-font-stack">
            <select
              className="settings-font-select"
              value={draftBodyFontName}
              onChange={(event) => handleFontPresetChange(event.target.value)}
            >
              {!selectedFontIsPreset ? (
                <option value={draftBodyFontName}>{draftBodyFontName}</option>
              ) : null}
              {BODY_FONT_PRESETS.map((fontName) => (
                <option key={fontName} value={fontName}>
                  {fontName}
                </option>
              ))}
            </select>

            <input
              type="url"
              className="settings-font-input"
              value={draftBodyFontUrl}
              placeholder="https://fonts.googleapis.com/css2?family=Caveat"
              onChange={(event) => handleFontUrlChange(event.target.value)}
            />

            <div className="settings-font-preview">
              {fontPreviewLoading ? (
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
              disabled={!fontChanged || !canApplyFont || fontPreviewLoading}
              onClick={() => {
                void handleApplyTypography()
              }}
            >
              Apply Typography
            </button>
          </div>
        </section>

        {/* ── Data Management — wide tile ── */}
        <section className="page-tile page-tile--wide">
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
            <button type="button" className="settings-action-btn" onClick={handleExportSnapshot}>
              <Download /> Export Snapshot
            </button>
            <button
              type="button"
              className="settings-action-btn"
              disabled={!snapshotJson.trim()}
              onClick={() => runSnapshotImport(snapshotJson)}
            >
              <Upload /> Import Data
            </button>
          </div>

          <div className="settings-data-note">
            Need something smaller than a full snapshot? Export just the slice you want and import it through the same file box below.
          </div>

          <div className="settings-data-actions settings-data-actions--subtle">
            {DATA_EXPORT_ACTIONS.map((action) => (
              <button
                key={action.kind}
                type="button"
                className="settings-action-btn settings-action-btn--quiet"
                onClick={() => handleExportDataBundle(action.kind)}
              >
                {action.label}
              </button>
            ))}
          </div>

          <div className="settings-dropzone">
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleSnapshotFileChange}
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
              setSnapshotJson(event.target.value)
              setSnapshotStatus(null)
              setSnapshotError(null)
            }}
            placeholder="Paste a full snapshot or one of the smaller export JSON files here..."
          />

          {snapshotStatus && (
            <div className="settings-status settings-status--success">{snapshotStatus}</div>
          )}
          {snapshotError && (
            <div className="settings-status settings-status--error">{snapshotError}</div>
          )}
        </section>

        {/* ── Danger Zone — narrow tile ── */}
        <section className="page-tile page-tile--narrow">
          <div className="tile-header">
            <div className="tile-icon tile-icon--danger"><Trash2 /></div>
            <div className="tile-header-text">
              <h3>Danger Zone</h3>
              <p>Irreversible actions</p>
            </div>
          </div>

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
        </section>

        {/* ── Legacy Import — full tile ── */}
        <section className="page-tile page-tile--full">
          <div className="tile-header">
            <div className="tile-icon"><Archive /></div>
            <div className="tile-header-text">
              <h3>Legacy App Import</h3>
              <p>Import a full v1 backup and convert it into the current persisted app state</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <div className="settings-dropzone">
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleLegacyFileChange}
                />
                <div className="settings-dropzone-text">
                  <strong>Choose a file</strong> or drag a legacy v1 backup JSON
                </div>
              </div>

              <div className="settings-data-actions">
                <button
                  type="button"
                  className="settings-action-btn"
                  disabled={!legacyImportJson.trim()}
                  onClick={() => runLegacyAppImport(legacyImportJson)}
                >
                  <Upload /> Import Legacy Backup
                </button>
              </div>

              {legacyImportStatus && (
                <div className="settings-status settings-status--success">{legacyImportStatus}</div>
              )}
              {legacyImportError && (
                <div className="settings-status settings-status--error">{legacyImportError}</div>
              )}
            </div>

            <textarea
              className="settings-textarea"
              rows={6}
              value={legacyImportJson}
              onChange={(event) => {
                setLegacyImportJson(event.target.value)
                setLegacyImportStatus(null)
                setLegacyImportError(null)
              }}
              placeholder='Paste the v1 "All Data" backup JSON here. The importer will recover profile, inventory, build, and settings data while letting the current app fill in default-only state.'
            />
          </div>
        </section>
      </div>

      <ConfirmationModal
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
    </div>
  )
}
