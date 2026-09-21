/*
  Author: Runor Ewhro
  Description: Owns canonical application state, persisted mutations, scenario
               projections, inventory operations, and optimizer execution state.
*/

import {create} from 'zustand'
import type {
    EnemyProfile,
    SimulationState,
    HistoryMax,
    LeftPaneView,
    PckrFreqUpd,
    PersistedState,
    ThemeMode,
    ThemePref,
    UiState,
} from '@/domain/entities/appState'
import {HIST_MAX_OPTS} from '@/domain/entities/appState'
import type {BgThemeVar, BlurMode, DarkThemeVar, LightThemeVar,} from '@/domain/entities/themes'
import type {
    EchoInstance,
    ResonatorId,
    ResRuntime,
    ResSeed,
    TeamMemRtVie,
} from '@/domain/entities/runtime'
import type { RotationNode } from '@/domain/gameData/contracts'
import { splitScopedTargetOwnerKey } from '@/domain/gameData/targetRouting'
import {
    makeScenarioTeam,
    reviseCombatEnvironment,
    reviseCombatScenario,
    scenarioMemberIndex,
    contextScenarioMember,
    combatScenarioId,
    instantiateCombatScenario,
    type CombatScenario,
    type CombatScenarioId,
    type EnvironmentManualEffect,
    type EnvironmentTargetModifiers,
    type ScenarioTeamMember,
    type TeamMemberId,
} from '@/domain/entities/combatScenario'
import {
    insertScenarioTeamMember,
    removeScenarioTeamMember,
    replaceScenarioTeamMember,
} from '@/engine/runtime/scenarioMembers'
import {
    addScenario,
    replaceScenario,
    scenarioIdForContextResonator,
    selectScenario,
    selectedCombatScenario,
} from '@/domain/entities/scenarioLibrary'
import type { ScenarioWorkspace } from '@/domain/entities/scenarioLibrary'
import type { CombatState, RotationState } from '@/domain/entities/runtime'
import type {
    SavedBuild,
    SavedEcho,
    SavedRotation,
    SavedScenario,
} from '@/domain/entities/inventoryStorage'
import {
    equalBuildSnapshots,
    equalEchoes,
    cloneEchoFor,
    cloneEchoLoadout,
    cloneRotationNodes,
    dedupeEchoUids,
    getEchoSignature,
    makeSavedBuild,
    makeSavedEcho,
    makeSavedRotation,
    makeSavedScenario,
    isEmptyBuild,
    normalizeDuration,
    normalizeRotNote,
} from '@/domain/entities/inventoryStorage'
import { makeEchoUid } from '@/domain/entities/runtime'
import { DEF_SHOWCASE_CARD_STYLE, DEF_SHOWCASE_HIDE } from '@/domain/entities/preferences'
import type { ShowcaseCardStyle, ShowcaseCardHidden, ShowcaseLayout, UploadPersistMode } from '@/domain/entities/preferences'
import type {OptSets} from '@/domain/entities/optimizer'
import type {OptInventorySelection, ResProf} from '@/domain/entities/profile'
import { cloneOptInventorySelection } from '@/domain/entities/profile'
import type {SntSetConds} from '@/domain/entities/sonataSetConditionals'
import type {SuggestState, SuggsViewMod, WeaponPlanSet} from '@/domain/entities/suggestions'
import type {
    OptBckn,
    OptBagResult,
    OptFinalResult,
    OptPrgr,
    OptRawResult,
    OptStartPay,
    OptStts,
    PrepOptPay,
} from '@/engine/optimizer/types'
import {
    cnclActOptWr,
    rstOptWrkrPo,
    runOptWithWr,
} from '@/engine/optimizer/workers/pool'
import {matOptRsltsF, matThryRsltCh} from '@/engine/optimizer/results/materialize.ts'
import {ROT_GPU_JOB, CPU_THEORY_JOB, GPU_THEORY_JOB,} from '@/engine/optimizer/config/constants'
import {errorOpt, logOptimizer} from '@/engine/optimizer/config/log.ts'
import {
    makeAppState,
    makeScenarioMemberFromProfile,
    makeScenarioFromProfiles,
    makeResProfile,
    makeSuggest,
    DEF_RES_ID,
    initAppState,
} from '@/engine/runtime/defaults'
import {
    mkLeftPaneVi,
    mkRtUpdHistL,
    mkTeamMemRtU,
    clonePrssSna,
    mkMptyHistSt,
    mkHistEnt,
    type PrssHistEnt,
    type PrssHistStt,
    resFllbHistL,
    trimHistEnts,
    RUNTIME_APP_HISTORY_ENABLED,
} from '@/application/state/history'
import {
    applyPckrFre,
    mkProfPckrFr,
    mkRtPckrFreq,
    mkTeamMemVie,
} from '@/engine/runtime/pickerFrequency'
import {
    ALL_DOMAIN_KEYS,
    consumePersist,
    loadPrssInvS,
    markPrssDmns,
    saveAppState,
    type PersistKey,
} from '@/application/persistence/storage'
import {
    applyRuntimeToSimulation,
    materializeScenarioRuntime,
    mkTeamMemRtV,
    getActResId,
} from '@/engine/runtime/runtimeAdapters'
import {resSdsById} from '@/data/catalog/resonatorSeedService'
import {getEchoById} from '@/data/catalog/echoCatalogService'
import {cloneResProf, cloneRtSttVl,} from '@/engine/runtime/runtimeCloning'
import {catWpnAtk} from '@/engine/runtime/weaponState'
import { isSimulationSurfaceRoute } from '@/shared/lib/appRoutes'
import {getSystTheme, type RslvSystThem} from '@/shared/lib/systemTheme'
import {
    mkDefMkName,
    mkDefRotName,
    mkNtlAppStt,
    getSuggsSttF,
} from '@/application/state/storeHelpers'
import {
    bgnOptRun,
    compOptPayIn,
    ensOptCompWr,
    inferOptBtch,
    nvldOptRun,
    isOptRunCur,
    matOptRsltsI,
    resOptBtchSi,
    stopOptCompW,
} from '@/application/state/storeOptimizerRuntime'
import {selectPersisted} from '@/application/state/serialization'
import {
    acknowledgeAdvancedRotationMigrations as acknowledgeAdvancedRotationMigrationsState,
    listPendingAdvancedRotationMigrations,
    migrateAdvancedScenarioRotations,
    type AdvancedRotationMigration,
} from '@/engine/runtime/advancedRotationMigration.ts'

const INV_LEFT_PANES = new Set<LeftPaneView>(['echoes', 'teams', 'rotations'])

function mkIdleOptStt(): AppStore['optimizer'] {
  return {
    status: 'idle',
    progress: null,
    results: [],
    error: null,
    batchSize: null,
    resPay: null,
    resultEchoes: [],
  }
}

function applyPrssSna(
  state: AppStore,
  snapshot: PersistedState,
  history: PrssHistStt,
): AppStore {
  return {
    ...state,
    ...initAppState(snapshot),
    invHydr: true,
    optimizer: mkIdleOptStt(),
    history,
  }
}

function applyCombatScenario(
  combat: AppStore['combat'],
  scenario: CombatScenario,
): Pick<AppStore, 'combat'> {
  return { combat: replaceScenario(combat, scenario) }
}

function replaceScenarioInState(
  state: AppStore,
  scenario: CombatScenario,
): AppStore {
  return {
    ...state,
    ...applyCombatScenario(state.combat, scenario),
  }
}

function replaceScenarioInWorkspace(
  state: AppStore,
  scenarioId: CombatScenarioId,
  scenario: CombatScenario,
): AppStore {
  if (!state.combat.scenariosById[scenarioId] || scenario.id !== scenarioId) return state
  return {
    ...state,
    combat: replaceScenario(state.combat, scenario),
  }
}

function nextScenarioId(
  combat: Pick<ScenarioWorkspace, 'scenariosById'>,
): CombatScenarioId {
  let id: CombatScenarioId
  do {
    const suffix = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    id = combatScenarioId(`scenario:${suffix}`)
  } while (combat.scenariosById[id])
  return id
}

function selectScenarioInState(
  state: AppStore,
  scenarioId: CombatScenarioId,
): AppStore {
  const combat = selectScenario(state.combat, scenarioId)
  return {
    ...state,
    combat,
  }
}

function trimHistStt(history: PrssHistStt, max: HistoryMax): PrssHistStt {
  return {
    ...history,
    past: trimHistEnts(history.past, max, 'recent'),
    future: trimHistEnts(history.future, max, 'earliest'),
  }
}

function applyUiFreqP(
    state: AppStore,
    updates: PckrFreqUpd[],
): AppStore {
  if (updates.length === 0) {
    return state
  }

  const activeResonatorId = getActResId(selectedCombatScenario(state.combat))
  const contextualUpdates = updates.map((update): PckrFreqUpd => {
    if (update.activeResonatorId !== undefined) {
      return update
    }

    if (update.bucket === 'resonator' || (update.bucket === 'teamResonator' && update.slot === 'active')) {
      return {
        ...update,
        activeResonatorId: null,
      }
    }

    return {
      ...update,
      activeResonatorId,
    }
  })
  const nextFreq = applyPckrFre(state.ui.itemFreq, contextualUpdates)
  if (nextFreq === state.ui.itemFreq) {
    return state
  }

  return {
    ...state,
    ui: {
      ...state.ui,
      itemFreq: nextFreq,
    },
  }
}

