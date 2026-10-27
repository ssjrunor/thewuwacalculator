/*
  Author: Runor Ewhro
  description: combines application actions and manages persisted mutations, history, hydration, and scenario leases.
*/

import { ensureResonatorData, hasResonatorData, retainResonatorData } from '@/data/gameData'
import { collectResonatorIds, readStoredScenarioIds } from '@/application/persistence/resonatorScope'
import { useTstStr } from '@/shared/util/toastStore'
import {create} from 'zustand'
import { createUiActions } from './uiSlice'
import { createInventoryActions } from './inventorySlice'
import { createScenarioActions } from './scenarioSlice'
import { createResonatorActions } from './resonatorSlice'
import { convertStateRoverGender } from './roverGenderConversion'
import { roverIdForGender } from '@/domain/entities/roverGender'
import { cancelOptimizerRequest, createOptimizerActions } from './optimizerSlice'
import { resetOptimizerRun } from './optimizerRunStore'
import type {
    EnemyProfile,
    SimulationState,
    HistoryMax,
    PckrFreqUpd,
    PersistedState,
    ThemeMode,
    ThemePref,
    UiState,
} from '@/domain/entities/appState'
import type {BgThemeVar, BlurMode, DarkThemeVar, LightThemeVar,} from '@/domain/entities/themes'
import type {
    EchoInstance,
    ResonatorId,
    ResRuntime,
    ResSeed,
    TeamMemRtVie,
} from '@/domain/entities/runtime'
import type { RotationNode } from '@/domain/gameData/contracts'
import {
    type CombatScenario,
    type CombatScenarioId,
    type EnvironmentManualEffect,
    type EnvironmentTargetModifiers,
    type ScenarioTeamMember,
    type TeamMemberId,
} from '@/domain/entities/combatScenario'
import {
    selectedCombatScenario,
} from '@/domain/entities/scenarioLibrary'
import type { ScenarioWorkspace } from '@/domain/entities/scenarioLibrary'
import type { CombatState } from '@/domain/entities/runtime'
import type {
    SavedBuild,
    SavedEcho,
    SavedRotation,
    SavedScenario,
} from '@/domain/entities/inventoryStorage'
import type { ShowcaseCardStyle, ShowcaseCardHidden, ShowcaseLayout, UploadPersistMode } from '@/domain/entities/preferences'
import type { RoverGender } from '@/domain/entities/roverGender'
import type {OptSets} from '@/domain/entities/optimizer'
import type {OptInventorySelection, ResProf} from '@/domain/entities/profile'
import type {SntSetConds} from '@/domain/entities/sonataSetConditionals'
import type {SuggestState, SuggsViewMod, WeaponPlanSet} from '@/domain/entities/suggestions'
import type {
    OptPrgr,
    OptStartPay,
} from '@/engine/optimizer/types'
import {
    makeAppState,
    DEF_RES_ID,
    initAppState,
} from '@/engine/runtime/defaults'
import {
    applyHistoryEntry,
    makeHistoryEntry,
    queueHistoryCompaction,
    retainQueuedHistoryCompactions,
    changedPersistDomains,
    mkMptyHistSt,
    type PrssHistEnt,
    type PrssHistStt,
    resFllbHistL,
    trimHistEnts,
    RUNTIME_APP_HISTORY_ENABLED,
} from '@/application/state/history'
import {
    ALL_DOMAIN_KEYS,
    consumePersist,
    loadPrssInvS,
    markPrssDmns,
    saveAppState,
    type PersistKey,
} from '@/application/persistence/storage'
import {type RslvSystThem} from '@/shared/lib/systemTheme'
import {
    mkNtlAppStt,
} from '@/application/state/storeHelpers'
import {selectPersisted} from '@/application/state/serialization'
import {
    migrateAdvancedScenarioRotations,
    type AdvancedRotationMigration,
} from '@/engine/runtime/advancedRotationMigration.ts'


