/*
  Author: Runor Ewhro
  Description: Defines the global zustand application store, including ui,
               runtime, inventory, and optimizer state management.
*/

import {create} from 'zustand'
import type {
    EnemyProfile,
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
import type {
    InventoryEntry,
    InvEchoEnt,
    InvRotEnt,
    RotEntSmmr,
} from '@/domain/entities/inventoryStorage'
import {
    areMkSnpsQvl,
    areEchoNstnQ,
    cloneEchoFor,
    cloneEchoLdt,
    cloneRotNds,
    dedupeInvEchoUids,
    makeInvBuild,
    makeInvEcho,
    makeInvRot,
    isEmptyBuild,
    normInvRotDu,
    normInvRotNo,
} from '@/domain/entities/inventoryStorage'
import { makeEchoUid } from '@/domain/entities/runtime'
import type {OptContext, OptSets} from '@/domain/entities/optimizer'
import type {ResProf} from '@/domain/entities/profile'
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
import {matThryRsltCh} from '@/engine/optimizer/results/materialize.ts'
import {ROT_GPU_JOB, CPU_THEORY_JOB, GPU_THEORY_JOB,} from '@/engine/optimizer/config/constants'
import {errorOpt, logOptimizer} from '@/engine/optimizer/config/log.ts'
import {
    makeAppState,
    makeResProfile,
    makeSuggest,
    DEF_RES_ID,
    initAppState,
} from '@/domain/state/defaults'
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
} from '@/domain/state/history'
import {
    applyPckrFre,
    mkProfPckrFr,
    mkRtPckrFreq,
    mkTeamMemVie,
} from '@/domain/state/pickerFrequency'
import {
    ALL_DOMAIN_KEYS,
    loadPrssInvS,
    markPrssDmns,
    type PersistKey,
} from '@/infra/persistence/storage'
import {
    applyRtToCal,
    mkRtFromProf,
    mkTeamMemRtV,
    findSlotIdFo,
    getActResId,
} from '@/domain/state/runtimeAdapters'
import {resSdsById} from '@/domain/services/resonatorSeedService'
import {getEchoById} from '@/domain/services/echoCatalogService'
import {cloneResProf, cloneRtSttVl,} from '@/domain/state/runtimeCloning'
import {catWpnAtk} from '@/domain/state/weaponState'
import {getSystTheme, type RslvSystThem} from '@/shared/lib/systemTheme'
import {
    mkDefMkName,
    mkDefRotName,
    mkNtlAppStt,
    getOptCtxFro,
    getSuggsSttF,
    getSyncOptCt,
} from '@/domain/state/storeHelpers'
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
    stopOptComhl,
} from '@/domain/state/storeOptimizerRuntime'
import {selectPersisted} from '@/domain/state/serialization'

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

function bumpCalcRtRv<T extends { runtimeRevision: number }>(calculator: T): T {
  return {
    ...calculator,
    runtimeRevision: calculator.runtimeRevision + 1,
  }
}