export interface AppStore extends Omit<PersistedState, 'simulation' | 'combat'> {
  combat: ScenarioWorkspace
  simulation: SimulationState
  // store-owned ui flags are intentionally kept out of the persisted snapshot;
  // the short names mark them as local runtime state rather than schema fields.
  invOpen: boolean
  invEchoQ: string
  invMounted: boolean
  invHydr: boolean
  history: PrssHistStt
  // optimizer keeps the compiled payload and result echo rows only for the
  // active browser session, so these keys can stay compact without migrations.
  optimizer: {
    status: OptStts
    progress: OptPrgr | null
    results: Array<OptRawResult | OptFinalResult>
    error: string | null
    batchSize: number | null
    resPay: PrepOptPay | null
    resultEchoes: EchoInstance[]
  }
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
  acquireInvLease: () => () => void
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
  setRecMenus: (enabled: boolean) => void
  setEvaluationStates: (enabled: boolean) => void
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
  setSugView: (view: SuggsViewMod) => void
  setLeftView: (view: LeftPaneView) => void
  openLeftView: (view: LeftPaneView) => void
  setSubHits: (enabled: boolean) => void
  setCmpInv: (enabled: boolean) => void
  setGrpInv: (enabled: boolean) => void
  setSeeEqp: (enabled: boolean) => void
  setHistOn: (enabled: boolean) => void
  setHistMax: (max: HistoryMax) => void
  setOptHint: (seen: boolean) => void
  setOptSprite: (useSprite: boolean) => void
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
  acknowledgeAdvancedRotationMigrations: (entryIds: string[]) => void
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
  setScenarioProgram: (scenarioId: CombatScenarioId, program: RotationState) => void
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
  // resonator actions own profile switching, runtime creation, and
  // target/suggestion updates for the currently selected Simulation context.
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
        // Optional gate before synchronous compilation; the caller resolves
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
const ntlInvHydr =
    (typeof window !== 'undefined' && isSimulationSurfaceRoute(window.location.pathname, 'optimizer'))
    || INV_LEFT_PANES.has(ntlPrssStt.ui.leftPaneView)

const INVENTORY_IDLE_EVICT_MS = 30_000
let inventoryLeaseCount = 0
let inventoryEvictTimer: number | null = null

export const useAppStore = create<AppStore>((set, get) => {
  const flushPrssNow = () => {
    const dirtyDomains = consumePersist()
    if (dirtyDomains.length > 0) {
      saveAppState(selectPersisted(get()), { domains: dirtyDomains })
    }
  }

  const cancelInvEviction = () => {
    if (inventoryEvictTimer != null) {
      clearTimeout(inventoryEvictTimer)
      inventoryEvictTimer = null
    }
  }

  const scheduleInvEviction = () => {
    cancelInvEviction()
    if (inventoryLeaseCount > 0 || typeof window === 'undefined') return
    inventoryEvictTimer = window.setTimeout(() => {
      inventoryEvictTimer = null
      if (inventoryLeaseCount > 0 || get().invOpen) return
      flushPrssNow()
      set((state) => state.invHydr ? {
        ...state,
        invHydr: false,
        library: { echoes: [], builds: [], rotations: [], scenarios: [] },
      } : state)
    }, INVENTORY_IDLE_EVICT_MS)
  }

  const rstrPrssSnap = (
    snapshot: PersistedState,
    {
      past,
      future,
    }: {
      past: PrssHistEnt[]
      future: PrssHistEnt[]
    },
  ) => {
    nvldOptRun()
    stopOptCompW()
    cnclActOptWr()
    set((state) => applyPrssSna(state, snapshot, {
      past,
      future,
      isRestoring: false,
    }))
    markPrssDmns(ALL_DOMAIN_KEYS)
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
    const state = get()
    if (!RUNTIME_APP_HISTORY_ENABLED || !state.ui.haveHistory || index < 0 || index >= state.history.past.length) {
      return
    }

    const curSnap = clonePrssSna(selectPersisted(state))
    const steps = index + 1
    const selectedPast = state.history.past.slice(-steps)
    const tgtSnap = selectedPast[0]?.snapshot

    if (!tgtSnap) {
      return
    }

    const nextFuture = [
      ...selectedPast.map((entry, entryIndex) => mkHistEnt(
        entryIndex < selectedPast.length - 1
          ? selectedPast[entryIndex + 1]!.snapshot
          : curSnap,
        entry.label,
      )),
      ...state.history.future,
    ]

    rstrPrssSnap(tgtSnap, {
      past: state.history.past.slice(0, -steps),
      future: trimHistEnts(nextFuture, state.ui.historyMax, 'earliest'),
    })
  }

  const redoToHistNd = (index: number) => {
    const state = get()
    if (!RUNTIME_APP_HISTORY_ENABLED || !state.ui.haveHistory || index < 0 || index >= state.history.future.length) {
      return
    }

    const curSnap = clonePrssSna(selectPersisted(state))
    const steps = index + 1
    const selFtr = state.history.future.slice(0, steps)
    const tgtSnap = selFtr[selFtr.length - 1]?.snapshot

    if (!tgtSnap) {
      return
    }

    const nextPast = [
      ...state.history.past,
      ...selFtr.map((entry, entryIndex) => mkHistEnt(
        entryIndex === 0
          ? curSnap
          : selFtr[entryIndex - 1]!.snapshot,
        entry.label,
      )),
    ]

    rstrPrssSnap(tgtSnap, {
      past: trimHistEnts(nextPast, state.ui.historyMax, 'recent'),
      future: state.history.future.slice(steps),
    })
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
      if (next !== state) {
        if (RUNTIME_APP_HISTORY_ENABLED
          && !state.history.isRestoring
          && state.ui.haveHistory
          && options.recHist !== false) {
          const curSnap = selectPersisted(state)
            next.history = {
              ...state.history,
              past: trimHistEnts([...state.history.past, mkHistEnt(
                  curSnap,
                  resHistLbl(dirtyDomains, options),
              )], state.ui.historyMax, 'recent'),
              future: [],
          }
        }
        markPrssDmns(dirtyDomains)
      }
      return next
    })
  }

  const bumpPckrFreq = (updates: PckrFreqUpd[]) => {
    if (updates.length === 0) {
      return
    }

    persistedSet(['ui.layout'], (state) => applyUiFreqP(state, updates), {
      recHist: false,
    })
  }

  const psrtResPrflI = (
    profiles: ResProf[],
    historyLabel = profiles.length === 1 ? 'Loaded Resonator Profile' : 'Pasted Resonator Profiles',
  ) => {
    if (profiles.length === 0) {
      return
    }

    persistedSet(['combat.workspace', 'simulation.suggestions', 'ui.layout'], (state) => {
      let workspace: ScenarioWorkspace = state.combat
      let nextSuggsByR = state.simulation.suggestionsByResonatorId

      for (const imported of profiles) {
        const profile = cloneResProf(imported)
        const existingId = scenarioIdForContextResonator(workspace, profile.resonatorId)
        const scenarioId = existingId ?? nextScenarioId(workspace)
        const existingScenario = existingId ? workspace.scenariosById[existingId] : null
        const scenario: CombatScenario = {
          ...makeScenarioFromProfiles(
            { [profile.resonatorId]: profile },
            {
              activeResonatorId: profile.resonatorId,
              enemyProfile: existingScenario?.target ?? selectedCombatScenario(state.combat).target,
            },
            (existingScenario?.revision ?? 0) + 1,
            profile.resonatorId,
          ),
          id: scenarioId,
        }

        if (existingScenario) {
          workspace = replaceScenario(workspace, scenario)
        } else {
          workspace = addScenario(workspace, scenario, false)
        }

        if (!nextSuggsByR[profile.resonatorId]) {
          if (nextSuggsByR === state.simulation.suggestionsByResonatorId) {
            nextSuggsByR = { ...state.simulation.suggestionsByResonatorId }
          }

          nextSuggsByR[profile.resonatorId] = makeSuggest()
        }
      }

      const nextState = {
        ...state,
        combat: workspace,
        simulation: {
          ...state.simulation,
          suggestionsByResonatorId: nextSuggsByR,
        },
      }
      return applyUiFreqP(nextState, mkProfPckrFr(profiles))
    }, { historyLabel })
  }