function applyPrssSna(
  state: AppStore,
  snapshot: PersistedState,
  history: PrssHistStt,
): AppStore {
  return {
    ...state,
    ...initAppState(snapshot),
    invHydr: true,
    savedRotationsHydrated: true,
    history,
  }
}

export interface AppStore extends Omit<PersistedState, 'simulation' | 'combat'> {
  combat: ScenarioWorkspace
  simulation: SimulationState
  // echoes and builds remain resident for saved-status checks.
  invHydr: boolean
  savedRotationsHydrated: boolean
  history: PrssHistStt
  hydrate: (payload: PersistedState) => void
  resetState: () => void
  undo: () => void
  redo: () => void
  undoTo: (index: number) => void
  redoTo: (index: number) => void
  canUndo: () => boolean
  canRedo: () => boolean
  undoHist: () => PrssHistEnt[]
  redoHist: () => PrssHistEnt[]
  ensInvHydr: () => void
  ensureSavedRotations: () => void
  acquireSavedRotationsLease: () => () => void
  ensureFullLibrary: () => void
  flushPrssNow: () => void
  // preference actions wrap persisted ui writes; the action names are short,
  // while the underlying saved ui keys remain unchanged inside each updater.
  setTheme: (theme: ThemeMode) => void
  setThemePref: (themePref: ThemePref) => void
  syncTheme: (theme: RslvSystThem) => void
  setLightVar: (variant: LightThemeVar) => void
  setDarkVar: (variant: DarkThemeVar) => void
  setBgVar: (variant: BgThemeVar) => void
  setBgImgKey: (key: string) => void
  setBgTxtMode: (mode: 'light' | 'dark') => void
  setBodyFont: (fontName: string, fontUrl: string) => void
  setBlurMode: (mode: BlurMode) => void
  setEntrAnim: (enabled: boolean) => void
  setCtxMenu: (enabled: boolean) => void
  setUpdToast: (enabled: boolean) => void
  setGameBetaData: (enabled: boolean) => void
  setRoverGender: (gender: RoverGender) => void
  setRecMenus: (enabled: boolean) => void
  setMaxResInit: (enabled: boolean) => void
  setAnimatedRailPortraits: (enabled: boolean) => void
  commitAppearanceConfig: (updater: (ui: UiState) => UiState) => void
  patchShowcaseCardStyle: (resId: string, patch: Partial<ShowcaseCardStyle>) => void
  toggleShowcaseHide: (resId: string, key: keyof ShowcaseCardHidden) => void
  patchShowcaseCardHidden: (resId: string, patch: Partial<ShowcaseCardHidden>) => void
  resetShowcaseCard: (resId: string) => void
  setShowcaseLayout: (layout: ShowcaseLayout) => void
  setUploadPersist: (mode: UploadPersistMode | null) => void
  setImgbbApiKey: (key: string) => void
  setPlayerIdentity: (playerId: string, playerUid: string) => void
  setEchoImportBands: (bands: UiState['preferences']['echoImportBands']) => void
  setRotationImportPick: (pick: UiState['preferences']['rotationImportPick']) => void
  setSugView: (view: SuggsViewMod) => void
  setSubHits: (enabled: boolean) => void
  setCmpInv: (enabled: boolean) => void
  setGrpInv: (enabled: boolean) => void
  setSeeEqp: (enabled: boolean) => void
  setHistOn: (enabled: boolean) => void
  setHistMax: (max: HistoryMax) => void
  setOptHint: (seen: boolean) => void
  setCmprXprts: (compressed: boolean) => void
  setRotEditorPrefs: (patch: Partial<UiState['rotationEditorPreferences']>) => void
  setRotPrefs: (
      updater: (
          preferences: UiState['savedRotationPreferences'],
      ) => UiState['savedRotationPreferences'],
  ) => void
  setInvOpen: (open: boolean) => void
  setInvEchoQ: (search: string) => void
  migrateAdvancedRotations: () => AdvancedRotationMigration[]
  bumpPickFr: (updates: PckrFreqUpd | PckrFreqUpd[]) => void
  applyScenarioSnapshot: (scenario: CombatScenario) => CombatScenarioId
  commitScenarioConfig: (
    scenarioId: CombatScenarioId,
    updater: (scenario: CombatScenario) => CombatScenario,
    historyLabel?: string,
  ) => void
  selectContextResonator: (resonatorId: ResonatorId) => void
  updateScenarioMember: (
    scenarioId: CombatScenarioId,
    memberId: TeamMemberId,
    updater: (member: ScenarioTeamMember) => ScenarioTeamMember,
  ) => void
  replaceScenarioMember: (scenarioId: CombatScenarioId, memberId: TeamMemberId, member: ScenarioTeamMember) => void
  swapScenarioMembers: (scenarioId: CombatScenarioId, leftMemberId: TeamMemberId, rightMemberId: TeamMemberId) => void
  insertScenarioMember: (scenarioId: CombatScenarioId, index: number, member: ScenarioTeamMember) => void
  removeScenarioMember: (scenarioId: CombatScenarioId, memberId: TeamMemberId) => void
  moveScenarioMember: (scenarioId: CombatScenarioId, memberId: TeamMemberId, index: number) => void
  setScenarioRouting: (
    scenarioId: CombatScenarioId,
    sourceMemberId: TeamMemberId,
    routeId: string,
    targetMemberId: TeamMemberId | null,
  ) => void
  setScenarioTarget: (scenarioId: CombatScenarioId, target: EnemyProfile) => void
  setScenarioCombatState: (scenarioId: CombatScenarioId, combatState: CombatState) => void
  setScenarioInitialOnField: (scenarioId: CombatScenarioId, memberId: TeamMemberId) => void
  setScenarioContextMember: (scenarioId: CombatScenarioId, memberId: TeamMemberId) => void
  upsertEnvironmentManualEffect: (scenarioId: CombatScenarioId, effect: EnvironmentManualEffect) => void
  removeEnvironmentManualEffect: (scenarioId: CombatScenarioId, effectId: string) => void
  setEnvironmentTargetModifiers: (
    scenarioId: CombatScenarioId,
    modifiers: EnvironmentTargetModifiers,
  ) => void
  // resonator actions manage profiles, runtimes, and simulation targets.
  setEnemy: (enemy: EnemyProfile) => void
  setActRes: (resonatorId: ResonatorId) => void
  actRes: (seed: ResSeed) => void
  swRes: (resonatorId: ResonatorId) => void
  delResProf: (resonatorId: ResonatorId, prfrNextResI?: ResonatorId | null) => void
  delResProfs: (resonatorIds: ResonatorId[], prfrNextResI?: ResonatorId | null) => void
  resetRes: (resonatorId: ResonatorId) => void
  loadResProf: (profile: ResProf) => void
  upsertRes: (profiles: ResProf[], historyLabel?: string) => void
  ensResRt: (seed: ResSeed) => void
  ensTeamRt: (seed: ResSeed) => void
  updResRt: (
      resonatorId: ResonatorId,
      updater: (runtime: ResRuntime) => ResRuntime,
  ) => void
  updScenarioResRt: (
      scenarioId: CombatScenarioId,
      resonatorId: ResonatorId,
      updater: (runtime: ResRuntime) => ResRuntime,
  ) => void
  updTeamView: (
      resonatorId: ResonatorId,
      updater: (runtimeView: TeamMemRtVie) => TeamMemRtVie,
  ) => void
  updActRt: (
      updater: (runtime: ResRuntime) => ResRuntime,
  ) => void
  persistRotationProgram: (items: RotationNode[], ranAt?: number) => void
  updResSuggs: (
      resonatorId: ResonatorId,
      updater: (state: SuggestState) => SuggestState,
  ) => void
  updActSuggs: (
      updater: (state: SuggestState) => SuggestState,
  ) => void
  updWpnSuggs: (
      updater: (state: WeaponPlanSet) => WeaponPlanSet,
  ) => void
  updResConds: (
      resonatorId: ResonatorId,
      updater: (state: SntSetConds) => SntSetConds,
  ) => void
  updResOptInv: (
      resonatorId: ResonatorId,
      updater: (state: OptInventorySelection) => OptInventorySelection,
  ) => void
  updActConds: (
      updater: (state: SntSetConds) => SntSetConds,
  ) => void
  setResTgt: (
      resonatorId: ResonatorId,
      ownerKey: string,
      tgtResId: ResonatorId | null,
  ) => void
  addInvEcho: (echo: EchoInstance) => SavedEcho | null
  addInvEchoes: (echoes: EchoInstance[]) => SavedEcho[]
  rplInvEcho: (echoes: EchoInstance[]) => void
  updInvEcho: (entryId: string, echo: EchoInstance) => void
  cleanInvEcho: () => number
  rmInvEcho: (entryId: string) => void
  clrInvEcho: () => void
  // inventory actions keep persisted entry fields descriptive because saved
  // builds and rotations are user data, even though the store methods are short.
  addInvBuild: (input: {
    name?: string
    resonatorId: ResonatorId
    resonatorName: string
    build: {
      weapon: ResRuntime['build']['weapon']
      echoes: Array<EchoInstance | null>
    }
  }) => SavedBuild | null
  updInvBuild: (
      entryId: string,
      changes: Partial<Pick<SavedBuild, 'name'>> & {
        build?: {
          weapon: ResRuntime['build']['weapon']
          echoes: Array<EchoInstance | null>
        }
      },
  ) => void
  rmInvBuild: (entryId: string) => void
  clrInvBuild: () => void
  addInvRot: (input: {
    name?: string
    duration?: number
    note?: string
    scenario: CombatScenario
  }) => SavedRotation | null
  updInvRot: (
      entryId: string,
      changes: Partial<Pick<SavedRotation, 'name' | 'note' | 'duration'>>,
  ) => void
  rmInvRot: (entryId: string) => void
  clrInvRot: () => void
  saveScenario: (input?: {
    scenarioId?: CombatScenarioId
    name?: string
    note?: string
  }) => SavedScenario | null
  updSavedScenario: (
    entryId: string,
    changes: Partial<Pick<SavedScenario, 'name' | 'note'>>,
  ) => void
  rmSavedScenario: (entryId: string) => void
  clrSavedScenarios: () => void
  loadSavedScenario: (entryId: string) => CombatScenarioId | null
  // optimizer actions update optimizer-only settings and run packed workers.
  updOptSets: (
      updater: (settings: OptSets) => OptSets,
      resonatorId?: ResonatorId,
  ) => void
  startOpt: (
      input: OptStartPay,
      hooks?: {
        onProgress?: (progress: OptPrgr) => void
        // optional gate before synchronous compilation; the caller resolves
        // it after its run-start transition settles.
        settle?: () => Promise<unknown>
      },
  ) => void
  cnclOpt: () => void
  clrOptRslt: () => void
  disposeOptResources: () => void
  applyOpt: (index: number) => void
}