function rplcCalcWith(
    current: AppStore['calculator'],
    next: AppStore['calculator'],
): AppStore['calculator'] {
  if (next === current) {
    return current
  }

  return {
    ...next,
    runtimeRevision: current.runtimeRevision + 1,
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

  const nextFreq = applyPckrFre(state.ui.itemFreq, updates)
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

export interface AppStore extends PersistedState {
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
  setRecMenus: (enabled: boolean) => void
  setUnqOvr: (enabled: boolean) => void
  setMaxResInit: (enabled: boolean) => void
  setSugView: (view: SuggsViewMod) => void
  setLeftView: (view: LeftPaneView) => void
  openLeftView: (view: LeftPaneView) => void
  setMainMode: (mode: 'default' | 'optimizer' | 'overview') => void
  setSubHits: (enabled: boolean) => void
  setCmpInv: (enabled: boolean) => void
  setSeeEqp: (enabled: boolean) => void
  setHistOn: (enabled: boolean) => void
  setHistMax: (max: HistoryMax) => void
  setOptHint: (seen: boolean) => void
  setOptSprite: (useSprite: boolean) => void
  setRotPrefs: (
      updater: (
          preferences: UiState['savedRotationPreferences'],
      ) => UiState['savedRotationPreferences'],
  ) => void
  setInvOpen: (open: boolean) => void
  setInvEchoQ: (search: string) => void
  bumpPickFr: (updates: PckrFreqUpd | PckrFreqUpd[]) => void
  // resonator actions own profile switching, runtime creation, and
  // target/suggestion updates for the currently selected calculator context.
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
  updTeamView: (
      resonatorId: ResonatorId,
      updater: (runtimeView: TeamMemRtVie) => TeamMemRtVie,
  ) => void
  updActRt: (
      updater: (runtime: ResRuntime) => ResRuntime,
  ) => void
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
  updActConds: (
      updater: (state: SntSetConds) => SntSetConds,
  ) => void
  setResTgt: (
      resonatorId: ResonatorId,
      ownerKey: string,
      tgtResId: ResonatorId | null,
  ) => void
  addInvEcho: (echo: EchoInstance) => InvEchoEnt | null
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
  }) => InventoryEntry | null
  updInvBuild: (
      entryId: string,
      changes: Partial<Pick<InventoryEntry, 'name'>> & {
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
    mode: 'personal' | 'team'
    resonatorId: ResonatorId
    resonatorName: string
    duration?: number
    note?: string
    team?: ResRuntime['build']['team']
    items: ResRuntime['rotation']['personalItems']
    snapshot?: ResProf
    summary?: RotEntSmmr
  }) => InvRotEnt | null
  updInvRot: (
      entryId: string,
      changes: Partial<Pick<InvRotEnt, 'name' | 'note' | 'duration'>> & {
        items?: ResRuntime['rotation']['personalItems']
        team?: ResRuntime['build']['team']
      },
  ) => void
  rmInvRot: (entryId: string) => void
  clrInvRot: () => void
  // optimizer actions bridge live calculator state into packed worker payloads
  // and then materialize selected results back into the persisted runtime.
  ensureOptimizer: () => void
  syncOptRt: (resonatorId?: ResonatorId) => void
  updOptRt: (
      updater: (runtime: OptContext['runtime']) => OptContext['runtime'],
      options?: { sourceRuntimeSig?: (runtime: OptContext['runtime']) => string },
  ) => void
  updOptSets: (
      updater: (settings: OptSets) => OptSets,
  ) => void
  clrOptCtx: () => void
  startOpt: (
      input: OptStartPay,
      hooks?: {
        onProgress?: (progress: OptPrgr) => void
      },
  ) => void
  cnclOpt: () => void
  clrOptRslt: () => void
  applyOpt: (index: number) => void
}

// main zustand store
const ntlPrssStt = mkNtlAppStt()
const ntlInvHydr =
    ntlPrssStt.ui.mainMode === 'optimizer'
    || INV_LEFT_PANES.has(ntlPrssStt.ui.leftPaneView)