  const dltResPrflIm = (
    resonatorIds: ResonatorId[],
    prfrNextResI: ResonatorId | null = null,
    historyLabel?: string,
  ) => {
    if (resonatorIds.length === 0) {
      return
    }

    persistedSet([
      'combat.workspace',
      'simulation.suggestions',
    ], (state) => {
      const nextSuggsByR = { ...state.simulation.suggestionsByResonatorId }
      const removedResonatorIds = new Set(resonatorIds)
      const removedScenarioIds = state.combat.order.filter((scenarioId) => {
        const scenario = state.combat.scenariosById[scenarioId]
        const contextId = scenario ? contextScenarioMember(scenario).resonatorId : null
        return Boolean(contextId && removedResonatorIds.has(contextId))
      })
      if (removedScenarioIds.length === 0) return state

      const removedScenarioSet = new Set(removedScenarioIds)
      let order = state.combat.order.filter((scenarioId) => !removedScenarioSet.has(scenarioId))
      const scenariosById = { ...state.combat.scenariosById }
      for (const scenarioId of removedScenarioIds) delete scenariosById[scenarioId]

      if (order.length === 0) {
        const fallbackSeed = resSdsById[DEF_RES_ID]
        if (!fallbackSeed) return state
        const fallbackProfile = makeResProfile(fallbackSeed, {
          maxed: state.ui.preferences.maxResOnInit,
        })
        const fallbackId = nextScenarioId(state.combat)
        const fallbackScenario: CombatScenario = {
          ...makeScenarioFromProfiles(
            { [fallbackSeed.id]: fallbackProfile },
            {
              activeResonatorId: fallbackSeed.id,
              enemyProfile: selectedCombatScenario(state.combat).target,
            },
            0,
            fallbackSeed.id,
          ),
          id: fallbackId,
        }
        scenariosById[fallbackId] = fallbackScenario
        order = [fallbackId]
        nextSuggsByR[fallbackSeed.id] ??= makeSuggest()
      }

      const preferredScenarioId = prfrNextResI
        ? order.find((scenarioId) => (
            contextScenarioMember(scenariosById[scenarioId]).resonatorId === prfrNextResI
          ))
        : null
      const selectedScenarioId = !removedScenarioSet.has(state.combat.selectedScenarioId)
        ? state.combat.selectedScenarioId
        : preferredScenarioId ?? order[0]
      const combat: ScenarioWorkspace = {
        selectedScenarioId,
        order,
        scenariosById,
      }
      const remainingPrimaryIds = new Set(order.map((scenarioId) => (
        contextScenarioMember(scenariosById[scenarioId]).resonatorId
      )))
      for (const resonatorId of removedResonatorIds) {
        if (!remainingPrimaryIds.has(resonatorId)) delete nextSuggsByR[resonatorId]
      }

      return {
        ...state,
        combat,
        simulation: {
          ...state.simulation,
          suggestionsByResonatorId: nextSuggsByR,
        },
      }
    }, {
      historyLabel: historyLabel
        ?? (resonatorIds.length === 1 ? 'Deleted Resonator Profile' : `Deleted ${resonatorIds.length} Resonator Profiles`),
    })
  }

  return ({
  ...ntlPrssStt,
  invOpen: false,
  invEchoQ: '',
  invMounted: false,
  invHydr: ntlInvHydr,
  history: mkMptyHistSt(),
  optimizer: mkIdleOptStt(),

  hydrate: (payload) => {
    const curSnap = selectPersisted(get())
    const nextSnapshot = clonePrssSna(payload)
    const { ui } = get()

    nvldOptRun()
    stopOptCompW()
    cnclActOptWr()
    set((state) => applyPrssSna(state, nextSnapshot, {
      past: RUNTIME_APP_HISTORY_ENABLED && ui.haveHistory
        ? trimHistEnts(
          [...state.history.past, mkHistEnt(curSnap, 'Imported App State')],
          ui.historyMax,
          'recent',
        )
        : [],
      future: [],
      isRestoring: false,
    }))
    markPrssDmns(ALL_DOMAIN_KEYS)
  },

  resetState: () => {
    stopOptCompW()
    cnclActOptWr()
    set(() => ({
      ...makeAppState(),
      invHydr: false,
      history: mkMptyHistSt(),
      optimizer: mkIdleOptStt(),
    }))
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
    if (get().invHydr || typeof window === 'undefined') {
      return
    }

    const inventory = loadPrssInvS()
    set((state) => ({
      ...state,
      invHydr: true,
      library: inventory,
    }))
    scheduleInvEviction()
  },

  acquireInvLease: () => {
    cancelInvEviction()
    inventoryLeaseCount += 1
    get().ensInvHydr()
    let released = false
    return () => {
      if (released) return
      released = true
      inventoryLeaseCount = Math.max(0, inventoryLeaseCount - 1)
      scheduleInvEviction()
    }
  },

  flushPrssNow,

  migrateAdvancedRotations: () => {
    get().ensInvHydr()
    let migrations: AdvancedRotationMigration[] = []

    persistedSet(
      ['combat.workspace', 'library.rotations'],
      (state) => {
        const result = migrateAdvancedScenarioRotations(state.library, state.combat)
        migrations = listPendingAdvancedRotationMigrations(result.library)
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

  acknowledgeAdvancedRotationMigrations: (entryIds) => {
    const ids = new Set(entryIds)
    persistedSet(
      ['library.rotations'],
      (state) => {
        const library = acknowledgeAdvancedRotationMigrationsState(
          state.library,
          ids,
        )
        return library === state.library
          ? state
          : { ...state, library }
      },
      { recHist: false },
    )
  },

  setTheme: (theme) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        theme,
        themePreference: theme,
      },
    }), { historyLabel: 'Changed Theme' })
  },