// main zustand store
const ntlPrssStt = mkNtlAppStt()
// only complete saved scenarios are evicted. gear is used throughout the app.
const SAVED_ROTATIONS_IDLE_EVICT_MS = 15_000
let savedRotationsLeaseCount = 0
let savedRotationsEvictTimer: number | null = null
export const useAppStore = create<AppStore>((set, get) => {
  const flushPrssNow = () => {
    const dirtyDomains = consumePersist()
    if (dirtyDomains.length > 0) {
      saveAppState(selectPersisted(get()), { domains: dirtyDomains })
    }
  }

  const cancelSavedRotationsEviction = () => {
    if (savedRotationsEvictTimer != null) {
      clearTimeout(savedRotationsEvictTimer)
      savedRotationsEvictTimer = null
    }
  }

  const scheduleSavedRotationsEviction = () => {
    cancelSavedRotationsEviction()
    if (savedRotationsLeaseCount > 0 || typeof window === 'undefined') return
    savedRotationsEvictTimer = window.setTimeout(() => {
      savedRotationsEvictTimer = null
      if (savedRotationsLeaseCount > 0) return
      flushPrssNow()
      set((state) => state.savedRotationsHydrated ? {
        ...state,
        savedRotationsHydrated: false,
        library: { ...state.library, rotations: [], scenarios: [] },
      } : state)
    }, SAVED_ROTATIONS_IDLE_EVICT_MS)
  }

  const rstrPrssSnap = (
    snapshot: PersistedState,
    domains: PersistKey[],
    {
      past,
      future,
    }: {
      past: PrssHistEnt[]
      future: PrssHistEnt[]
    },
  ) => {
    cancelOptimizerRequest()
    resetOptimizerRun()
    set((state) => ({
      ...state,
      ...snapshot,
      savedRotationsHydrated: state.savedRotationsHydrated
        || domains.includes('library.rotations') || domains.includes('library.scenarios'),
      history: { past, future, isRestoring: false },
    }))
    retainQueuedHistoryCompactions(get().history)
    markPrssDmns(domains)
  }

  const resHistLbl = (
    dirtyDomains: PersistKey[],
    options: {
      historyLabel?: string | (() => string)
    },
  ) => {
    const label = typeof options.historyLabel === 'function'
      ? options.historyLabel()
      : options.historyLabel
    return label?.trim() || resFllbHistL(dirtyDomains)
  }

  const undoToHistNd = (index: number) => {
    let state = get()
    if (!RUNTIME_APP_HISTORY_ENABLED || !state.ui.haveHistory || index < 0 || index >= state.history.past.length) {
      return
    }
    const selectedPast = state.history.past.slice(-(index + 1))
    if (!state.savedRotationsHydrated && selectedPast.some((entry) =>
      entry.domains.includes('library.rotations') || entry.domains.includes('library.scenarios'))) {
      state.ensureSavedRotations()
      state = get()
    }

    const steps = index + 1
    let target = selectPersisted(state)
    for (const entry of selectedPast.slice().reverse()) target = applyHistoryEntry(target, entry, false)
    const ids = selectedCombatScenario(target.combat).team.members.map((member) => member.resonatorId)
    if (!hasResonatorData(ids)) {
      const history = state.history.past
      void ensureResonatorData(ids).then(() => {
        if (get().history.past === history) undoToHistNd(index)
      }).catch((error: unknown) => {
        useTstStr.getState().show({ content: error instanceof Error ? error.message : 'Could not load resonator data.', variant: 'error' })
      })
      return
    }
    const nextFuture = [...selectedPast, ...state.history.future]
    rstrPrssSnap(target, [...new Set(selectedPast.flatMap((entry) => entry.domains))], {
      past: state.history.past.slice(0, -steps),
      future: trimHistEnts(nextFuture, state.ui.historyMax, 'earliest'),
    })
  }

  const redoToHistNd = (index: number) => {
    let state = get()
    if (!RUNTIME_APP_HISTORY_ENABLED || !state.ui.haveHistory || index < 0 || index >= state.history.future.length) {
      return
    }
    const selFtr = state.history.future.slice(0, index + 1)
    if (!state.savedRotationsHydrated && selFtr.some((entry) =>
      entry.domains.includes('library.rotations') || entry.domains.includes('library.scenarios'))) {
      state.ensureSavedRotations()
      state = get()
    }

    const steps = index + 1
    let target = selectPersisted(state)
    for (const entry of selFtr) target = applyHistoryEntry(target, entry, true)
    const ids = selectedCombatScenario(target.combat).team.members.map((member) => member.resonatorId)
    if (!hasResonatorData(ids)) {
      const history = state.history.future
      void ensureResonatorData(ids).then(() => {
        if (get().history.future === history) redoToHistNd(index)
      }).catch((error: unknown) => {
        useTstStr.getState().show({ content: error instanceof Error ? error.message : 'Could not load resonator data.', variant: 'error' })
      })
      return
    }
    const nextPast = [...state.history.past, ...selFtr]
    rstrPrssSnap(target, [...new Set(selFtr.flatMap((entry) => entry.domains))], {
      past: trimHistEnts(nextPast, state.ui.historyMax, 'recent'),
      future: state.history.future.slice(steps),
    })
  }

  const pendingDataActions = new Map<string, object>()
  const deferForData = (ids: string[], action: () => void, key?: string): boolean => {
    if (key) pendingDataActions.delete(key)
    if (hasResonatorData(ids)) return false
    const request = {}
    if (key) pendingDataActions.set(key, request)
    void ensureResonatorData(ids).then(() => {
      if (key && pendingDataActions.get(key) !== request) return
      if (key) pendingDataActions.delete(key)
      action()
    }).catch((error: unknown) => {
      if (key && pendingDataActions.get(key) !== request) return
      if (key) pendingDataActions.delete(key)
      useTstStr.getState().show({ content: error instanceof Error ? error.message : 'Could not load resonator data.', variant: 'error' })
    })
    return true
  }

  const scenarioDataIds = (scenarioId: CombatScenarioId): string[] => {
    const descriptor = Object.getOwnPropertyDescriptor(get().combat.scenariosById, scenarioId)
    const recordKey = (descriptor?.get as (() => CombatScenario) & { recordKey?: string } | undefined)?.recordKey
    if (recordKey) return readStoredScenarioIds(recordKey)
    const scenario = descriptor?.value as CombatScenario | undefined
    return scenario?.team.members.map((member) => member.resonatorId) ?? []
  }

  const persistedSet = (
    dirtyDomains: PersistKey[],
    updater: (state: AppStore) => AppStore,
    options: {
      recHist?: boolean
      historyLabel?: string | (() => string)
    } = {},
  ) => {
    set((state) => {
      const next = updater(state)
      if (next !== state && next.combat !== state.combat) {
        const ids = selectedCombatScenario(next.combat).team.members.map((member) => member.resonatorId)
        if (deferForData(ids, () => persistedSet(dirtyDomains, updater, options), 'combat-commit')) return state
        retainResonatorData(ids)
      }
      if (next !== state) {
        const beforePersisted = selectPersisted(state)
        const afterPersisted = selectPersisted(next)
        const changedDomains = changedPersistDomains(beforePersisted, afterPersisted, dirtyDomains)
        if (RUNTIME_APP_HISTORY_ENABLED
          && !state.history.isRestoring
          && state.ui.haveHistory
          && options.recHist !== false) {
          const entry = makeHistoryEntry(beforePersisted, afterPersisted, changedDomains,
            resHistLbl(changedDomains, options))
          if (entry) {
            queueHistoryCompaction(entry)
            next.history = {
              ...state.history,
              past: trimHistEnts([...state.history.past, entry], state.ui.historyMax, 'recent'),
              future: [],
            }
          }
        }
        if (changedDomains.length) markPrssDmns(changedDomains)
      }
      return next
    })
    retainQueuedHistoryCompactions(get().history)
  }

  return ({
  ...ntlPrssStt,
  invHydr: true,
  savedRotationsHydrated: false,
  history: mkMptyHistSt(),

  hydrate: (payload) => {
    const gender = payload.ui.preferences.roverGender
    const ids = collectResonatorIds(payload)
    if (deferForData([...new Set(ids.flatMap((id) => [id, roverIdForGender(id, gender)]))], () => get().hydrate(payload), 'hydrate')) return
    get().ensureFullLibrary()
    const curSnap = selectPersisted(get())
    const nextSnapshot = convertStateRoverGender(initAppState(structuredClone(payload)))
    const { ui } = get()

    cancelOptimizerRequest()
    resetOptimizerRun()
    const importEntry = RUNTIME_APP_HISTORY_ENABLED && ui.haveHistory
      ? makeHistoryEntry(curSnap, nextSnapshot, ALL_DOMAIN_KEYS, 'Imported App State')
      : null
    if (importEntry) queueHistoryCompaction(importEntry)
    set((state) => applyPrssSna(state, nextSnapshot, {
      past: RUNTIME_APP_HISTORY_ENABLED && ui.haveHistory
        ? trimHistEnts([
          ...state.history.past,
          ...(importEntry ? [importEntry] : []),
        ], ui.historyMax, 'recent')
        : [],
      future: [],
      isRestoring: false,
    }))
    retainQueuedHistoryCompactions(get().history)
    retainResonatorData(selectedCombatScenario(get().combat).team.members.map((member) => member.resonatorId))
    markPrssDmns(ALL_DOMAIN_KEYS)
    get().migrateAdvancedRotations()
    scheduleSavedRotationsEviction()
  },

  resetState: () => {
    if (deferForData([DEF_RES_ID], () => get().resetState(), 'selection')) return
    pendingDataActions.clear()
    retainResonatorData([DEF_RES_ID])
    cancelOptimizerRequest()
    resetOptimizerRun()
    set(() => ({
      ...makeAppState(),
      invHydr: true,
      savedRotationsHydrated: false,
      history: mkMptyHistSt(),
    }))
    retainQueuedHistoryCompactions(get().history)
  },

  undo: () => {
    undoToHistNd(0)
  },

  redo: () => {
    redoToHistNd(0)
  },

  undoTo: (index) => {
    undoToHistNd(index)
  },

  redoTo: (index) => {
    redoToHistNd(index)
  },

  canUndo: () => RUNTIME_APP_HISTORY_ENABLED && get().ui.haveHistory && get().history.past.length > 0,
  canRedo: () => RUNTIME_APP_HISTORY_ENABLED && get().ui.haveHistory && get().history.future.length > 0,
  undoHist: () => RUNTIME_APP_HISTORY_ENABLED && get().ui.haveHistory ? get().history.past.slice().reverse() : [],
  redoHist: () => RUNTIME_APP_HISTORY_ENABLED && get().ui.haveHistory ? get().history.future.slice() : [],

  ensInvHydr: () => {
    if (get().invHydr || typeof window === 'undefined') return
    const { echoes, builds } = loadPrssInvS('gear')
    set((state) => ({
      ...state,
      invHydr: true,
      library: { ...state.library, echoes, builds },
    }))
  },

  ensureSavedRotations: () => {
    if (!get().savedRotationsHydrated && typeof window !== 'undefined') {
      const { rotations, scenarios } = loadPrssInvS('saved')
      set((state) => ({
        ...state,
        savedRotationsHydrated: true,
        library: { ...state.library, rotations, scenarios },
      }))
      get().migrateAdvancedRotations()
    }
    scheduleSavedRotationsEviction()
  },

  acquireSavedRotationsLease: () => {
    cancelSavedRotationsEviction()
    savedRotationsLeaseCount += 1
    get().ensureSavedRotations()
    let released = false
    return () => {
      if (released) return
      released = true
      savedRotationsLeaseCount = Math.max(0, savedRotationsLeaseCount - 1)
      scheduleSavedRotationsEviction()
    }
  },

  ensureFullLibrary: () => {
    get().ensInvHydr()
    get().ensureSavedRotations()
  },

  flushPrssNow,

  migrateAdvancedRotations: () => {
    get().ensureSavedRotations()
    let migrations: AdvancedRotationMigration[] = []

    persistedSet(
      ['combat.workspace', 'library.rotations'],
      (state) => {
        const result = migrateAdvancedScenarioRotations(state.library, state.combat)
        migrations = result.migrations
        if (result.library === state.library && result.combat === state.combat) return state

        return {
          ...state,
          combat: result.combat,
          library: result.library,
        }
      },
      {
        historyLabel: 'Migrated Advanced Rotations',
        recHist: false,
      },
    )

    return migrations
  },

  ...createUiActions({ get, persistedSet }),

  ...createScenarioActions({ get, persistedSet, deferForData, scenarioDataIds }),

  ...createResonatorActions({ get, persistedSet, deferForData, scenarioDataIds }),

  ...createInventoryActions({ get, persistedSet }),

  ...createOptimizerActions({ get, persistedSet }),
  })
})
