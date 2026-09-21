/*
  Author: Runor Ewhro
  Description: Coordinates persisted appearance and behavior preferences,
               local data import/export, storage accounting, and Drive backups.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties as CssProps, ReactNode } from 'react'
import { hasWwcbMgc, readAppFile, xprtAppFile } from '@/application/persistence/fileCodec'
import { useAppStore, type AppStore } from '@/application/state'
import { useInventoryLease } from '@/application/hooks/useInventoryLease.ts'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal'
import { useConfirm } from '@/shared/hooks/useConfirmation.ts'
import { mainPortal } from '@/shared/lib/portalTarget'
import { clrPrssAppSt, saveAppState, APP_STORAGE_KEY } from '@/application/persistence/appStorage'
import { rstrLtstSnap, pldSnapToDrv } from '@/application/backup/driveSync'
import { selectPersisted } from '@/application/state/serialization'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { projectScenarioWorkspaceProfiles } from '@/engine/runtime/scenarioRuntime'
import {
  applyBgColor,
  applyBgToDocument,
  dtctBgClr,
  dtctBgTxtMod,
  getBgPreset,
  isCustomBgKey,
  resolveBg,
  switchBg,
  writeStoredBgColor,
} from '@/application/theme/backgroundTheme'
import { resolveImageRef } from '@/application/media/imageUpload.ts'
import type { StoredImage } from '@/application/media/imageUpload.ts'
import { useAppModal } from '@/shared/ui/useAppModal'
import { ImageUploadModal } from '@/application/media/ImageUploadModal'
import {
  applyBodyFon,
  applyPrvwBod,
  ensureGoogleFamily,
  extractGoogleFamily,
} from '@/application/theme/typography'
import {
  BG_PRESETS,
  BODY_FONT_PRESETS,
  getPresetFontUrl,
  makeFontStack,
  SYSTEM_FONT_NAME,
  WUWA_FONT_NAME,
} from '@/domain/entities/appearance'
import { useGglDrvAut } from '@/application/hooks/useGoogleDriveAuth'
import { DATAXPRTCTNS, mkDataXprtFi } from '@/modules/calibration/model/dataManagement'
import { runDataImport } from '@/modules/calibration/model/dataImportClient'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { gameDataModeFromBeta, type GameDataMode } from '@/domain/entities/gameDataMode'
import { CllpPageHeyf } from '@/shared/ui/CollapsiblePageHero'
import { HIST_MAX_OPTS, type HistoryMax } from '@/domain/entities/appState'
import { groupUid } from '@/modules/simulation/api/playerIdentity'
import {
  THEME_BY_MODE,
  THEME_INK,
  type BgThemeVar,
  type DarkThemeVar,
  type LightThemeVar,
  type ThemeVariant,
} from '@/domain/entities/themes'
import { mkPrefGrps, type PrefTglItem } from '@/modules/calibration/model/preferences'

function waitForNextP(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0)
      return
    }

    window.requestAnimationFrame(() => resolve())
  })
}

function runWhenIdle(task: () => void): void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(task, { timeout: 1000 })
    return
  }

  setTimeout(task, 0)
}

const MAX_INLINE_IMPORT_BYTES = 1024 * 1024
let activeSessionBackgroundUrl: string | null = null

interface ModeCatalogIds {
  resonators: Set<string>
  weapons: Set<string>
  echoes: Set<string>
  sets: Set<string>
  enemies: Set<string>
}

async function fetchJsonArray(path: string): Promise<unknown[]> {
  const response = await fetch(path)
  return await response.json() as unknown[]
}

function idSet(entries: unknown[]): Set<string> {
  return new Set(entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || !('id' in entry)) {
      return []
    }

    const id = (entry as { id?: unknown }).id
    return id == null ? [] : [String(id)]
  }))
}

async function loadModeCatalogIds(mode: GameDataMode): Promise<ModeCatalogIds> {
  const [resonators, weapons, echoes, sets, enemies] = await Promise.all([
    fetchJsonArray(`/data/${mode}/resonators/catalog.json`),
    fetchJsonArray(`/data/${mode}/weapons/catalog.json`),
    fetchJsonArray(`/data/${mode}/echoes/catalog.json`),
    fetchJsonArray(`/data/${mode}/sonata/sets.json`),
    fetchJsonArray(`/data/${mode}/enemies/catalog.json`),
  ])

  return {
    resonators: idSet(resonators),
    weapons: idSet(weapons),
    echoes: idSet(echoes),
    sets: idSet(sets),
    enemies: idSet(enemies),
  }
}

function summarizeModeCleanup(
  snapshot: Pick<AppStore, 'combat' | 'simulation' | 'library'>,
  catalog: ModeCatalogIds,
): string[] {
  type CleanupOutcome = 'hidden' | 'ignored' | 'reset'
  type CleanupCount = {
    subject: string
    outcome: CleanupOutcome
    count: number
  }

  const counts = new Map<string, CleanupCount>()
  const add = (subject: string, outcome: CleanupOutcome, count = 1) => {
    if (count > 0) {
      const key = `${subject}:${outcome}`
      const previous = counts.get(key)
      counts.set(key, {
        subject,
        outcome,
        count: (previous?.count ?? 0) + count,
      })
    }
  }
  const hasRes = (id: string | null | undefined) => !!id && catalog.resonators.has(String(id))
  const hasWeapon = (id: string | null | undefined) => !id || catalog.weapons.has(String(id))
  const hasEcho = (id: string | null | undefined) => !!id && catalog.echoes.has(String(id))
  const hasSet = (id: number | string | null | undefined) => id != null && catalog.sets.has(String(id))

  const scenario = selectedCombatScenario(snapshot.combat)
  if (scenario.team.members.some((member) => !hasRes(member.resonatorId))) {
    add('active resonator', 'reset')
  }
  if (
    scenario.target.source === 'catalog'
    && scenario.target.id
    && !catalog.enemies.has(String(scenario.target.id))
  ) {
    add('enemy profile', 'reset')
  }

  for (const profile of Object.values(projectScenarioWorkspaceProfiles(snapshot.combat))) {
    if (!hasRes(profile.resonatorId)) {
      add('profile', 'hidden')
      continue
    }

    if (!hasWeapon(profile.runtime.build.weapon.id)) {
      add('profile weapon', 'reset')
    }
    for (const echo of profile.runtime.build.echoes) {
      if (!echo) continue
      if (!hasEcho(echo.id)) add('equipped echo', 'hidden')
      else if (!hasSet(echo.set)) add('equipped echo set', 'reset')
    }
    for (const teammateId of profile.runtime.team.slice(1)) {
      if (teammateId && !hasRes(teammateId)) add('teammate slot', 'hidden')
    }
    for (const teamRuntime of profile.runtime.teamRuntimes) {
      if (teamRuntime && !hasRes(teamRuntime.id)) add('teammate runtime', 'hidden')
    }
    for (const setId of Object.keys(profile.runtime.local.setConditionals.off)) {
      if (!hasSet(setId)) add('set conditional', 'ignored')
    }
  }

  for (const entry of snapshot.library.echoes) {
    if (!hasEcho(entry.echo.id)) add('inventory echo', 'hidden')
    else if (!hasSet(entry.echo.set)) add('inventory echo set', 'reset')
  }
  for (const entry of snapshot.library.builds) {
    if (!hasRes(entry.resonatorId)) {
      add('saved build', 'hidden')
      continue
    }
    if (!hasWeapon(entry.build.weapon.id)) add('saved build weapon', 'reset')
    for (const echo of entry.build.echoes) {
      if (!echo) continue
      if (!hasEcho(echo.id)) add('saved build echo', 'hidden')
      else if (!hasSet(echo.set)) add('saved build echo set', 'reset')
    }
  }
  for (const entry of snapshot.library.rotations) {
    const context = entry.scenario.team.members.find(
      (member) => member.id === entry.scenario.contextMemberId,
    ) ?? entry.scenario.team.members[0]
    if (!context || !hasRes(context.resonatorId)) {
      add('saved rotation', 'hidden')
      continue
    }
    for (const member of entry.scenario.team.members) {
      if (!hasRes(member.resonatorId)) add('saved rotation member', 'hidden')
    }
  }
  for (const entry of snapshot.library.scenarios) {
    const context = entry.scenario.team.members.find(
      (member) => member.id === entry.scenario.contextMemberId,
    ) ?? entry.scenario.team.members[0]
    if (!context || !hasRes(context.resonatorId)) {
      add('saved scenario', 'hidden')
      continue
    }
    for (const member of entry.scenario.team.members) {
      if (!hasRes(member.resonatorId)) add('saved scenario member', 'hidden')
    }
  }
  for (const weaponId of Object.keys(snapshot.simulation.weaponSuggests.states)) {
    if (!catalog.weapons.has(String(weaponId))) add('weapon suggestion config', 'hidden')
  }
  for (const [resonatorId, suggestion] of Object.entries(snapshot.simulation.suggestionsByResonatorId)) {
    if (!hasRes(resonatorId)) {
      add('suggestion profile', 'hidden')
      continue
    }
    for (const preference of suggestion.random.setPreferences) {
      if (!hasSet(preference.setId)) add('suggestion set preference', 'ignored')
    }
    if (suggestion.random.mainEchoId && !hasEcho(suggestion.random.mainEchoId)) {
      add('suggestion main echo', 'ignored')
    }
  }

  return Array.from(counts.values()).map(({ subject, outcome, count }) => {
    const countedSubject = count === 1
      ? subject
      : subject.endsWith('echo') ? `${subject}es` : `${subject}s`
    return `${count} ${countedSubject} ${outcome}`
  })
}


type SectionId = 'look' | 'behavior' | 'data' | 'backup'

const SECTIONS: { id: SectionId; name: string }[] = [
  { id: 'look', name: 'Look' },
  { id: 'behavior', name: 'Behavior' },
  { id: 'data', name: 'Data' },
  { id: 'backup', name: 'Backup' },
]

type SlotId = 'light' | 'dark' | 'background'

const SLOTS: { id: SlotId; kind: string }[] = [
  { id: 'light', kind: 'Light' },
  { id: 'dark', kind: 'Dark' },
  { id: 'background', kind: 'Background' },
]

const SLICE_NOTES: Record<string, string> = {
  'current-resonator': 'the build you have open, with its team and echoes',
  profiles: 'every resonator and the build on it',
  inventory: 'your echo bag and saved builds',
  settings: 'preferences, theme and font',
  session: 'what is open right now',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ThemeInkCard({ variant, named = true }: { variant: ThemeVariant; named?: boolean }) {
  const ink = THEME_INK[variant]
  return (
    <span className="cal-ink"
      aria-hidden="true"
      style={{
        '--ink-bg': ink.bg,
        '--ink-surface': ink.surface,
        '--ink-text': ink.text,
        '--ink-accent': ink.accent,
      } as CssProps}
    >
      <span className="cal-ink__bar">
        <u />
        <s />
      </span>
      <span className="cal-ink__body">
        <span className="cal-ink__line" data-w="m" />
        <span className="cal-ink__line" data-w="s" />
        <span className="cal-ink__chip" />
      </span>
      {named ? <span className="cal-ink__name">{THEME_LABELS[variant]}</span> : null}
    </span>
  )
}

const THEME_LABELS: Record<ThemeVariant, string> = {
  light: 'Light',
  'pastel-pink': 'Pastel Pink',
  'pastel-blue': 'Pastel Blue',
  'vibrant-citrus': 'Vibrant Citrus',
  'glassy-rainbow': 'Glassy Rainbow',
  'sunlit-haze': 'Sunlit Haze',
  dark: 'Dark',
  'dark-alt': 'Dark Alt',
  'cosmic-rainbow': 'Cosmic Rainbow',
  'scarlet-nebula': 'Scarlet Nebula',
  'emerald-forest': 'Emerald Forest',
  'graphite-pop': 'Graphite Pop',
  'frosted-aurora': 'Frosted Aurora',
}

function Switch({
  id,
  on,
  label,
  disabled,
  onChange,
}: {
  id: string
  on: boolean
  label: string
  disabled?: boolean
  onChange?: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      id={id} className="cal-switch"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
    />
  )
}

function SettingRow({
  name,
  note,
  chip,
  children,
}: {
  name: ReactNode
  note?: ReactNode
  chip?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="cal-row">
      <div>
        <div className="cal-row__name">
          {name}
          {chip}
        </div>
        {note ? <p className="cal-help">{note}</p> : null}
      </div>
      <div className="cal-row__control">{children}</div>
    </div>
  )
}


// The thing this control controls is a signature, so it shows the signature: the
// plate renders exactly what a showcase card prints, in the card's own face, while
// you type. The Echo parser writes the same preference, so the drafts follow the
// store during render rather than through an effect.
function PlayerPlate() {
  const playerId = useAppStore((state) => state.ui.preferences.playerId)
  const playerUid = useAppStore((state) => state.ui.preferences.playerUid)
  const setIdentity = useAppStore((state) => state.setPlayerIdentity)
  const [draft, setDraft] = useState({ id: playerId, uid: playerUid })
  const [seen, setSeen] = useState({ id: playerId, uid: playerUid })

  if (seen.id !== playerId || seen.uid !== playerUid) {
    setSeen({ id: playerId, uid: playerUid })
    if (draft.id.trim() !== playerId || draft.uid.trim() !== playerUid) {
      setDraft({ id: playerId, uid: playerUid })
    }
  }

  // the store trims; the draft keeps what was typed so a space can be typed mid-name
  const commit = (next: { id: string; uid: string }) => {
    setDraft(next)
    setIdentity(next.id, next.uid)
  }

  const digits = playerUid.replace(/\D/g, '').length
  const signed = Boolean(playerId || playerUid)

  return (
    <div className="cal-plate">
      <div className="cal-plate__face" data-signed={signed ? 'true' : undefined}>
        {signed ? (
          <>
            {playerId ? <b>{playerId}</b> : null}
            {playerUid ? <span className="cal-num">{groupUid(playerUid)}</span> : null}
          </>
        ) : (
          <em>Cards go out unsigned</em>
        )}
      </div>

      <div className="cal-plate__fields">
        <label className="cal-plate__field">
          <span>Name</span>
          <input
            type="text"
            id="cal-player-id"
            value={draft.id}
            placeholder="How you want to be credited"
            onChange={(event) => commit({ ...draft, id: event.target.value })}
          />
        </label>
        <label className="cal-plate__field">
          <span>
            UID
            {playerUid ? <em className="cal-num">{digits} digits</em> : null}
          </span>
          <input
            type="text"
            id="cal-player-uid"
            inputMode="numeric"
            className="cal-num"
            value={draft.uid}
            placeholder="500395087"
            onChange={(event) => commit({ ...draft, uid: event.target.value })}
          />
        </label>
      </div>

      <p className="cal-help">
        Signs your showcase cards. Scanning a build card in Echoes reads it too, and
        asks before it changes anything here.
      </p>
    </div>
  )
}

export function CalibrationPage() {
  useInventoryLease()
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
  const setGameBetaData = useAppStore((state) => state.setGameBetaData)
  const setRcmmMenuT = useAppStore((state) => state.setRecMenus)
  const setEvaluationStates = useAppStore((state) => state.setEvaluationStates)
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

  const confirmation = useConfirm()
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
  const snapshotTextRef = useRef<HTMLTextAreaElement | null>(null)
  const [hasSnapshotText, setHasSnpsTxt] = useState(false)
  const snapshotFileRef = useRef<File | null>(null)
  const [snapshotFile, setSnpsFile] = useState<{ name: string; size: number } | null>(null)
  const [snpsMprtBusy, setSnpsMprtBu] = useState(false)
  const [snpsStts, setSnpsStts] = useState<string | null>(null)
  const [snpsRrr, setSnpsRrr] = useState<string | null>(null)
  const [drftFontName, setDrftFNam] = useState(ui.bodyFontName)
  const [drftFontUrl, setDrftFUrl] = useState(ui.bodyFontUrl)
  const [fontPrvwLdng, setFontPrvwL] = useState(false)
  const [fontLinkVld, setFontLinkV] = useState(true)
  const [cldSyncStts, setCldSyncSt] = useState<string | null>(null)
  const [cldSyncRrr, setCldSyncRr] = useState<string | null>(null)
  const [cldSyncBusyC, setCldSyncBu] = useState<'sync' | 'restore' | null>(null)
  const legacyFileRef = useRef<File | null>(null)
  const [legacyFile, setLgcyMprtFi] = useState<{ name: string; size: number } | null>(null)
  const [lgcyMprtBusy, setLgcyMprtBu] = useState(false)
  const [lgcyMprtStts, setLgcyMprtS] = useState<string | null>(null)
  const [lgcyMprtRrr, setLgcyMprtR] = useState<string | null>(null)

  // Initialize the editable theme slot from the current mode; later picks are local.
  const liveSlot: SlotId = ui.theme === 'background' ? 'background' : ui.theme === 'light' ? 'light' : 'dark'
  const [openSlot, setOpenSlot] = useState<SlotId>(liveSlot)
  const [seenLive, setSeenLive] = useState(liveSlot)
  if (liveSlot !== seenLive) {
    setSeenLive(liveSlot)
    setOpenSlot(liveSlot)
  }

  const [at, setAt] = useState<SectionId>('look')
  const pageRef = useRef<HTMLDivElement | null>(null)
  const secRefs = useRef(new Map<SectionId, HTMLElement>())

  const following = ui.themePreference === 'system'
  const pickOf: Record<SlotId, ThemeVariant> = {
    light: ui.lightVariant,
    dark: ui.darkVariant,
    background: ui.backgroundVariant,
  }

  const fontChanged =
    drftFontName !== ui.bodyFontName
    || drftFontUrl.trim() !== ui.bodyFontUrl.trim()
  const canApplyFont = drftFontName === SYSTEM_FONT_NAME || fontLinkVld
  const selFontIsPrs = BODY_FONT_PRESETS.includes(drftFontName as typeof BODY_FONT_PRESETS[number])

  const onGameDataModeTgl = (enabled: boolean) => {
    void (async () => {
      if (enabled === useAppStore.getState().ui.preferences.gameBetaData) {
        return
      }

      const targetMode = gameDataModeFromBeta(enabled)
      const snapshot = useAppStore.getState()

      try {
        const cleanup = summarizeModeCleanup(snapshot, await loadModeCatalogIds(targetMode))

        confirmation.confirm({
          title: `Switch to ${targetMode} game data?`,
          message: (
            <div>
              <p>The app will reload after switching data mode.</p>
              {cleanup.length > 0 ? (
                <>
                  <p>Persisted entries missing from {targetMode} data will be hidden, ignored, or shown with defaults while this mode is loaded:</p>
                  <ul>
                    {cleanup.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>No missing persisted catalog entries were found for {targetMode} data.</p>
              )}
            </div>
          ),
          confirmLabel: 'Switch and reload',
          cancelLabel: 'Stay here',
          variant: cleanup.length > 0 ? 'danger' : 'info',
          onConfirm: () => {
            setGameBetaData(enabled)
            saveAppState(selectPersisted(useAppStore.getState()), { domains: ['ui.layout'] })
            window.location.reload()
          },
        })
      } catch (error) {
        showToast({
          content: error instanceof Error ? error.message : `Failed to inspect ${targetMode} game data.`,
          variant: 'error',
        })
      }
    })()
  }

  const prefGrps = mkPrefGrps({
    ui,
    setBlurMode,
    setNtrnAnim: setNtrnNmtn,
    setCtxMenu,
    setPdtTst: setUpdTst,
    setGameBetaData: onGameDataModeTgl,
    setRcmmMenyu: setRcmmMenuT,
    setEvaluationStates,
    setMaxResInit,
    setHaveHist,
    setHistMax,
    setCmpcInv,
    setSeeQppd,
    setCmprXprts: useAppStore.getState().setCmprXprts,
  })

  const appGroup = prefGrps.find((group) => group.title === 'App')
  const calcGroup = prefGrps.find((group) => group.title === 'Calculator')
  const asideItem = prefGrps.find((group) => group.title === 'Other')?.items[0]
  const switchable = [...(appGroup?.items ?? []), ...(calcGroup?.items ?? [])]
  const switchedOn = switchable.filter((item) => item.checked).length

  const mkCurSnapJso = useCallback(() => {
    // hydrate inventory first so exports always capture the fully realized
    // persisted snapshot instead of a lazily trimmed view.
    useAppStore.getState().ensInvHydr()
    const snapshot = selectPersisted(useAppStore.getState())
    return JSON.stringify(snapshot, null, 2)
  }, [])

  // Storage accounting walks the persisted snapshot once on mount; imports
  // explicitly refresh the resulting domain sizes.
  const [weights, setWeights] = useState<{ parts: { name: string; bytes: number }[]; total: number; slices: Record<string, number> } | null>(null)

  const measure = useCallback(() => {
    try {
      ensInvHydr()
      const snapshot = selectPersisted(useAppStore.getState())
      const size = (value: unknown) => JSON.stringify(value ?? null).length
      const parts = [
        { name: 'Echoes', bytes: size(snapshot.library.echoes) },
        { name: 'Resonators', bytes: size(snapshot.combat) },
        { name: 'Builds', bytes: size(snapshot.library.builds) },
        { name: 'Rotations', bytes: size(snapshot.library.rotations) + size(snapshot.library.scenarios) },
        { name: 'Simulation', bytes: size(snapshot.simulation) },
        { name: 'Settings', bytes: size(snapshot.ui) },
      ].filter((part) => part.bytes > 2)

      const slices: Record<string, number> = {}
      for (const action of DATAXPRTCTNS) {
        try {
          slices[action.kind] = mkDataXprtFi(useAppStore.getState(), action.kind).raw.length
        } catch {
          slices[action.kind] = 0
        }
      }

      setWeights({
        parts: parts.sort((a, b) => b.bytes - a.bytes),
        total: parts.reduce((sum, part) => sum + part.bytes, 0),
        slices,
      })
    } catch {
      setWeights(null)
    }
  }, [ensInvHydr])

  const scheduleMeasure = useCallback(() => {
    runWhenIdle(measure)
  }, [measure])

  useEffect(() => {
    measure()
  }, [measure])

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

  // Load preset font stylesheets once on mount, independently of the selected font.
  useEffect(() => {
    for (const preset of BODY_FONT_PRESETS) {
      if (preset === SYSTEM_FONT_NAME || preset === WUWA_FONT_NAME) continue
      ensureGoogleFamily(preset)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadPreview = async () => {
      setFontPrvwL(true)
      // Loading a preview stylesheet does not persist a font selection.
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

  useEffect(() => {
    const page = pageRef.current
    if (!page) return

    let frame = 0
    const read = () => {
      frame = 0
      const line = page.scrollTop + 160
      let next: SectionId = SECTIONS[0].id
      for (const section of SECTIONS) {
        const node = secRefs.current.get(section.id)
        if (node && node.offsetTop <= line) next = section.id
      }
      setAt((prev) => (prev === next ? prev : next))
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(read)
    }

    read()
    page.addEventListener('scroll', schedule, { passive: true })
    return () => {
      page.removeEventListener('scroll', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  const jumpTo = (id: SectionId) => {
    const page = pageRef.current
    const node = secRefs.current.get(id)
    if (!page || !node) return
    page.scrollTo({ top: Math.max(0, node.offsetTop - 24), behavior: 'smooth' })
  }

  const keepSec = (id: SectionId) => (node: HTMLElement | null) => {
    if (node) secRefs.current.set(id, node)
    else secRefs.current.delete(id)
  }

  const dwnlJsonFile = async (raw: string, filename: string) => xprtAppFile(filename, raw)

  const clearAllData = () => {
    clrPrssAppSt()
    resetState()
    window.location.href = '/'
  }

  const onXprtSnap = async () => {
    ensInvHydr()
    const raw = mkCurSnapJso()
    const filename = `wwcalc-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
    const written = await dwnlJsonFile(raw, filename)

    setSnpsRrr(null)
    setSnpsStts(`Exported current snapshot to ${written}.`)
  }

  const onXprtDataBn = async (kind: typeof DATAXPRTCTNS[number]['kind']) => {
    try {
      ensInvHydr()
      const result = mkDataXprtFi(useAppStore.getState(), kind)
      const written = await dwnlJsonFile(result.raw, result.fileName)
      setSnpsRrr(null)
      setSnpsStts(`Exported ${result.label} to ${written}.`)
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
    writeStoredBgColor(nextMainClr)
    applyBgColor(nextMainClr)
  }

  const onBltnBgSel = async (bgKey: string) => {
    const preset = getBgPreset(bgKey)
    if (!preset) return
    await applyBgSel(bgKey, preset.src)
  }

  const handleBgApply = async (result: StoredImage) => {
    try {
      if (result.persisted) {
        await applyBgSel(result.ref, result.ref)
        if (activeSessionBackgroundUrl) URL.revokeObjectURL(activeSessionBackgroundUrl)
        activeSessionBackgroundUrl = null
      } else {
        // session: show it now without persisting the active key.
        const resolved = await resolveImageRef(result.ref)
        if (resolved) {
          applyBgToDocument(resolved.url)
          if (activeSessionBackgroundUrl && activeSessionBackgroundUrl !== resolved.url) {
            URL.revokeObjectURL(activeSessionBackgroundUrl)
          }
          activeSessionBackgroundUrl = resolved.url.startsWith('blob:') ? resolved.url : null
        }
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
    setDrftFUrl(getPresetFontUrl(fontName))
  }

  const onFontUrlChn = (value: string) => {
    setDrftFUrl(value)

    const xtrcFmly = extractGoogleFamily(value)
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
      const nextFontUrl = drftFontName === SYSTEM_FONT_NAME ? '' : drftFontUrl.trim()

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

      // Yield one frame so the busy state commits before synchronous serialization.
      await waitForNextP()
      const raw = mkCurSnapJso()
      const result = await pldSnapToDrv(accessToken, raw)
      setCldSyncSt(`Uploaded ${result.fileName} to Google Drive app data.`)
      showToast({ content: 'Snapshot uploaded to Google Drive.', variant: 'success' })
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
      ensInvHydr()
      const resolved = await runDataImport(
        'snapshot',
        result.raw,
        selectPersisted(useAppStore.getState()),
      )
      hydrate(resolved.result.snapshot)
      await waitForNextP()
      saveAppState(resolved.result.snapshot)
      setSnpsRrr(null)
      setSnpsStts(`Imported snapshot from ${result.fileName}.`)
      setCldSyncSt(`Restored the latest Drive backup from ${result.fileName}.`)
      showToast({ content: 'Restored the latest Google Drive snapshot.', variant: 'success' })
      scheduleMeasure()
    } catch (error) {
      setCldSyncSt(null)
      setCldSyncRr(error instanceof Error ? error.message : 'Google Drive restore failed.')
    } finally {
      setCldSyncBu(null)
    }
  }

  const runSnapMprt = async () => {
    const source = snapshotFileRef.current ?? snapshotTextRef.current?.value ?? ''
    if (typeof source === 'string' && !/\S/.test(source)) return

    try {
      setSnpsMprtBu(true)
      setSnpsStts(null)
      setSnpsRrr(null)
      await waitForNextP()
      ensInvHydr()
      const resolved = await runDataImport(
        'snapshot',
        source,
        selectPersisted(useAppStore.getState()),
      )
      hydrate(resolved.result.snapshot)
      await waitForNextP()
      saveAppState(resolved.result.snapshot)
      snapshotFileRef.current = null
      setSnpsFile(null)
      if (snapshotTextRef.current) snapshotTextRef.current.value = ''
      setHasSnpsTxt(false)
      setSnpsRrr(null)
      setSnpsStts(`Imported ${resolved.result.label} into the current app state.`)
      scheduleMeasure()
    } catch (error) {
      setSnpsStts(null)
      setSnpsRrr(error instanceof Error ? error.message : 'Data import failed.')
    } finally {
      setSnpsMprtBu(false)
    }
  }

  const onSnapFileCh = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const header = new Uint8Array(await file.slice(0, 5).arrayBuffer())
      const canShowInline = file.size <= MAX_INLINE_IMPORT_BYTES && !hasWwcbMgc(header)

      if (canShowInline) {
        const raw = await readAppFile(file)
        snapshotFileRef.current = null
        setSnpsFile(null)
        if (snapshotTextRef.current) snapshotTextRef.current.value = raw
        setHasSnpsTxt(raw.length > 0)
      } else {
        snapshotFileRef.current = file
        setSnpsFile({ name: file.name, size: file.size })
        if (snapshotTextRef.current) snapshotTextRef.current.value = ''
        setHasSnpsTxt(false)
      }

      setSnpsStts(null)
      setSnpsRrr(null)
    } catch (error) {
      snapshotFileRef.current = null
      setSnpsFile(null)
      setSnpsStts(null)
      setSnpsRrr(error instanceof Error ? error.message : 'Failed to read that file.')
    } finally {
      event.target.value = ''
    }
  }

  const runLegAppMpr = async () => {
    const source = legacyFileRef.current
    if (!source) return

    try {
      setLgcyMprtBu(true)
      setLgcyMprtS(null)
      setLgcyMprtR(null)
      await waitForNextP()
      const resolved = await runDataImport('legacy', source)
      const result = resolved.result
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
      await waitForNextP()
      saveAppState(result.snapshot)
      legacyFileRef.current = null
      setLgcyMprtFi(null)
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
      showToast({ content: 'Imported legacy v1 backup into the current app state.', variant: 'success' })
      scheduleMeasure()
    } catch (error) {
      setLgcyMprtS(null)
      setLgcyMprtR(error instanceof Error ? error.message : 'Legacy app-state import failed.')
    } finally {
      setLgcyMprtBu(false)
    }
  }

  const onLegFileChn = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    legacyFileRef.current = file
    setLgcyMprtFi({ name: file.name, size: file.size })
    setLgcyMprtS(null)
    setLgcyMprtR(null)
    event.target.value = ''
  }

  const standSlot = (slot: SlotId) => {
    setOpenSlot(slot)
    setThemePref(slot)
    setTheme(slot)
  }

  const pickVariant = (slot: SlotId, variant: ThemeVariant) => {
    if (slot === 'light') setLghtVar(variant as LightThemeVar)
    else if (slot === 'dark') setDarkVar(variant as DarkThemeVar)
    else setBgVar(variant as BgThemeVar)

    if (!following) setTheme(slot)
  }

  const railNote = (id: SectionId): string => {
    if (id === 'look') return THEME_LABELS[pickOf[liveSlot]]
    if (id === 'behavior') return `${switchedOn} of ${switchable.length} on`
    if (id === 'data') return weights ? formatBytes(weights.total) : APP_STORAGE_KEY
    return isGglDrvCnnc ? 'Drive on' : 'Drive off'
  }

  const historyItem = appGroup?.items.find((item) => item.label.startsWith('App History'))

  const renderPrefRow = (item: PrefTglItem) => {
    const beta = item.label === 'Beta Game Data'
    const isHistory = item === historyItem
    const index = HIST_MAX_OPTS.indexOf(ui.historyMax)

    return (
      <SettingRow
        key={item.label}
        name={item.label}
        note={item.description}
        chip={beta ? <span className="cal-chip">reloads the app</span> : null}
      >
        {isHistory && item.checked ? (
          <div className="cal-stepper" role="group" aria-label="History depth">
            <button
              type="button"
              disabled={index <= 0}
              aria-label="Fewer steps"
              onClick={() => setHistMax(HIST_MAX_OPTS[Math.max(0, index - 1)] as HistoryMax)}
            >
              &minus;
            </button>
            <span>{ui.historyMax}</span>
            <button
              type="button"
              disabled={index >= HIST_MAX_OPTS.length - 1}
              aria-label="More steps"
              onClick={() => setHistMax(HIST_MAX_OPTS[Math.min(HIST_MAX_OPTS.length - 1, index + 1)] as HistoryMax)}
            >
              +
            </button>
          </div>
        ) : null}
        <Switch
          id={`cal-sw-${item.label.replace(/\W+/g, '-').toLowerCase()}`}
          on={item.checked}
          label={item.label}
          disabled={item.disabled}
          onChange={item.onChange}
        />
      </SettingRow>
    )
  }

  const shelf = openSlot === 'background'
    ? (
        <>
          <div className="cal-shelf__head">
            <b>Wallpaper</b>
            <span>painted behind the whole app</span>
          </div>
          <div className="cal-walls">
            {BG_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button" className="cal-wall"
                aria-pressed={ui.backgroundImageKey === preset.id}
                title={preset.label}
                onClick={() => { void onBltnBgSel(preset.id) }}
              >
                <span className="cal-wall__art"
                  style={{ '--wall-preview': preset.preview } as CssProps}
                />
              </button>
            ))}
            {isCustomBgKey(ui.backgroundImageKey) && bckgPrvwUrl ? (
              <button
                type="button" className="cal-wall"
                aria-pressed
                title="Your upload"
                onClick={() => setTheme('background')}
              >
                <img src={bckgPrvwUrl} alt="Your wallpaper" />
              </button>
            ) : null}
          </div>
          <button
            type="button" className="cal-btn cal-btn--quiet cal-shelf__own"
            onClick={() => bgUploadModal.show()}
          >
            Use an image of your own
          </button>
        </>
      )
    : (
        <>
          <div className="cal-shelf__head">
            <b>{openSlot === 'light' ? 'Light themes' : 'Dark themes'}</b>
            <span>{THEME_BY_MODE[openSlot].length} to choose from</span>
          </div>
          <div className="cal-shelf__row">
            {THEME_BY_MODE[openSlot].map((variant) => (
              <button
                key={variant}
                type="button" className="cal-card"
                aria-pressed={pickOf[openSlot] === variant}
                title={THEME_LABELS[variant]}
                onClick={() => pickVariant(openSlot, variant)}
              >
                <ThemeInkCard variant={variant} />
              </button>
            ))}
          </div>
        </>
      )

  return (
    <div className="page calibration" ref={pageRef}>
      <div className="cal-hold">
        <CllpPageHeyf
          eyebrow="Configuration"
          title="Calibration"
          subtitle="Set how the calculator looks and behaves, and choose where your data lives."
          layoutKey="calibration-hero"
        />

        <div className="cal-rail">
          <nav className="cal-rail__nav" aria-label="Calibration sections">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button" className="cal-rail__btn"
                data-at={at === section.id ? 'true' : undefined}
                onClick={() => jumpTo(section.id)}
              >
                {section.name}
                <span className="cal-rail__note">{railNote(section.id)}</span>
              </button>
            ))}
          </nav>

          <div className="cal-rail__body">
            <section className="cal-sec" id="cal-look" ref={keepSec('look')}>
              <div className="cal-sech">
                <h2>Look</h2>
                <span>wearing {THEME_LABELS[pickOf[liveSlot]]}</span>
              </div>

              <div className="cal-block">
                <div className="cal-blockh">
                  <h3>Theme</h3>
                  <span>the app holds one pick per mode, so all three keep their own</span>
                </div>

                <div className="cal-slots">
                  {SLOTS.map((slot) => (
                    <button
                      key={slot.id}
                      type="button" className="cal-slot"
                      data-live={!following && liveSlot === slot.id ? 'true' : undefined}
                      data-open={openSlot === slot.id ? 'true' : undefined}
                      aria-pressed={openSlot === slot.id}
                      onClick={() => standSlot(slot.id)}
                    >
                      <ThemeInkCard variant={pickOf[slot.id]} named={false} />
                      <span className="cal-slot__foot">
                        <span className="cal-slot__kind">
                          {slot.kind}
                          {!following && liveSlot === slot.id ? ' · live' : ''}
                        </span>
                        <span className="cal-slot__theme">{THEME_LABELS[pickOf[slot.id]]}</span>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="cal-follow">
                  <div>
                    <b>Follow my device</b>
                    <p className="cal-help">
                      {following
                        ? `On. Your device is ${ui.theme} right now, so ${THEME_LABELS[pickOf[ui.theme === 'light' ? 'light' : 'dark']]} is showing.`
                        : 'Off. The app stays on the mode you picked, whatever your device does.'}
                    </p>
                  </div>
                  <Switch
                    id="cal-sw-follow"
                    on={following}
                    label="Follow my device"
                    onChange={(next) => {
                      if (next) setThemePref('system')
                      else setTheme(liveSlot)
                    }}
                  />
                </div>

                <div className="cal-shelf">{shelf}</div>
              </div>

              <div className="cal-block">
                <div className="cal-blockh">
                  <h3>Body font</h3>
                  <span>the line below is set in each one</span>
                </div>

                <div className="cal-spec">
                  {BODY_FONT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button" className="cal-spec__row"
                      aria-pressed={drftFontName === preset}
                      onClick={() => onFontPrstCh(preset)}
                    >
                      <span className="cal-spec__name">{preset}</span>
                      <span className="cal-spec__line" style={{ fontFamily: makeFontStack(preset) }}>
                        {'hey there cutie patootie~ >ᴗ<'}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="cal-own">
                  <input
                    type="url" className="cal-own__field"
                    value={drftFontUrl}
                    placeholder="Or paste a Google Fonts link"
                    onChange={(event) => onFontUrlChn(event.target.value)}
                  />
                  <button
                    type="button" className="cal-btn"
                    disabled={!fontChanged || !canApplyFont || fontPrvwLdng}
                    onClick={() => { void onApplyTypg() }}
                  >
                    {fontPrvwLdng ? 'Loading...' : 'Use it'}
                  </button>
                </div>
                {!canApplyFont && !fontPrvwLdng ? (
                  <p className="cal-help cal-help--warn">
                    That is not a fonts.googleapis.com link, so it cannot be loaded.
                  </p>
                ) : null}
              </div>

              <div className="cal-block">
                <div className="cal-blockh">
                  <h3>Where uploads live</h3>
                  <span>wallpapers and showcase card images</span>
                </div>

                <div className="cal-opts">
                  <button
                    type="button" className="cal-opt"
                    aria-pressed={ui.preferences.uploadPersist === 'indexeddb'}
                    onClick={() => setUploadPersist('indexeddb')}
                  >
                    <span className="cal-opt__top">
                      <span className="cal-opt__mark" />
                      <b>This device</b>
                    </span>
                    <p>
                      Kept in this browser. Nothing leaves your machine, and nothing else can see
                      them. They do not follow you to another browser.
                    </p>
                  </button>
                  <button
                    type="button" className="cal-opt"
                    aria-pressed={ui.preferences.uploadPersist === 'imgbb'}
                    onClick={() => setUploadPersist('imgbb')}
                  >
                    <span className="cal-opt__top">
                      <span className="cal-opt__mark" />
                      <b>ImgBB</b>
                    </span>
                    <p>
                      Uploaded under your own API key and stored as links, so the same images show
                      up on every device you sign in from.
                    </p>
                  </button>
                </div>

                {ui.preferences.uploadPersist === 'imgbb' ? (
                  <div className="cal-own">
                    <input
                      type="text" className="cal-own__field"
                      placeholder="Paste your ImgBB key"
                      value={ui.preferences.imgbbApiKey}
                      onChange={(event) => setImgbbApiKey(event.target.value)}
                    />
                    <a className="cal-own__link"
                      href="https://imgbb.com/api"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Get a free key
                    </a>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="cal-sec" id="cal-behavior" ref={keepSec('behavior')}>
              <div className="cal-sech">
                <h2>Behavior</h2>
                <span>{switchedOn} of {switchable.length} on</span>
              </div>

              <div className="cal-tracks">
                {[appGroup, calcGroup].map((group) => group ? (
                  <div key={group.title}>
                    <div className="cal-track__head">
                      <h3>{group.title}</h3>
                      <span>{group.description}</span>
                    </div>
                    {group.items.map(renderPrefRow)}
                  </div>
                ) : null)}
              </div>

              {asideItem ? (
                <div className="cal-aside">
                  <div>
                    <b>{asideItem.label}</b>
                    <p className="cal-help">{asideItem.description}</p>
                  </div>
                  <Switch
                    id="cal-sw-aside"
                    on={asideItem.checked}
                    label={asideItem.label}
                    disabled
                  />
                </div>
              ) : null}
            </section>

            <section className="cal-sec" id="cal-data" ref={keepSec('data')}>
              <div className="cal-sech">
                <h2>Data</h2>
                <span>everything the app knows about you</span>
              </div>

              <div className="cal-block">
                <div className="cal-blockh">
                  <h3>Player</h3>
                  <span>the only thing in here that is you rather than bytes</span>
                </div>
                <PlayerPlate />
              </div>

              {weights && weights.total > 0 ? (
                <div className="cal-meter">
                  <div className="cal-meter__bar">
                    {weights.parts.map((part, index) => (
                      <div
                        key={part.name} className="cal-meter__part"
                        title={`${part.name}: ${formatBytes(part.bytes)}`}
                        style={{
                          width: `${(part.bytes / weights.total) * 100}%`,
                          '--part-tint': `${Math.max(14, 92 - index * 17)}%`,
                        } as CssProps}
                      />
                    ))}
                  </div>
                  <div className="cal-meter__keys">
                    {weights.parts.map((part, index) => (
                      <div key={part.name} className="cal-meter__key">
                        <u style={{ '--part-tint': `${Math.max(14, 92 - index * 17)}%` } as CssProps} />
                        <b>{formatBytes(part.bytes)}</b>
                        <span>{part.name}</span>
                      </div>
                    ))}
                  </div>
                  <p className="cal-meter__foot">
                    <span className="cal-num">{formatBytes(weights.total)}</span> in{' '}
                    <span className="cal-num">{APP_STORAGE_KEY}</span>, all of it in this browser.
                  </p>
                </div>
              ) : null}

              <div className="cal-two">
                <div className="cal-stack">
                  <div className="cal-blockh"><h3>Take a copy</h3></div>
                  <div>
                    <button type="button" className="cal-btn" onClick={() => { void onXprtSnap() }}>
                      Export snapshot
                    </button>
                  </div>
                  <p className="cal-help">
                    One file with all of the above in it. Written as{' '}
                    {ui.compressedExports ? '.wwcalc' : 'plain JSON'}.
                  </p>
                  <div className="cal-slices">
                    {DATAXPRTCTNS.map((action) => (
                      <button
                        key={action.kind}
                        type="button" className="cal-slice"
                        onClick={() => { void onXprtDataBn(action.kind) }}
                      >
                        <span>
                          <b>{action.label}</b>
                          <p>{SLICE_NOTES[action.kind]}</p>
                        </span>
                        <em>{weights?.slices[action.kind] ? formatBytes(weights.slices[action.kind]) : ''}</em>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="cal-stack">
                  <div className="cal-blockh"><h3>Bring data in</h3></div>
                  <label className="cal-drop">
                    <input
                      type="file"
                      accept=".json,.wwcalc,application/json"
                      onChange={onSnapFileCh}
                    />
                    <b>Choose a file, or drop one here</b>
                    <span>A full snapshot or any single slice</span>
                  </label>
                  {snapshotFile ? (
                    <p className="cal-note cal-note--ok">
                      Loaded {snapshotFile.name} ({formatBytes(snapshotFile.size)}).
                    </p>
                  ) : null}
                  <div className="cal-or">or paste it</div>
                  <textarea className="cal-paste"
                    ref={snapshotTextRef}
                    rows={5}
                    placeholder="Paste the contents of a snapshot or slice"
                    onChange={(event) => {
                      snapshotFileRef.current = null
                      setSnpsFile(null)
                      setHasSnpsTxt(event.target.value.length > 0)
                      setSnpsStts(null)
                      setSnpsRrr(null)
                    }}
                  />
                  <div className="cal-act">
                    <button
                      type="button" className="cal-btn"
                      disabled={snpsMprtBusy || (!snapshotFile && !hasSnapshotText)}
                      onClick={() => { void runSnapMprt() }}
                    >
                      {snpsMprtBusy ? 'Importing...' : 'Import data'}
                    </button>
                    <p className="cal-help">
                      {snpsMprtBusy
                        ? 'Reading and validating...'
                        : snapshotFile || hasSnapshotText
                        ? 'Ready. You will see what was read once it\'s done.'
                        : 'Nothing to import yet.'}
                    </p>
                  </div>
                  {snpsStts ? <p className="cal-note cal-note--ok">{snpsStts}</p> : null}
                  {snpsRrr ? <p className="cal-note cal-note--bad">{snpsRrr}</p> : null}
                </div>
              </div>
            </section>

            <section className="cal-sec" id="cal-backup" ref={keepSec('backup')}>
              <div className="cal-sech">
                <h2>Backup</h2>
                <span>{isGglDrvCnnc ? 'Drive connected' : 'nothing leaves this browser'}</span>
              </div>

              <div className="cal-two">
                <div className="cal-drive" data-on={isGglDrvCnnc ? 'true' : undefined}>
                  <div className="cal-drive__top">
                    <span className="cal-drive__state">
                      <span className="cal-drive__dot" />
                      <b>{isGglDrvCnnc ? 'Google Drive is on' : 'Google Drive is off'}</b>
                    </span>
                    <Switch
                      id="cal-sw-drive"
                      on={isGglDrvCnnc}
                      label="Google Drive sync"
                      onChange={onCldSyncTgl}
                    />
                  </div>

                  {isGglDrvCnnc ? (
                    <>
                      <div className="cal-drive__lines">
                        {gglDrvUser?.email ? (
                          <div className="cal-drive__line">
                            <span>Signed in as</span>
                            <b>{gglDrvUser.email}</b>
                          </div>
                        ) : null}
                        {weights ? (
                          <div className="cal-drive__line">
                            <span>Snapshot size</span>
                            <b>{formatBytes(weights.total)}</b>
                          </div>
                        ) : null}
                      </div>
                      <div className="cal-drive__acts">
                        <button
                          type="button" className="cal-btn"
                          disabled={cldSyncBusyC !== null}
                          onClick={() => { void onSyncToDrv() }}
                        >
                          {cldSyncBusyC === 'sync' ? 'Syncing...' : 'Sync now'}
                        </button>
                        <button
                          type="button" className="cal-btn cal-btn--quiet"
                          disabled={cldSyncBusyC !== null}
                          onClick={() => confirmation.confirm({
                            title: 'Restore the latest Google Drive backup?',
                            message: 'This will overwrite the current local state with the latest snapshot stored in Google Drive.',
                            confirmLabel: 'Restore backup',
                            cancelLabel: 'Keep local state',
                            variant: 'danger',
                            onConfirm: () => { void onRstrFromDr() },
                          })}
                        >
                          {cldSyncBusyC === 'restore' ? 'Restoring...' : 'Restore latest'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="cal-help">
                      Turn it on to keep a copy of your builds and inventory in your own Drive, and
                      to pick them up on another device. Nothing is uploaded until you do.
                    </p>
                  )}

                  {!isGglDrvCnfg ? (
                    <p className="cal-note cal-note--bad">
                      Google Drive sync needs VITE_GOOGLE_CLIENT_ID, GOOGLE_CLIENT_ID, and
                      GOOGLE_CLIENT_SECRET.
                    </p>
                  ) : null}
                  {gglDrvAuthRr ? <p className="cal-note cal-note--bad">{gglDrvAuthRr}</p> : null}
                  {cldSyncStts ? <p className="cal-note cal-note--ok">{cldSyncStts}</p> : null}
                  {cldSyncRrr ? <p className="cal-note cal-note--bad">{cldSyncRrr}</p> : null}
                </div>

                <div className="cal-stack">
                  <div className="cal-blockh"><h3>Moving from the old app</h3></div>
                  <p className="cal-help">
                    A v1 &quot;All Data&quot; backup can be read here once. Profiles, inventory,
                    builds and settings come across; anything the current app does not recognise is
                    left behind.
                  </p>
                  <label className="cal-legacy">
                    <input
                      type="file"
                      accept=".json,.wwcalc,application/json"
                      onChange={onLegFileChn}
                    />
                    <span>
                      <b>Import a v1 backup</b>
                      <p className="cal-help">.json or .wwcalc</p>
                    </span>
                    <span className="cal-legacy__cue">Choose a file</span>
                  </label>
                  {legacyFile ? (
                    <div className="cal-act">
                      <button
                        type="button" className="cal-btn"
                        disabled={lgcyMprtBusy}
                        onClick={() => { void runLegAppMpr() }}
                      >
                        {lgcyMprtBusy ? 'Importing...' : 'Import legacy backup'}
                      </button>
                      <p className="cal-help">
                        {lgcyMprtBusy
                          ? 'Reading and converting...'
                          : `${legacyFile.name} (${formatBytes(legacyFile.size)}) is ready to read.`}
                      </p>
                    </div>
                  ) : null}
                  {lgcyMprtStts ? <p className="cal-note cal-note--ok">{lgcyMprtStts}</p> : null}
                  {lgcyMprtRrr ? <p className="cal-note cal-note--bad">{lgcyMprtRrr}</p> : null}
                </div>
              </div>

              <div className="cal-risk">
                <b>Delete all local data</b>
                <p>
                  Erases every build, echo, rotation and setting stored in this browser. There is no
                  undo
                  {isGglDrvCnnc
                    ? ', though your Drive backup would survive it.'
                    : ', and there is no backup to come back from.'}
                </p>
                <button
                  type="button" className="cal-btn cal-btn--risk"
                  onClick={() => confirmation.confirm({
                    title: 'Delete all local data? (°⌓ °;)',
                    message: 'This will permanently erase all your saved builds, echoes, rotations, and settings. This cannot be undone. Like for real...',
                    confirmLabel: 'YESSS EVERYTHING!!',
                    cancelLabel: 'I\'ll pass...',
                    variant: 'danger',
                    onConfirm: clearAllData,
                  })}
                >
                  Delete everything
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      <ConfirmHost control={confirmation} portalTarget={portalTarget} />
      <ImageUploadModal
        state={bgUploadModal.dialogProps}
        title="Background image"
        onClose={bgUploadModal.hide}
        onApply={handleBgApply}
      />
    </div>
  )
}