  setThemePref: (themePref) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        themePreference: themePref,
        theme: themePref === 'system'
          ? getSystTheme()
          : themePref,
      },
    }), { historyLabel: 'Changed Theme Preference' })
  },

  syncTheme: (theme) => {
    persistedSet(['ui.appearance'], (state) => {
      if (state.ui.themePreference !== 'system' || state.ui.theme === theme) {
        return state
      }

      return {
        ...state,
        ui: {
          ...state.ui,
          theme,
        },
      }
    }, { recHist: false })
  },

  setLightVar: (lightVariant) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        lightVariant,
      },
    }), { historyLabel: 'Changed Light Theme Variant' })
  },

  setDarkVar: (darkVariant) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        darkVariant,
      },
    }), { historyLabel: 'Changed Dark Theme Variant' })
  },

  setBgVar: (bgVar) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        backgroundVariant: bgVar,
      },
    }), { historyLabel: 'Changed Background Variant' })
  },

  setBgImgKey: (bgMgKey) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        backgroundImageKey: bgMgKey,
      },
    }), { historyLabel: 'Changed Background Image' })
  },

  setBgTxtMode: (bgTextMode) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        backgroundTextMode: bgTextMode,
      },
    }), { historyLabel: 'Changed Background Text Mode' })
  },

  setBodyFont: (bodyFontName, bodyFontUrl) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        bodyFontName,
        bodyFontUrl,
      },
    }), { historyLabel: 'Changed Body Font' })
  },

  setBlurMode: (blurMode) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        blurMode,
      },
    }), { historyLabel: 'Changed Blur Mode' })
  },

  setEntrAnim: (ntrnNmtn) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        entranceAnimations: ntrnNmtn,
      },
    }), { historyLabel: 'Changed Entrance Animations' })
  },

  setCtxMenu: (ctxMenu) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          ctxMenu,
        },
      },
    }), { historyLabel: 'Changed Context Menu Mode' })
  },

  setUpdToast: (updateToast) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          updateToast,
        },
      },
    }), { historyLabel: 'Changed Update Toast Mode' })
  },

  setGameBetaData: (gameBetaData) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          gameBetaData,
        },
      },
    }), { historyLabel: 'Changed Game Data Mode' })
  },

  setRecMenus: (rcmmMenuTms) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          recommendedMenuItems: rcmmMenuTms,
        },
      },
    }), { historyLabel: 'Changed Recommended Menu Items' })
  },

  setEvaluationStates: (showAllStates) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          showEvaluationStates: showAllStates,
        },
      },
    }), { historyLabel: 'Changed Evaluation State Visibility' })
  },

  setMaxResInit: (maxResOnInit) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          maxResOnInit,
        },
      },
    }), { historyLabel: 'Changed Resonator Init Mode' })
  },

  setAnimatedRailPortraits: (animatedRailPortraits) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          animatedRailPortraits,
        },
      },
    }), { historyLabel: 'Changed Rail Portrait Mode' })
  },

  commitAppearanceConfig: (updater) => {
    persistedSet(['ui.appearance'], (state) => {
      const ui = updater(state.ui)
      return ui === state.ui ? state : { ...state, ui }
    }, { historyLabel: 'Updated Appearance' })
  },

  patchShowcaseCardStyle: (resId, patch) => {
    persistedSet(['ui.layout'], (state) => {
      const cards = state.ui.preferences.showcaseCards
      const current = cards[resId] ?? { style: DEF_SHOWCASE_CARD_STYLE, hidden: DEF_SHOWCASE_HIDE }
      return {
        ...state,
        ui: {
          ...state.ui,
          preferences: {
            ...state.ui.preferences,
            showcaseCards: {
              ...cards,
              [resId]: { ...current, style: { ...current.style, ...patch } },
            },
          },
        },
      }
    }, { recHist: false })
  },

  toggleShowcaseHide: (resId, key) => {
    persistedSet(['ui.layout'], (state) => {
      const cards = state.ui.preferences.showcaseCards
      const current = cards[resId] ?? { style: DEF_SHOWCASE_CARD_STYLE, hidden: DEF_SHOWCASE_HIDE }
      return {
        ...state,
        ui: {
          ...state.ui,
          preferences: {
            ...state.ui.preferences,
            showcaseCards: {
              ...cards,
              [resId]: { ...current, hidden: { ...current.hidden, [key]: !current.hidden[key] } },
            },
          },
        },
      }
    }, { recHist: false })
  },

  patchShowcaseCardHidden: (resId, patch) => {
    persistedSet(['ui.layout'], (state) => {
      const cards = state.ui.preferences.showcaseCards
      const current = cards[resId] ?? { style: DEF_SHOWCASE_CARD_STYLE, hidden: DEF_SHOWCASE_HIDE }
      return {
        ...state,
        ui: {
          ...state.ui,
          preferences: {
            ...state.ui.preferences,
            showcaseCards: {
              ...cards,
              [resId]: { ...current, hidden: { ...current.hidden, ...patch } },
            },
          },
        },
      }
    }, { recHist: false })
  },

  resetShowcaseCard: (resId) => {
    persistedSet(['ui.layout'], (state) => {
      const cards = state.ui.preferences.showcaseCards
      if (!(resId in cards)) return state
      const next = { ...cards }
      delete next[resId]
      return {
        ...state,
        ui: {
          ...state.ui,
          preferences: { ...state.ui.preferences, showcaseCards: next },
        },
      }
    }, { recHist: false })
  },

  setShowcaseLayout: (showcaseLayout) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: { ...state.ui.preferences, showcaseLayout },
      },
    }), { recHist: false })
  },

  setUploadPersist: (uploadPersist) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: { ...state.ui.preferences, uploadPersist },
      },
    }), { recHist: false })
  },

  setImgbbApiKey: (imgbbApiKey) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: { ...state.ui.preferences, imgbbApiKey },
      },
    }), { recHist: false })
  },

  setPlayerIdentity: (playerId, playerUid) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          playerId: playerId.trim(),
          playerUid: playerUid.trim(),
        },
      },
    }), { recHist: false })
  },

  setSugView: (suggsViewMode) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        suggsViewMode,
      },
    }), { historyLabel: 'Changed Suggestions View' })
  },

  setLeftView: (leftPaneView) => {
    if (INV_LEFT_PANES.has(leftPaneView)) {
      get().ensInvHydr()
    }

    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        leftPaneView,
      },
    }), { historyLabel: 'Changed Left Pane View' })
  },

  openLeftView: (leftPaneView) => {
    if (INV_LEFT_PANES.has(leftPaneView)) {
      get().ensInvHydr()
    }

    persistedSet(['ui.layout'], (state) => {
      if (state.ui.leftPaneView === leftPaneView) {
        return state
      }

      return {
        ...state,
        ui: {
          ...state.ui,
          leftPaneView,
        },
      }
    }, { historyLabel: mkLeftPaneVi(leftPaneView) })
  },

  setSubHits: (showSubHits) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        showSubHits,
      },
    }), { historyLabel: 'Updated Sub-Hit Visibility' })
  },

  setCmpInv: (compactInv) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        compactInv,
      },
    }), { historyLabel: 'Toggled Compact Inventory', recHist: false })
  },

  setGrpInv: (groupInv) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        groupInv,
      },
    }), { historyLabel: 'Toggled Inventory Grouping', recHist: false })
  },

  setSeeEqp: (seeEquipped) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        seeEquipped,
      },
    }), { historyLabel: 'Toggled Equipped Items', recHist: false })
  },

  setHistOn: (haveHistory) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        haveHistory,
      },
      history: haveHistory
        ? state.history
        : {
          ...state.history,
          past: [],
          future: [],
        },
    }), { historyLabel: 'Toggled History', recHist: false })
  },

  setHistMax: (historyMax) => {
    const nextHistMax = HIST_MAX_OPTS.includes(historyMax) ? historyMax : 10
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        historyMax: nextHistMax,
      },
      history: trimHistStt(state.history, nextHistMax),
    }), { historyLabel: 'Changed History Capacity', recHist: false })
  },

  setOptHint: (optCpuHintSe) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        optimizerCpuHintSeen: optCpuHintSe,
      },
    }))
  },

  setOptSprite: (useSprite) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        optimizerUseSprite: useSprite,
      },
    }))
  },

  setCmprXprts: (compressed) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        compressedExports: compressed,
      },
    }))
  },

  setRotEditorPrefs: (patch) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        rotationEditorPreferences: {
          ...state.ui.rotationEditorPreferences,
          ...patch,
        },
      },
    }), { recHist: false })
  },

  setRotPrefs: (updater) => {
    persistedSet(['ui.savedRotationPreferences'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        savedRotationPreferences: updater(state.ui.savedRotationPreferences),
      },
    }), { historyLabel: 'Updated Saved Rotation Preferences' })
  },

  setInvOpen: (invOpen) => {
    if (invOpen) {
      get().ensInvHydr()
    }

    set((state) => ({
      ...state,
      invOpen: invOpen,
      invMounted: state.invMounted || invOpen,
    }))
  },

  setInvEchoQ: (invEchoSrch) => {
    set((state) => ({
      ...state,
      invEchoQ: invEchoSrch,
    }))
  },

  bumpPickFr: (updates) => {
    bumpPckrFreq(Array.isArray(updates) ? updates : [updates])
  },

  applyScenarioSnapshot: (source) => {
    const contextResonatorId = contextScenarioMember(source).resonatorId
    const current = get()
    const existingId = scenarioIdForContextResonator(current.combat, contextResonatorId)
    const id = existingId ?? nextScenarioId(current.combat)
    persistedSet(['combat.workspace'], (state) => {
      const latestId = scenarioIdForContextResonator(state.combat, contextResonatorId)
      const targetId = latestId ?? id
      const scenario = instantiateCombatScenario(source, targetId)
      const combat = latestId
        ? replaceScenario(state.combat, scenario)
        : addScenario(state.combat, scenario)
      return {
        ...state,
        combat: selectScenario(combat, targetId),
      }
    }, { historyLabel: existingId ? 'Loaded Scenario' : 'Added Context Scenario' })
    return id
  },

  commitScenarioConfig: (scenarioId, updater, historyLabel = 'Updated Configuration') => {
    persistedSet(['combat.workspace'], (state) => {
      const current = state.combat.scenariosById[scenarioId]
      if (!current) return state

      const next = updater(current)
      if (next === current) return state

      return replaceScenarioInWorkspace(state, scenarioId, {
        ...next,
        id: scenarioId,
        revision: current.revision + 1,
      })
    }, { historyLabel })
  },

  selectContextResonator: (resonatorId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenarioId = scenarioIdForContextResonator(state.combat, resonatorId)
      if (!scenarioId || scenarioId === state.combat.selectedScenarioId) return state
      return selectScenarioInState(state, scenarioId)
    }, { historyLabel: 'Changed Context Resonator' })
  },

  updateScenarioMember: (scenarioId, memberId, updater) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const index = scenarioMemberIndex(scenario, memberId)
      if (index < 0) return state
      const previous = scenario.team.members[index]
      const next = updater(structuredClone(previous))
      if (next === previous || next.id !== previous.id) return state
      const members = [...scenario.team.members]
      members[index] = next
      let team: CombatScenario['team']
      try {
        team = makeScenarioTeam(members)
      } catch {
        return state
      }
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatScenario(scenario, { team }))
    }, { historyLabel: 'Updated Team Member' })
  },

  replaceScenarioMember: (scenarioId, memberId, member) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const next = replaceScenarioTeamMember(scenario, memberId, member)
      return next === scenario ? state : replaceScenarioInWorkspace(state, scenarioId, next)
    }, { historyLabel: 'Updated Team Member' })
  },

  swapScenarioMembers: (scenarioId, leftMemberId, rightMemberId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const left = scenarioMemberIndex(scenario, leftMemberId)
      const right = scenarioMemberIndex(scenario, rightMemberId)
      if (left < 0 || right < 0 || left === right) return state
      const members = [...scenario.team.members]
      ;[members[left], members[right]] = [members[right], members[left]]
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatScenario(scenario, {
        team: makeScenarioTeam(members),
      }))
    }, { historyLabel: 'Swapped Team Members' })
  },

  insertScenarioMember: (scenarioId, index, member) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const next = insertScenarioTeamMember(scenario, index, member)
      return next === scenario ? state : replaceScenarioInWorkspace(state, scenarioId, next)
    }, { historyLabel: 'Added Team Member' })
  },

  removeScenarioMember: (scenarioId, memberId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const next = removeScenarioTeamMember(scenario, memberId)
      return next === scenario ? state : replaceScenarioInWorkspace(state, scenarioId, next)
    }, { historyLabel: 'Removed Team Member' })
  },

  moveScenarioMember: (scenarioId, memberId, index) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const from = scenarioMemberIndex(scenario, memberId)
      if (from < 0) return state
      const to = Math.max(0, Math.min(index, scenario.team.members.length - 1))
      if (from === to) return state
      const members = [...scenario.team.members]
      const [member] = members.splice(from, 1)
      members.splice(to, 0, member)
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatScenario(scenario, {
        team: makeScenarioTeam(members),
      }))
    }, { historyLabel: 'Reordered Team' })
  },

  setScenarioRouting: (scenarioId, sourceMemberId, routeId, targetMemberId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const ids = new Set(scenario.team.members.map((member) => member.id))
      if (!ids.has(sourceMemberId) || (targetMemberId !== null && !ids.has(targetMemberId))) {
        return state
      }
      const current = scenario.environment.routing.bySourceMemberId[sourceMemberId]?.[routeId] ?? null
      if (current === targetMemberId) return state
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatEnvironment(scenario, {
        routing: {
          bySourceMemberId: {
            ...scenario.environment.routing.bySourceMemberId,
            [sourceMemberId]: {
              ...scenario.environment.routing.bySourceMemberId[sourceMemberId],
              [routeId]: targetMemberId,
              },
            },
          },
      }))
    }, { historyLabel: 'Updated Target Selection' })
  },

  setScenarioProgram: (scenarioId, program) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      return scenario ? replaceScenarioInWorkspace(
      state, scenarioId,
      reviseCombatScenario(scenario, {
        program: structuredClone(program),
      }),
      ) : state
    }, { historyLabel: 'Updated Rotation' })
  },

  setScenarioTarget: (scenarioId, target) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      return scenario ? replaceScenarioInWorkspace(
      state, scenarioId,
      reviseCombatScenario(scenario, {
        target: structuredClone(target),
      }),
      ) : state
    }, { historyLabel: 'Updated Combat Target' })
  },

  setScenarioCombatState: (scenarioId, combatState) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      return scenario ? replaceScenarioInWorkspace(
      state, scenarioId,
      reviseCombatEnvironment(scenario, {
        combatState: structuredClone(combatState),
      }),
      ) : state
    }, { historyLabel: 'Updated Combat State' })
  },

  setScenarioInitialOnField: (scenarioId, memberId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      if (!scenario.team.members.some((member) => member.id === memberId)
        || scenario.initialOnFieldMemberId === memberId) return state
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatScenario(scenario, {
        initialOnFieldMemberId: memberId,
      }))
    }, { historyLabel: 'Changed Initial On-field Member' })
  },

  setScenarioContextMember: (scenarioId, memberId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      if (scenario.contextMemberId === memberId
        || !scenario.team.members.some((member) => member.id === memberId)) return state
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatScenario(scenario, {
        contextMemberId: memberId,
      }))
    }, { historyLabel: 'Changed Scenario Context Member' })
  },

  upsertEnvironmentManualEffect: (scenarioId, effect) => {
    if (!effect.id.trim()) return
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      if (effect.selector.kind === 'members') {
        const members = new Set(scenario.team.members.map((member) => member.id))
        if (effect.selector.memberIds.length === 0
          || effect.selector.memberIds.some((id) => !members.has(id))) return state
      }
      const manualEffects = [...scenario.environment.manualEffects]
      const index = manualEffects.findIndex((candidate) => candidate.id === effect.id)
      const nextEffect = structuredClone(effect)
      if (index >= 0) manualEffects[index] = nextEffect
      else manualEffects.push(nextEffect)
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatEnvironment(scenario, {
        manualEffects,
      }))
    }, { historyLabel: 'Updated Environment Effect' })
  },

  removeEnvironmentManualEffect: (scenarioId, effectId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const manualEffects = scenario.environment.manualEffects.filter(
        (effect) => effect.id !== effectId,
      )
      if (manualEffects.length === scenario.environment.manualEffects.length) return state
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatEnvironment(scenario, {
        manualEffects,
      }))
    }, { historyLabel: 'Removed Environment Effect' })
  },

  setEnvironmentTargetModifiers: (scenarioId, modifiers) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      return scenario ? replaceScenarioInWorkspace(
      state, scenarioId,
      reviseCombatEnvironment(scenario, {
        targetModifiers: structuredClone(modifiers),
      }),
      ) : state
    }, { historyLabel: 'Updated Target Modifiers' })
  },

  setEnemy: (enemyProfile) => {
    persistedSet(['combat.workspace', 'ui.layout'], (state) => {
      const scenario = selectedCombatScenario(state.combat)
      const nextState = replaceScenarioInState(state, reviseCombatScenario(scenario, {
        target: enemyProfile,
      }))

      return enemyProfile.id && enemyProfile.id !== scenario.target.id
        ? applyUiFreqP(nextState, [{
          bucket: 'enemy',
          ids: [enemyProfile.id],
        }])
        : nextState
    }, { historyLabel: 'Updated Enemy Profile' })
  },

  setActRes: (resonatorId) => {
    if (getActResId(selectedCombatScenario(get().combat)) === resonatorId) {
      return
    }

    persistedSet(['combat.workspace', 'ui.layout'], (state) => {
      const scenarioId = scenarioIdForContextResonator(state.combat, resonatorId)
      if (!scenarioId) return state
      return applyUiFreqP(selectScenarioInState(state, scenarioId), [
      {
        bucket: 'resonator',
        ids: [resonatorId],
      },
      {
        bucket: 'teamResonator',
        slot: 'active',
        ids: [resonatorId],
      },
      ])
    }, { historyLabel: 'Changed Active Resonator' })
  },

  actRes: (seed) => {
    persistedSet(['combat.workspace', 'simulation.suggestions', 'ui.layout'], (state) => {
      const existingScenarioId = scenarioIdForContextResonator(state.combat, seed.id)
      if (existingScenarioId === state.combat.selectedScenarioId) {
        return state
      }
      let nextState: AppStore
      if (existingScenarioId) {
        nextState = selectScenarioInState(state, existingScenarioId)
      } else {
        const profile = makeResProfile(seed, { maxed: state.ui.preferences.maxResOnInit })
        const scenarioId = nextScenarioId(state.combat)
        const scenario: CombatScenario = {
          ...makeScenarioFromProfiles(
            { [seed.id]: profile },
            {
              activeResonatorId: seed.id,
              enemyProfile: selectedCombatScenario(state.combat).target,
            },
            0,
            seed.id,
          ),
          id: scenarioId,
        }
        const combat = addScenario(state.combat, scenario)
        nextState = {
          ...state,
          combat,
        }
      }

      nextState = {
        ...nextState,
        simulation: {
          ...nextState.simulation,
          suggestionsByResonatorId: nextState.simulation.suggestionsByResonatorId[seed.id]
            ? nextState.simulation.suggestionsByResonatorId
            : {
              ...nextState.simulation.suggestionsByResonatorId,
              [seed.id]: makeSuggest(),
            },
        },
      }

      return applyUiFreqP(nextState, [
        {
          bucket: 'resonator',
          ids: [seed.id],
        },
        {
          bucket: 'teamResonator',
          slot: 'active',
          ids: [seed.id],
        },
      ])
    }, {
      historyLabel: scenarioIdForContextResonator(get().combat, seed.id)
        ? 'Changed Active Resonator'
        : 'Added Resonator Profile',
    })
  },

  swRes: (resonatorId) => {
    const seed = resSdsById[resonatorId]
    if (!seed) return
    get().actRes(seed)
  },

  delResProf: (resonatorId, prfrNextResI = null) => {
    dltResPrflIm([resonatorId], prfrNextResI, 'Deleted Resonator Profile')
  },

  delResProfs: (resonatorIds, prfrNextResI = null) => {
    dltResPrflIm(resonatorIds, prfrNextResI)
  },

  resetRes: (resonatorId) => {
    const seed = resSdsById[resonatorId]
    if (!seed) return

    persistedSet(['combat.workspace'], (state) => {
      const profile = makeResProfile(seed, { maxed: state.ui.preferences.maxResOnInit })
      const scenario = selectedCombatScenario(state.combat)
      const memberIndex = scenario.team.members.findIndex(
        (member) => member.resonatorId === resonatorId,
      )
      const members = [...scenario.team.members]
      if (memberIndex >= 0) {
        members[memberIndex] = makeScenarioMemberFromProfile(profile)
      }

      return memberIndex >= 0
        ? replaceScenarioInState(state, reviseCombatScenario(scenario, { team: makeScenarioTeam(members) }))
        : state
    }, { historyLabel: 'Reset Resonator' })
  },

  loadResProf: (profile) => {
    psrtResPrflI([profile], 'Loaded Resonator Profile')
  },

  upsertRes: (profiles, historyLabel) => {
    psrtResPrflI(profiles, historyLabel)
  },

  ensResRt: (seed) => {
    if (get().simulation.suggestionsByResonatorId[seed.id]) return

    persistedSet(['simulation.suggestions'], (state) => ({
      ...state,
      simulation: {
        ...state.simulation,
        suggestionsByResonatorId: state.simulation.suggestionsByResonatorId[seed.id]
            ? state.simulation.suggestionsByResonatorId
            : {
              ...state.simulation.suggestionsByResonatorId,
              [seed.id]: makeSuggest(),
            },
      },
    }), { historyLabel: 'Added Resonator Profile' })
  },

  ensTeamRt: (seed) => {
    void seed
    // no-op: team member runtimes are created when the teammate is actually assigned to a slot
    // this stays as a stable api for callers that previously ensured a profile existed
  },

  updScenarioResRt: (scenarioId, resonatorId, updater) => {
    const scenario = get().combat.scenariosById[scenarioId]
    if (!scenario) return

    const target = materializeScenarioRuntime(scenario, resonatorId)
    if (!target) return

    const next = updater(target)
    if (next === target) return

    const pickerUpdates = mkRtPckrFreq(target, next)
    persistedSet(
      pickerUpdates.length > 0 ? ['combat.workspace', 'ui.layout'] : ['combat.workspace'],
      (state) => {
      const currentScenario = state.combat.scenariosById[scenarioId]
      if (!currentScenario) return state
      const update = applyRuntimeToSimulation(currentScenario, resonatorId, next)
      return applyUiFreqP(replaceScenarioInState(
        state,
        update.scenario,
      ), pickerUpdates)
      }, {
        historyLabel: () => mkRtUpdHistL(target, next),
      },
    )
  },

  updResRt: (resonatorId, updater) => {
    get().updScenarioResRt(get().combat.selectedScenarioId, resonatorId, updater)
  },

  updTeamView: (resonatorId, updater) => {
    const target = mkTeamMemRtV(selectedCombatScenario(get().combat), resonatorId)
    if (!target) return

    const next = updater(target)
    if (next === target) return

    const actRt = materializeScenarioRuntime(selectedCombatScenario(get().combat), resonatorId)
    if (!actRt) {
      return
    }

    const brdgRt: ResRuntime = {
      ...actRt,
      base: {
        ...actRt.base,
        sequence: next.base.sequence,
      },
      build: {
        ...actRt.build,
        weapon: catWpnAtk({
          ...actRt.build.weapon,
          id: next.build.weapon.id,
          rank: next.build.weapon.rank,
        }),
        echoes: next.build.echoes,
      },
      state: cloneRtSttVl(next.state),
    }

    persistedSet(['combat.workspace', 'ui.layout'], (state) => {
      const update = applyRuntimeToSimulation(selectedCombatScenario(state.combat), resonatorId, brdgRt)
      return applyUiFreqP(replaceScenarioInState(
        state,
        update.scenario,
      ), mkTeamMemVie(resonatorId, target, next))
    }, {
      historyLabel: mkTeamMemRtU(target, next),
    })
  },

  updActRt: (updater) => {
    const actResId = getActResId(selectedCombatScenario(get().combat))
    if (!actResId) return
    get().updResRt(actResId, updater)
  },

  persistRotationProgram: (items, ranAt = Date.now()) => {
    const actResId = getActResId(selectedCombatScenario(get().combat))
    const target = actResId
      ? materializeScenarioRuntime(selectedCombatScenario(get().combat), actResId)
      : null
    if (!actResId || !target) return

    const nextItems = cloneRotationNodes(items)
    const nextRanAt = Number.isFinite(ranAt) ? ranAt : Date.now()
    if (
      target.rotation.lastRanAt === nextRanAt
      && JSON.stringify(target.rotation.program) === JSON.stringify(nextItems)
    ) {
      return
    }

    const nextRuntime: ResRuntime = {
      ...target,
      rotation: {
        ...target.rotation,
        program: nextItems,
        lastRanAt: nextRanAt,
      },
    }
    persistedSet(['combat.workspace'], (state) => {
      const update = applyRuntimeToSimulation(
        selectedCombatScenario(state.combat),
        actResId,
        nextRuntime,
      )
      return update.scenario === selectedCombatScenario(state.combat)
        ? state
        : replaceScenarioInState(
          state,
          update.scenario,
        )
    }, { historyLabel: 'Ran Rotation' })
  },

  updResSuggs: (resonatorId, updater) => {
    persistedSet(['simulation.suggestions'], (state) => ({
      ...state,
      simulation: {
        ...state.simulation,
        suggestionsByResonatorId: {
          ...state.simulation.suggestionsByResonatorId,
          [resonatorId]: updater(getSuggsSttF(state, resonatorId)),
        },
      },
    }), { historyLabel: 'Updated Suggestions' })
  },

  updActSuggs: (updater) => {
    const actResId = getActResId(selectedCombatScenario(get().combat))
    if (!actResId) return
    get().updResSuggs(actResId, updater)
  },

  updWpnSuggs: (updater) => {
    persistedSet(['simulation.suggestions'], (state) => ({
      ...state,
      simulation: {
        ...state.simulation,
        weaponSuggests: updater(state.simulation.weaponSuggests),
      },
    }), { historyLabel: 'Updated Weapon Suggestions' })
  },

  updResConds: (resonatorId, updater) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = selectedCombatScenario(state.combat)
      const memberIndex = scenario.team.members.findIndex(
        (member) => member.resonatorId === resonatorId,
      )
      const source = memberIndex >= 0
        ? scenario.team.members[memberIndex].local.setConditionals
        : null
      if (!source) return state
      const nextConditions = updater(source)
      const members = [...scenario.team.members]
      if (memberIndex >= 0) {
        members[memberIndex] = {
          ...members[memberIndex],
          local: { ...members[memberIndex].local, setConditionals: nextConditions },
        }
      }

      return replaceScenarioInState(state, reviseCombatScenario(scenario, {
        team: makeScenarioTeam(members),
      }))
    }, { historyLabel: 'Updated Set Conditionals' })
  },

  updResOptInv: (resonatorId, updater) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = selectedCombatScenario(state.combat)
      const memberIndex = scenario.team.members.findIndex(
        (member) => member.resonatorId === resonatorId,
      )
      const source = memberIndex >= 0
        ? scenario.team.members[memberIndex].local.optimizerInventory
        : null
      if (!source) return state
      const nextInventory = cloneOptInventorySelection(updater(source))
      const members = [...scenario.team.members]
      if (memberIndex >= 0) {
        members[memberIndex] = {
          ...members[memberIndex],
          local: { ...members[memberIndex].local, optimizerInventory: nextInventory },
        }
      }

      return replaceScenarioInState(state, reviseCombatScenario(scenario, {
        team: makeScenarioTeam(members),
      }))
    }, { historyLabel: 'Updated Optimizer Inventory' })
  },

  updActConds: (updater) => {
    const actResId = getActResId(selectedCombatScenario(get().combat))
    if (!actResId) return
    get().updResConds(actResId, updater)
  },

  setResTgt: (resonatorId, ownerKey, tgtResId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = selectedCombatScenario(state.combat)
      const sourceMember = scenario.team.members.find(
        (member) => member.resonatorId === resonatorId,
      )
      const targetMember = tgtResId
        ? scenario.team.members.find((member) => member.resonatorId === tgtResId) ?? null
        : null
      if (!sourceMember || (tgtResId && !targetMember)) return state
      const routeId = splitScopedTargetOwnerKey(ownerKey).ownerKey

      const bySourceMemberId = {
        ...scenario.environment.routing.bySourceMemberId,
        [sourceMember.id]: {
          ...scenario.environment.routing.bySourceMemberId[sourceMember.id],
          [routeId]: targetMember?.id ?? null,
        },
      }

      return replaceScenarioInState(state, reviseCombatEnvironment(scenario, {
        routing: { bySourceMemberId },
      }))
    }, { historyLabel: 'Updated Target Selection' })
  },

  addInvEcho: (echo) => {
    get().ensInvHydr()
    const invChs = get().library.echoes
    const existing = invChs.find((entry) =>
        equalEchoes(entry.echo, echo),
    )

    if (existing) {
      return null
    }

    // a uid identifies one physical echo, so a new entry takes a fresh uid when
    // the incoming echo's uid already belongs to another bag entry.
    const uidTaken = echo.uid != null
      && invChs.some((entry) => entry.echo.uid === echo.uid)
    const nextEntry = makeSavedEcho(uidTaken ? { ...echo, uid: makeEchoUid() } : echo)
    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: [...state.library.echoes, nextEntry],
      },
    }), { historyLabel: 'Added Inventory Echo' })

    return nextEntry
  },

  addInvEchoes: (echoes) => {
    get().ensInvHydr()
    if (echoes.length === 0) {
      return []
    }

    const invChs = get().library.echoes
    // De-dupe by semantic echo signature before touching UIDs. A pasted/team
    // batch can contain old UIDs from equipped echoes; identical stat payloads
    // should be skipped, while distinct payloads with colliding UIDs get fresh
    // identity below.
    const knownEchoSigs = new Set(invChs.map((entry) => getEchoSignature(entry.echo)))
    const knownUids = new Set(invChs.map((entry) => entry.echo.uid).filter((uid): uid is string => Boolean(uid)))
    const echoesToAdd: EchoInstance[] = []

    for (const echo of echoes) {
      if (!getEchoById(echo.id)) {
        continue
      }

      const echoSig = getEchoSignature(echo)
      if (knownEchoSigs.has(echoSig)) {
        continue
      }

      let nextEcho = echo
      if (echo.uid != null && knownUids.has(echo.uid)) {
        // Keep generating until the whole in-memory batch is collision-free,
        // not only collision-free against entries that were already saved.
        let nextUid = makeEchoUid()
        while (knownUids.has(nextUid)) {
          nextUid = makeEchoUid()
        }
        nextEcho = { ...echo, uid: nextUid }
      }

      knownEchoSigs.add(echoSig)
      if (nextEcho.uid) {
        knownUids.add(nextEcho.uid)
      }
      echoesToAdd.push(nextEcho)
    }

    if (echoesToAdd.length === 0) {
      return []
    }

    const now = Date.now()
    const nextEntries = echoesToAdd.map((echo, index) => makeSavedEcho(echo, now + index))

    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: dedupeEchoUids([
          ...state.library.echoes,
          ...nextEntries,
        ]),
      },
    }), {
      historyLabel: nextEntries.length === 1 ? 'Added Inventory Echo' : 'Added Inventory Echoes',
    })

    return nextEntries
  },

  rplInvEcho: (echoes) => {
    get().ensInvHydr()
    const ddpdChs = echoes.reduce<EchoInstance[]>((acc, echo) => {
      if (acc.some((existing) => equalEchoes(existing, echo))) {
        return acc
      }

      acc.push({
        ...echo,
        uid: echo.uid,
        mainStats: {
          primary: { ...echo.mainStats.primary },
          secondary: { ...echo.mainStats.secondary },
        },
        substats: { ...echo.substats },
      })
      return acc
    }, [])

    const now = Date.now()

    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: dedupeEchoUids(
          ddpdChs.map((echo, index) => makeSavedEcho(echo, now + index)),
        ),
      },
    }), { historyLabel: 'Replaced Inventory Echoes' })
  },

  updInvEcho: (entryId, echo) => {
    get().ensInvHydr()
    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: state.library.echoes.map((entry) =>
            entry.id === entryId
                ? {
                  ...entry,
                  echo: {
                    ...echo,
                    uid: echo.uid,
                    mainStats: {
                      primary: { ...echo.mainStats.primary },
                      secondary: { ...echo.mainStats.secondary },
                    },
                    substats: { ...echo.substats },
                  },
                  updatedAt: Date.now(),
                }
                : entry,
        ),
      },
    }), { historyLabel: 'Updated Inventory Echo' })
  },

  cleanInvEcho: () => {
    get().ensInvHydr()
    const invChs = get().library.echoes
    const vldInvChs = invChs.filter((entry) => getEchoById(entry.echo.id))
    const removedCount = invChs.length - vldInvChs.length

    if (removedCount === 0) {
      return 0
    }

    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: state.library.echoes.filter((entry) => getEchoById(entry.echo.id)),
      },
    }), { historyLabel: 'Cleaned Inventory Echoes', recHist: false })

    return removedCount
  },

  rmInvEcho: (entryId) => {
    get().ensInvHydr()
    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: state.library.echoes.filter((entry) => entry.id !== entryId),
      },
    }), { historyLabel: 'Removed Inventory Echo' })
  },

  clrInvEcho: () => {
    get().ensInvHydr()
    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: [],
      },
    }), { historyLabel: 'Cleared Inventory Echoes' })
  },

  addInvBuild: ({ name, resonatorId, resonatorName: resName, build }) => {
    get().ensInvHydr()
    if (isEmptyBuild(build)) {
      return null
    }

    const existing = get().library.builds.find((entry) =>
        equalBuildSnapshots(entry.build, build),
    )

    if (existing) {
      return null
    }

    const builds = get().library.builds
    const nextEntry = makeSavedBuild({
      name: name?.trim() || mkDefMkName(resName, builds.length),
      resonatorId,
      resonatorName: resName,
      build,
    })

    persistedSet(['library.builds'], (state) => ({
      ...state,
      library: {
        ...state.library,
        builds: [...state.library.builds, nextEntry],
      },
    }), { historyLabel: 'Added Inventory Build' })

    return nextEntry
  },

  updInvBuild: (entryId, changes) => {
    get().ensInvHydr()
    persistedSet(['library.builds'], (state) => ({
      ...state,
      library: {
        ...state.library,
        builds: state.library.builds.map((entry) => {
          if (entry.id !== entryId) {
            return entry
          }

          return {
            ...entry,
            ...(changes.name != null ? { name: changes.name.trim() || entry.name } : {}),
            ...(changes.build
                ? {
                  build: {
                    weapon: { ...changes.build.weapon },
                    echoes: cloneEchoLoadout(changes.build.echoes),
                  },
                }
                : {}),
            updatedAt: Date.now(),
          }
        }),
      },
    }), { historyLabel: 'Updated Inventory Build' })
  },

  rmInvBuild: (entryId) => {
    get().ensInvHydr()
    persistedSet(['library.builds'], (state) => ({
      ...state,
      library: {
        ...state.library,
        builds: state.library.builds.filter((entry) => entry.id !== entryId),
      },
    }), { historyLabel: 'Removed Inventory Build' })
  },

  clrInvBuild: () => {
    get().ensInvHydr()
    persistedSet(['library.builds'], (state) => ({
      ...state,
      library: {
        ...state.library,
        builds: [],
      },
    }), { historyLabel: 'Cleared Inventory Builds' })
  },

  addInvRot: ({ name, duration, note, scenario }) => {
    get().ensInvHydr()
    const rotations = get().library.rotations
    const contextMember = contextScenarioMember(scenario)
    const contextName = resSdsById[contextMember.resonatorId]?.name ?? contextMember.resonatorId
    const nextEntry = makeSavedRotation({
      name: name?.trim() || mkDefRotName(
          contextName,
          rotations.length,
      ),
      duration,
      note,
      scenario,
    })

    persistedSet(['library.rotations'], (state) => ({
      ...state,
      library: {
        ...state.library,
        rotations: [...state.library.rotations, nextEntry],
      },
    }), { historyLabel: 'Added Inventory Rotation' })

    return nextEntry
  },

  updInvRot: (entryId, changes) => {
    get().ensInvHydr()
    persistedSet(['library.rotations'], (state) => ({
      ...state,
      library: {
        ...state.library,
        rotations: state.library.rotations.map((entry) => {
          if (entry.id !== entryId) {
            return entry
          }

          return {
            ...entry,
            ...(changes.name != null ? { name: changes.name.trim() || entry.name } : {}),
            ...(changes.note !== undefined ? { note: normalizeRotNote(changes.note) } : {}),
            ...(changes.duration !== undefined ? { duration: normalizeDuration(changes.duration) } : {}),
            updatedAt: Date.now(),
          }
        }),
      },
    }), { historyLabel: 'Updated Inventory Rotation' })
  },

  rmInvRot: (entryId) => {
    get().ensInvHydr()
    persistedSet(['library.rotations'], (state) => ({
      ...state,
      library: {
        ...state.library,
        rotations: state.library.rotations.filter((entry) => entry.id !== entryId),
      },
    }), { historyLabel: 'Removed Inventory Rotation' })
  },

  clrInvRot: () => {
    get().ensInvHydr()
    persistedSet(['library.rotations'], (state) => ({
      ...state,
      library: {
        ...state.library,
        rotations: [],
      },
    }), { historyLabel: 'Cleared Inventory Rotations' })
  },

  saveScenario: (input = {}) => {
    get().ensInvHydr()
    const state = get()
    const scenarioId = input.scenarioId ?? state.combat.selectedScenarioId
    const scenario = state.combat.scenariosById[scenarioId]
    if (!scenario) return null

    const contextMember = contextScenarioMember(scenario)
    const contextName = resSdsById[contextMember.resonatorId]?.name ?? contextMember.resonatorId
    const nextEntry = makeSavedScenario({
      name: input.name?.trim() || `${contextName} Scenario ${state.library.scenarios.length + 1}`,
      note: input.note,
      scenario,
    })

    persistedSet(['library.scenarios'], (current) => ({
      ...current,
      library: {
        ...current.library,
        scenarios: [...current.library.scenarios, nextEntry],
      },
    }), { historyLabel: 'Saved Scenario' })
    return nextEntry
  },

  updSavedScenario: (entryId, changes) => {
    get().ensInvHydr()
    persistedSet(['library.scenarios'], (state) => ({
      ...state,
      library: {
        ...state.library,
        scenarios: state.library.scenarios.map((entry) => entry.id === entryId
          ? {
            ...entry,
            ...(changes.name != null ? { name: changes.name.trim() || entry.name } : {}),
            ...(changes.note !== undefined ? { note: normalizeRotNote(changes.note) } : {}),
            updatedAt: Date.now(),
          }
          : entry),
      },
    }), { historyLabel: 'Updated Saved Scenario' })
  },

  rmSavedScenario: (entryId) => {
    get().ensInvHydr()
    persistedSet(['library.scenarios'], (state) => ({
      ...state,
      library: {
        ...state.library,
        scenarios: state.library.scenarios.filter((entry) => entry.id !== entryId),
      },
    }), { historyLabel: 'Removed Saved Scenario' })
  },

  clrSavedScenarios: () => {
    get().ensInvHydr()
    persistedSet(['library.scenarios'], (state) => ({
      ...state,
      library: {
        ...state.library,
        scenarios: [],
      },
    }), { historyLabel: 'Cleared Saved Scenarios' })
  },

  loadSavedScenario: (entryId) => {
    get().ensInvHydr()
    const entry = get().library.scenarios.find((candidate) => candidate.id === entryId)
    return entry ? get().applyScenarioSnapshot(entry.scenario) : null
  },

  updOptSets: (updater, resonatorId) => {
    persistedSet(['simulation.optimizerSettings'], (state) => ({
      ...state,
      simulation: {
        ...state.simulation,
        optimizerSettingsResonatorId:
          resonatorId ?? state.simulation.optimizerSettingsResonatorId,
        optimizerSettings: updater(state.simulation.optimizerSettings),
      },
    }), { historyLabel: 'Updated Optimizer Settings' })
  },

  startOpt: (input, hooks = {}) => {
    const current = get()
    if (current.optimizer.status === 'running') {
      current.cnclOpt()
    }

    // keep the compile worker warm across runs (it hydrates game data once);
    // only the task-worker pool is reset here. explicit teardown still happens
    // on cancel / clear / error so resources free when the surface is left.
    rstOptWrkrPo()
    const runToken = bgnOptRun()

    logOptimizer('[optimizer:store] run started', {
      runToken,
      resonatorId: input.resonatorId,
      rotationMode: input.settings.rotationMode,
      enableGpu: input.settings.enableGpu,
      lowMem: input.settings.lowMemoryMode,
      invSize: input.invChs.length,
      resultsLimit: input.settings.resultsLimit,
      sabAvail: typeof SharedArrayBuffer !== 'undefined',
    })

    set((state) => ({
      ...state,
      optimizer: {
        status: 'running' as const,
        progress: null,
        results: [],
        error: null,
        batchSize: inferOptBtch(input),
        resPay: null,
        resultEchoes: [],
      },
    }))

    const compWrkr = ensOptCompWr()
    const runStartTime = performance.now()

    void (async () => {
      try {
        await hooks.settle?.()
        if (!isOptRunCur(runToken)) {
          logOptimizer('[optimizer:store] run superseded while settling, dropping', { runToken })
          return
        }

        const compPay = await compOptPayIn(compWrkr, runToken, input)
        if (!isOptRunCur(runToken)) {
          logOptimizer('[optimizer:store] run superseded after compile, dropping', { runToken })
          return
        }

        const backend: OptBckn = input.settings.enableGpu ? 'gpu' : 'cpu'

        logOptimizer('[optimizer:store] starting pool search', {
          runToken,
          backend,
          mode: compPay.mode,
          totalCombos: compPay.totalCombos,
          resultsLimit: compPay.resultsLimit,
          lowMem: compPay.lowMmryMode,
        })

        set((state) => ({
          ...state,
          optimizer: {
            ...state.optimizer,
            batchSize:
                compPay.mode === 'theoryTarget' || compPay.mode === 'theoryRotation'
                    ? backend === 'gpu'
                        ? GPU_THEORY_JOB
                        : CPU_THEORY_JOB
                    : compPay.mode === 'rotation' && backend === 'gpu'
                        ? ROT_GPU_JOB
                        : resOptBtchSi(backend),
            resPay: null,
          },
        }))

        // Publish the compiled candidate count before worker progress replaces
        // this initial snapshot; it supersedes any pre-compilation estimate.
        hooks.onProgress?.({
          progress: 0,
          elapsedMs: 0,
          remainingMs: Infinity,
          processed: 0,
          speed: 0,
          total: compPay.totalCombos,
          phase: 'evaluating',
          discovered: 0,
        })

        const searchT0 = performance.now()
        const results = await runOptWithWr(compPay, backend, {
          isCancelled: () => !isOptRunCur(runToken),
          onProgress: (progress) => {
            if (!isOptRunCur(runToken)) {
              return
            }

            hooks.onProgress?.(progress)
          },
        })

        if (!isOptRunCur(runToken)) {
          logOptimizer('[optimizer:store] run superseded after search, dropping', { runToken })
          return
        }

        logOptimizer('[optimizer:store] pool search complete', {
          runToken,
          rawRsltCnt: results.length,
          srchMs: Math.round(performance.now() - searchT0),
        })

        const lazyTheory =
            compPay.mode === 'theoryTarget' ||
            compPay.mode === 'theoryRotation'
        const fnlzRslts = lazyTheory
            ? matOptRsltsF([], results, {
                payload: compPay,
                limit: compPay.resultsLimit,
              })
            : await matOptRsltsI(
                compWrkr,
                runToken,
                compPay,
                results,
                input.invChs.map((echo) => echo.uid),
                compPay.resultsLimit,
            )

        if (!isOptRunCur(runToken)) {
          logOptimizer('[optimizer:store] run superseded after materialize, dropping', { runToken })
          return
        }

        logOptimizer('[optimizer:store] run complete', {
          runToken,
          finRsltCnt: fnlzRslts.length,
          lazyTheory,
          ttlMs: Math.round(performance.now() - runStartTime),
        })

        set((state) => ({
          ...state,
          optimizer: {
            status: 'done',
            progress: state.optimizer.progress,
            results: fnlzRslts,
            error: null,
            batchSize: state.optimizer.batchSize,
            resPay: null,
            resultEchoes: [],
          },
        }))

        // Results are fully self-contained. Release every worker and compiled
        // buffer now instead of retaining an engine-sized backing payload.
        stopOptCompW()
        rstOptWrkrPo()

      } catch (error) {
        errorOpt('[optimizer:store] run failed', {
          runToken,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          elapsedMs: Math.round(performance.now() - runStartTime),
        })

        stopOptCompW()
        rstOptWrkrPo()

        if (!isOptRunCur(runToken)) {
          return
        }

        set((state) => ({
          ...state,
          optimizer: {
            status: 'error',
            progress: state.optimizer.progress,
            results: [],
            error: error instanceof Error ? error.message : 'Optimizer worker pool failed unexpectedly',
            batchSize: state.optimizer.batchSize,
            resPay: null,
            resultEchoes: [],
          },
        }))
      }
    })()
  },

  cnclOpt: () => {
    nvldOptRun()
    stopOptCompW()
    cnclActOptWr()
    rstOptWrkrPo()

    set((state) => ({
      ...state,
      optimizer: {
        status: 'cancelled',
        progress: state.optimizer.progress,
        results: state.optimizer.results,
        error: null,
        batchSize: state.optimizer.batchSize,
        resPay: state.optimizer.resPay,
        resultEchoes: state.optimizer.resultEchoes,
      },
    }))
  },

  clrOptRslt: () => {
    stopOptCompW()
    rstOptWrkrPo()
    set((state) => ({
      ...state,
      optimizer: {
        status: 'idle',
        progress: null,
        results: [],
        error: null,
        batchSize: null,
        resPay: null,
        resultEchoes: [],
      },
    }))
  },

  disposeOptResources: () => {
    if (get().optimizer.status === 'running') {
      get().cnclOpt()
      return
    }
    stopOptCompW()
    rstOptWrkrPo()
  },

  applyOpt: (index) => {
    const result = get().optimizer.results[index]
    if (!result) return

    const resultPayload = get().optimizer.resPay
    if (
        resultPayload &&
        (resultPayload.mode === 'theoryTarget' || resultPayload.mode === 'theoryRotation') &&
        ('i0' in result || 'ids' in result)
    ) {
      const nextEchoes = matThryRsltCh(resultPayload, result)
          ?.map((echo, i) => cloneEchoFor(echo, i)) ?? []
      if (nextEchoes.length === 0) return

      const actResId = getActResId(selectedCombatScenario(get().combat))
      if (!actResId) return

      get().updResRt(actResId, (runtime) => ({
        ...runtime,
        build: {
          ...runtime.build,
          echoes: nextEchoes,
        },
      }))
      return
    }

    // apply materialized theoretical results
    if ('echoes' in result && Array.isArray(result.echoes)) {
      const nextEchoes = result.echoes.map((echo, i) => cloneEchoFor(echo, i))
      if (nextEchoes.length === 0) return

      const actResId = getActResId(selectedCombatScenario(get().combat))
      if (!actResId) return

      get().updResRt(actResId, (runtime) => ({
        ...runtime,
        build: {
          ...runtime.build,
          echoes: nextEchoes,
        },
      }))
      return
    }

    // apply materialized uid-based results
    if ('uids' in result && Array.isArray(result.uids)) {
      const invChsByUid = new Map(
          get().library.echoes.map((entry) => [entry.echo.uid, entry.echo] as const),
      )

      const nextEchoes = result.uids
          .map((uid) => invChsByUid.get(uid) ?? null)
          .filter((echo): echo is EchoInstance => echo != null)
          .map((echo, i) => cloneEchoFor(echo, i))

      if (nextEchoes.length === 0) return

      const actResId = getActResId(selectedCombatScenario(get().combat))
      if (!actResId) return

      get().updResRt(actResId, (runtime) => ({
        ...runtime,
        build: {
          ...runtime.build,
          echoes: nextEchoes,
        },
      }))
      return
    }

    // apply bag index-based results
    const bagResult = result as OptBagResult
    const resultEchoes = get().optimizer.resultEchoes
    const nextEchoes = [
      resultEchoes[bagResult.i0] ?? null,
      resultEchoes[bagResult.i1] ?? null,
      resultEchoes[bagResult.i2] ?? null,
      resultEchoes[bagResult.i3] ?? null,
      resultEchoes[bagResult.i4] ?? null,
    ]
        .filter((echo): echo is EchoInstance => echo != null)
        .map((echo, i) => cloneEchoFor(echo, i))

    if (nextEchoes.length === 0) return

    const actResId = getActResId(selectedCombatScenario(get().combat))
    if (!actResId) return

    get().updResRt(actResId, (runtime) => ({
      ...runtime,
      build: {
        ...runtime.build,
        echoes: nextEchoes,
      },
    }))
  },
  })
})