export const useAppStore = create<AppStore>((set, get) => {
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
      historyLabel?: string
    },
  ) => options.historyLabel?.trim() || resFllbHistL(dirtyDomains)

  const undoToHistNd = (index: number) => {
    const state = get()
    if (!state.ui.haveHistory || index < 0 || index >= state.history.past.length) {
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
    if (!state.ui.haveHistory || index < 0 || index >= state.history.future.length) {
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
      historyLabel?: string
    } = {},
  ) => {
    set((state) => {
      const next = updater(state)
      if (next !== state) {
        if (!state.history.isRestoring && state.ui.haveHistory && options.recHist !== false) {
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

    persistedSet(['calculator.profiles', 'calculator.suggestions', 'calculator.session', 'ui.layout'], (state) => {
      const nextProfiles = { ...state.calculator.profiles }
      let nextSuggsByR = state.calculator.suggestionsByResonatorId
      let changed = false

      for (const profile of profiles) {
        nextProfiles[profile.resonatorId] = cloneResProf(profile)
        changed = true

        if (!nextSuggsByR[profile.resonatorId]) {
          if (nextSuggsByR === state.calculator.suggestionsByResonatorId) {
            nextSuggsByR = { ...state.calculator.suggestionsByResonatorId }
          }

          nextSuggsByR[profile.resonatorId] = makeSuggest()
        }
      }

      if (!changed) {
        return state
      }

      const nextActResId = state.calculator.session.activeResonatorId ?? profiles[0]?.resonatorId ?? null

      return applyUiFreqP({
        ...state,
        calculator: bumpCalcRtRv({
          ...state.calculator,
          profiles: nextProfiles,
          suggestionsByResonatorId: nextSuggsByR,
          session: {
            ...state.calculator.session,
            activeResonatorId: nextActResId,
          },
        }),
      }, mkProfPckrFr(profiles))
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

    persistedSet(['calculator.profiles', 'calculator.suggestions', 'calculator.session'], (state) => {
      const nextProfiles = { ...state.calculator.profiles }
      const nextSuggsByR = { ...state.calculator.suggestionsByResonatorId }
      const removedIds: ResonatorId[] = []

      for (const resonatorId of resonatorIds) {
        if (!nextProfiles[resonatorId]) {
          continue
        }

        delete nextProfiles[resonatorId]
        delete nextSuggsByR[resonatorId]
        removedIds.push(resonatorId)
      }

      if (removedIds.length === 0) {
        return state
      }

      const remainingIds = Object.keys(nextProfiles)
      const actResId = state.calculator.session.activeResonatorId

      if (remainingIds.length === 0) {
        const fallbackSeed = resSdsById[DEF_RES_ID]
        if (!fallbackSeed) {
          return {
            ...state,
            calculator: bumpCalcRtRv({
              ...state.calculator,
              profiles: {},
              suggestionsByResonatorId: {},
              session: {
                ...state.calculator.session,
                activeResonatorId: null,
              },
            }),
          }
        }

        return {
          ...state,
          calculator: bumpCalcRtRv({
            ...state.calculator,
            profiles: {
              [fallbackSeed.id]: makeResProfile(fallbackSeed, { maxed: state.ui.preferences.maxResOnInit }),
            },
            suggestionsByResonatorId: {
              [fallbackSeed.id]: makeSuggest(),
            },
            session: {
              ...state.calculator.session,
              activeResonatorId: fallbackSeed.id,
            },
          }),
        }
      }

      const rslvNextActI =
        actResId && nextProfiles[actResId] && !removedIds.includes(actResId)
          ? actResId
          : (
              (prfrNextResI && nextProfiles[prfrNextResI]
                ? prfrNextResI
                : null)
              ?? remainingIds[0]
            )

      return {
        ...state,
        calculator: bumpCalcRtRv({
          ...state.calculator,
          profiles: nextProfiles,
          suggestionsByResonatorId: nextSuggsByR,
          session: {
            ...state.calculator.session,
            activeResonatorId: rslvNextActI,
          },
        }),
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
      past: ui.haveHistory
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

  canUndo: () => get().ui.haveHistory && get().history.past.length > 0,
  canRedo: () => get().ui.haveHistory && get().history.future.length > 0,
  undoHist: () => get().ui.haveHistory ? get().history.past.slice().reverse() : [],
  redoHist: () => get().ui.haveHistory ? get().history.future.slice() : [],

  ensInvHydr: () => {
    if (get().invHydr || typeof window === 'undefined') {
      return
    }

    const inventory = loadPrssInvS()
    set((state) => ({
      ...state,
      invHydr: true,
      calculator: {
        ...state.calculator,
        inventoryEchoes: inventory.inventoryEchoes,
        inventoryBuilds: inventory.inventoryBuilds,
        inventoryRotations: inventory.inventoryRotations,
      },
    }))
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

  setUnqOvr: (showNqntVrvw) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          showUnquantifiedOverviewStates: showNqntVrvw,
        },
      },
    }), { historyLabel: 'Changed Overview State Visibility' })
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
      if (state.ui.mainMode === 'default' && state.ui.leftPaneView === leftPaneView) {
        return state
      }

      return {
        ...state,
        ui: {
          ...state.ui,
          mainMode: 'default',
          leftPaneView,
        },
      }
    }, { historyLabel: mkLeftPaneVi(leftPaneView) })
  },

  setMainMode: (mainMode) => {
    if (mainMode === 'optimizer') {
      get().ensInvHydr()
    }

    persistedSet(['ui.layout', 'calculator.optimizerContext'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        mainMode,
      },
      calculator: {
        ...state.calculator,
        optimizerContext: mainMode === 'optimizer'
            ? getSyncOptCt(state)
            : state.calculator.optimizerContext,
      },
    }), {
      historyLabel: mainMode === 'optimizer'
        ? 'Opened Optimizer'
        : mainMode === 'overview'
          ? 'Opened Overview'
          : 'Returned to Calculator',
    })
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

  setEnemy: (enemyProfile) => {
    persistedSet(['calculator.session', 'ui.layout'], (state) => {
      const nextState = {
        ...state,
        calculator: bumpCalcRtRv({
          ...state.calculator,
          session: {
            ...state.calculator.session,
            enemyProfile,
          },
        }),
      }

      return enemyProfile.id && enemyProfile.id !== state.calculator.session.enemyProfile.id
        ? applyUiFreqP(nextState, [{
          bucket: 'enemy',
          ids: [enemyProfile.id],
        }])
        : nextState
    }, { historyLabel: 'Updated Enemy Profile' })
  },

  setActRes: (resonatorId) => {
    if (get().calculator.session.activeResonatorId === resonatorId) {
      return
    }

    persistedSet(['calculator.session', 'ui.layout'], (state) => applyUiFreqP({
      ...state,
      calculator: bumpCalcRtRv({
        ...state.calculator,
        session: {
          ...state.calculator.session,
          activeResonatorId: resonatorId,
        },
      }),
    }, [
      {
        bucket: 'resonator',
        ids: [resonatorId],
      },
      {
        bucket: 'teamResonator',
        slot: 'active',
        ids: [resonatorId],
      },
    ]), { historyLabel: 'Changed Active Resonator' })
  },

  actRes: (seed) => {
    persistedSet(['calculator.profiles', 'calculator.suggestions', 'calculator.session', 'ui.layout'], (state) => {
      const existing = state.calculator.profiles[seed.id]
      if (existing && state.calculator.session.activeResonatorId === seed.id) {
        return state
      }

      return applyUiFreqP({
        ...state,
        calculator: bumpCalcRtRv({
          ...state.calculator,
          profiles: existing
              ? state.calculator.profiles
              : {
                ...state.calculator.profiles,
                [seed.id]: makeResProfile(seed, { maxed: state.ui.preferences.maxResOnInit }),
              },
          suggestionsByResonatorId: state.calculator.suggestionsByResonatorId[seed.id]
              ? state.calculator.suggestionsByResonatorId
              : {
                ...state.calculator.suggestionsByResonatorId,
                [seed.id]: makeSuggest(),
              },
          session: {
            ...state.calculator.session,
            activeResonatorId: seed.id,
          },
        }),
      }, [
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
      historyLabel: get().calculator.profiles[seed.id]
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

    persistedSet(['calculator.profiles'], (state) => {
      if (!state.calculator.profiles[resonatorId]) return state

      return {
        ...state,
        calculator: bumpCalcRtRv({
          ...state.calculator,
          profiles: {
            ...state.calculator.profiles,
            [resonatorId]: makeResProfile(seed, { maxed: state.ui.preferences.maxResOnInit }),
          },
        }),
      }
    }, { historyLabel: 'Reset Resonator' })
  },

  loadResProf: (profile) => {
    psrtResPrflI([profile], 'Loaded Resonator Profile')
  },

  upsertRes: (profiles, historyLabel) => {
    psrtResPrflI(profiles, historyLabel)
  },

  ensResRt: (seed) => {
    const existing = get().calculator.profiles[seed.id]
    if (existing && get().calculator.suggestionsByResonatorId[seed.id]) return

    persistedSet(['calculator.profiles', 'calculator.suggestions', 'calculator.session'], (state) => ({
      ...state,
      calculator: bumpCalcRtRv({
        ...state.calculator,
        profiles: {
          ...state.calculator.profiles,
          ...(state.calculator.profiles[seed.id]
            ? {}
            : { [seed.id]: makeResProfile(seed, { maxed: state.ui.preferences.maxResOnInit }) }),
        },
        suggestionsByResonatorId: state.calculator.suggestionsByResonatorId[seed.id]
            ? state.calculator.suggestionsByResonatorId
            : {
              ...state.calculator.suggestionsByResonatorId,
              [seed.id]: makeSuggest(),
            },
        session:
            state.calculator.session.activeResonatorId != null
                ? state.calculator.session
                : {
                  ...state.calculator.session,
                  activeResonatorId: seed.id,
        },
      }),
    }), { historyLabel: 'Added Resonator Profile' })
  },

  ensTeamRt: (seed) => {
    void seed
    // no-op: team member runtimes are created when the teammate is actually assigned to a slot
    // this stays as a stable api for callers that previously ensured a profile existed
  },

  updResRt: (resonatorId, updater) => {
    const target = mkRtFromProf(get().calculator, resonatorId)
    if (!target) return

    const next = updater(target)
    if (next === target) return

    persistedSet(['calculator.profiles', 'ui.layout'], (state) => applyUiFreqP({
      ...state,
      calculator: rplcCalcWith(
          state.calculator,
          applyRtToCal(state.calculator, resonatorId, next),
      ),
    }, mkRtPckrFreq(target, next)), {
      historyLabel: mkRtUpdHistL(target, next),
    })
  },

  updTeamView: (resonatorId, updater) => {
    const target = mkTeamMemRtV(get().calculator, resonatorId)
    if (!target) return

    const next = updater(target)
    if (next === target) return

    const actRt = mkRtFromProf(get().calculator, resonatorId)
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

    persistedSet(['calculator.profiles', 'ui.layout'], (state) => applyUiFreqP({
      ...state,
      calculator: rplcCalcWith(
          state.calculator,
          applyRtToCal(state.calculator, resonatorId, brdgRt),
      ),
    }, mkTeamMemVie(resonatorId, target, next)), {
      historyLabel: mkTeamMemRtU(target, next),
    })
  },

  updActRt: (updater) => {
    const actResId = getActResId(get().calculator)
    if (!actResId) return
    get().updResRt(actResId, updater)
  },

  updResSuggs: (resonatorId, updater) => {
    persistedSet(['calculator.suggestions'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        suggestionsByResonatorId: {
          ...state.calculator.suggestionsByResonatorId,
          [resonatorId]: updater(getSuggsSttF(state, resonatorId)),
        },
      },
    }), { historyLabel: 'Updated Suggestions' })
  },

  updActSuggs: (updater) => {
    const actResId = getActResId(get().calculator)
    if (!actResId) return
    get().updResSuggs(actResId, updater)
  },

  updWpnSuggs: (updater) => {
    persistedSet(['calculator.suggestions'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        weaponSuggests: updater(state.calculator.weaponSuggests),
      },
    }), { historyLabel: 'Updated Weapon Suggestions' })
  },

  updResConds: (resonatorId, updater) => {
    persistedSet(['calculator.profiles'], (state) => {
      const profile = state.calculator.profiles[resonatorId]
      if (!profile) {
        return state
      }

      return {
        ...state,
        calculator: {
          ...state.calculator,
          profiles: {
            ...state.calculator.profiles,
            [resonatorId]: {
              ...profile,
              runtime: {
                ...profile.runtime,
                local: {
                  ...profile.runtime.local,
                  setConditionals: updater(profile.runtime.local.setConditionals),
                },
              },
            },
          },
        },
      }
    }, { historyLabel: 'Updated Set Conditionals' })
  },

  updActConds: (updater) => {
    const actResId = getActResId(get().calculator)
    if (!actResId) return
    get().updResConds(actResId, updater)
  },

  setResTgt: (resonatorId, ownerKey, tgtResId) => {
    persistedSet(['calculator.profiles'], (state) => {
      // for teammates, write routing to the active resonator's profile
      const slotId = findSlotIdFo(state.calculator, resonatorId)
      const profileId = slotId && slotId !== 'active'
          ? getActResId(state.calculator)
          : resonatorId

      if (!profileId) return state

      const profile = state.calculator.profiles[profileId]
      if (!profile) {
        return state
      }

      const nextRouting = {
        ...profile.runtime.routing,
        selectedTargetsByOwnerKey: {
          ...profile.runtime.routing.selectedTargetsByOwnerKey,
          [ownerKey]: tgtResId,
        },
      }

      return {
        ...state,
        calculator: bumpCalcRtRv({
          ...state.calculator,
          profiles: {
            ...state.calculator.profiles,
            [profileId]: {
              ...profile,
              runtime: {
                ...profile.runtime,
                routing: nextRouting,
              },
            },
          },
        }),
      }
    }, { historyLabel: 'Updated Target Selection' })
  },

  addInvEcho: (echo) => {
    get().ensInvHydr()
    const invChs = get().calculator.inventoryEchoes
    const existing = invChs.find((entry) =>
        areEchoNstnQ(entry.echo, echo),
    )

    if (existing) {
      return null
    }

    // a uid identifies one physical echo, so a new entry takes a fresh uid when
    // the incoming echo's uid already belongs to another bag entry.
    const uidTaken = echo.uid != null
      && invChs.some((entry) => entry.echo.uid === echo.uid)
    const nextEntry = makeInvEcho(uidTaken ? { ...echo, uid: makeEchoUid() } : echo)
    persistedSet(['calculator.inventory.echoes'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryEchoes: [...state.calculator.inventoryEchoes, nextEntry],
      },
    }), { historyLabel: 'Added Inventory Echo' })

    return nextEntry
  },

  rplInvEcho: (echoes) => {
    get().ensInvHydr()
    const ddpdChs = echoes.reduce<EchoInstance[]>((acc, echo) => {
      if (acc.some((existing) => areEchoNstnQ(existing, echo))) {
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

    persistedSet(['calculator.inventory.echoes'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryEchoes: dedupeInvEchoUids(
          ddpdChs.map((echo, index) => makeInvEcho(echo, now + index)),
        ),
      },
    }), { historyLabel: 'Replaced Inventory Echoes' })
  },

  updInvEcho: (entryId, echo) => {
    get().ensInvHydr()
    persistedSet(['calculator.inventory.echoes'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryEchoes: state.calculator.inventoryEchoes.map((entry) =>
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
    const invChs = get().calculator.inventoryEchoes
    const vldInvChs = invChs.filter((entry) => getEchoById(entry.echo.id))
    const removedCount = invChs.length - vldInvChs.length

    if (removedCount === 0) {
      return 0
    }

    persistedSet(['calculator.inventory.echoes'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryEchoes: state.calculator.inventoryEchoes.filter((entry) => getEchoById(entry.echo.id)),
      },
    }), { historyLabel: 'Cleaned Inventory Echoes', recHist: false })

    return removedCount
  },

  rmInvEcho: (entryId) => {
    get().ensInvHydr()
    persistedSet(['calculator.inventory.echoes'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryEchoes: state.calculator.inventoryEchoes.filter((entry) => entry.id !== entryId),
      },
    }), { historyLabel: 'Removed Inventory Echo' })
  },

  clrInvEcho: () => {
    get().ensInvHydr()
    persistedSet(['calculator.inventory.echoes'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryEchoes: [],
      },
    }), { historyLabel: 'Cleared Inventory Echoes' })
  },

  addInvBuild: ({ name, resonatorId, resonatorName: resName, build }) => {
    get().ensInvHydr()
    if (isEmptyBuild(build)) {
      return null
    }

    const existing = get().calculator.inventoryBuilds.find((entry) =>
        areMkSnpsQvl(entry.build, build),
    )

    if (existing) {
      return null
    }

    const builds = get().calculator.inventoryBuilds
    const nextEntry = makeInvBuild({
      name: name?.trim() || mkDefMkName(resName, builds.length),
      resonatorId,
      resonatorName: resName,
      build,
    })

    persistedSet(['calculator.inventory.builds'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryBuilds: [...state.calculator.inventoryBuilds, nextEntry],
      },
    }), { historyLabel: 'Added Inventory Build' })

    return nextEntry
  },

  updInvBuild: (entryId, changes) => {
    get().ensInvHydr()
    persistedSet(['calculator.inventory.builds'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryBuilds: state.calculator.inventoryBuilds.map((entry) => {
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
                    echoes: cloneEchoLdt(changes.build.echoes),
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
    persistedSet(['calculator.inventory.builds'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryBuilds: state.calculator.inventoryBuilds.filter((entry) => entry.id !== entryId),
      },
    }), { historyLabel: 'Removed Inventory Build' })
  },

  clrInvBuild: () => {
    get().ensInvHydr()
    persistedSet(['calculator.inventory.builds'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryBuilds: [],
      },
    }), { historyLabel: 'Cleared Inventory Builds' })
  },

  addInvRot: ({ name, mode, resonatorId, resonatorName: resName, duration, note, team, items, snapshot, summary }) => {
    get().ensInvHydr()
    const rotations = get().calculator.inventoryRotations
    const nextEntry = makeInvRot({
      name: name?.trim() || mkDefRotName(
          resName,
          mode,
          rotations.filter((entry) => entry.mode === mode).length,
      ),
      mode,
      resonatorId,
      resonatorName: resName,
      duration,
      note,
      ...(mode === 'team' && team ? { team } : {}),
      items,
      snapshot,
      summary,
    })

    persistedSet(['calculator.inventory.rotations'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryRotations: [...state.calculator.inventoryRotations, nextEntry],
      },
    }), { historyLabel: 'Added Inventory Rotation' })

    return nextEntry
  },

  updInvRot: (entryId, changes) => {
    get().ensInvHydr()
    persistedSet(['calculator.inventory.rotations'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryRotations: state.calculator.inventoryRotations.map((entry) => {
          if (entry.id !== entryId) {
            return entry
          }

          return {
            ...entry,
            ...(changes.name != null ? { name: changes.name.trim() || entry.name } : {}),
            ...(changes.note !== undefined ? { note: normInvRotNo(changes.note) } : {}),
            ...(changes.duration !== undefined ? { duration: normInvRotDu(changes.duration) } : {}),
            ...(changes.team !== undefined
                ? {
                  team: changes.team
                      ? [...changes.team] as ResRuntime['build']['team']
                      : undefined,
                }
                : {}),
            ...(changes.items ? { items: cloneRotNds(changes.items) } : {}),
            updatedAt: Date.now(),
          }
        }),
      },
    }), { historyLabel: 'Updated Inventory Rotation' })
  },

  rmInvRot: (entryId) => {
    get().ensInvHydr()
    persistedSet(['calculator.inventory.rotations'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryRotations: state.calculator.inventoryRotations.filter((entry) => entry.id !== entryId),
      },
    }), { historyLabel: 'Removed Inventory Rotation' })
  },

  clrInvRot: () => {
    get().ensInvHydr()
    persistedSet(['calculator.inventory.rotations'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryRotations: [],
      },
    }), { historyLabel: 'Cleared Inventory Rotations' })
  },

  ensureOptimizer: () => {
    persistedSet(['calculator.optimizerContext'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        optimizerContext: getSyncOptCt(state),
      },
    }), { historyLabel: 'Synced Optimizer Context' })
  },

  syncOptRt: (resonatorId) => {
    persistedSet(['calculator.optimizerContext'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        optimizerContext: getOptCtxFro(state, resonatorId),
      },
    }), { historyLabel: 'Synced Optimizer Context' })
  },

  updOptRt: (updater, options) => {
    persistedSet(['calculator.optimizerContext'], (state) => {
      const existing = state.calculator.optimizerContext
      if (!existing) {
        return state
      }
      const nextRuntime = updater(existing.runtime)

      return {
        ...state,
        calculator: {
          ...state.calculator,
          optimizerContext: {
            ...existing,
            runtime: nextRuntime,
            sourceRuntimeSig: options?.sourceRuntimeSig
              ? options.sourceRuntimeSig(nextRuntime)
              : existing.sourceRuntimeSig,
          },
        },
      }
    }, { historyLabel: 'Updated Optimizer Runtime' })
  },

  updOptSets: (updater) => {
    persistedSet(['calculator.optimizerContext'], (state) => {
      const existing = state.calculator.optimizerContext
      if (!existing) {
        return state
      }

      return {
        ...state,
        calculator: {
          ...state.calculator,
          optimizerContext: {
            ...existing,
            settings: updater(existing.settings),
          },
        },
      }
    }, { historyLabel: 'Updated Optimizer Settings' })
  },

  clrOptCtx: () => {
    persistedSet(['calculator.optimizerContext'], (state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        optimizerContext: null,
      },
    }), { historyLabel: 'Cleared Optimizer Context' })
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

        // push the exact combo total to the caller right after compile so the
        // UI's permutations desc can switch off the looser reactive estimate
        // before the worker pool starts emitting progress.
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
            ? results
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
            resPay: lazyTheory ? compPay : null,
            resultEchoes: [],
          },
        }))

        // leave the compile worker warm for the next run; do not tear it down
        // on the success path.

      } catch (error) {
        errorOpt('[optimizer:store] run failed', {
          runToken,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          elapsedMs: Math.round(performance.now() - runStartTime),
        })

        stopOptComhl(compWrkr)

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

      const actResId = getActResId(get().calculator)
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

      const actResId = getActResId(get().calculator)
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
          get().calculator.inventoryEchoes.map((entry) => [entry.echo.uid, entry.echo] as const),
      )

      const nextEchoes = result.uids
          .map((uid) => invChsByUid.get(uid) ?? null)
          .filter((echo): echo is EchoInstance => echo != null)
          .map((echo, i) => cloneEchoFor(echo, i))

      if (nextEchoes.length === 0) return

      const actResId = getActResId(get().calculator)
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

    const actResId = getActResId(get().calculator)
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
