/*
  Author: Runor Ewhro
  Description: Defines the global zustand application store, including ui,
               runtime, inventory, and optimizer state management.
*/

import { create } from 'zustand'
import type {
  LeftPaneView,
  PersistedAppState,
  ThemeMode,
  ThemePreference,
  EnemyProfile,
  UiState,
} from '@/domain/entities/appState'
import type {
  BackgroundThemeVariant,
  BlurMode,
  DarkThemeVariant,
  LightThemeVariant,
} from '@/domain/entities/themes'
import type {
  ResonatorRuntimeState,
  EchoInstance,
  ResonatorSeed,
  ResonatorId,
  TeamMemberRuntimeView,
} from '@/domain/entities/runtime'
import type {
  InventoryEchoEntry,
  InventoryBuildEntry,
  InventoryRotationEntry,
  RotationEntrySummary,
} from '@/domain/entities/inventoryStorage'
import type { OptimizerContextState, OptimizerSettings } from '@/domain/entities/optimizer'
import type { ResonatorProfile } from '@/domain/entities/profile'
import type { ResonatorSuggestionsState } from '@/domain/entities/suggestions'
import type {
  OptimizerBagResultRef,
  OptimizerBackend,
  OptimizerProgress,
  OptimizerResultEntry,
  PreparedOptimizerPayload,
  OptimizerStatus,
  OptimizerStartPayload,
} from '@/engine/optimizer/types'
import {
  cancelActiveOptimizerWorkerPoolRun,
  resetOptimizerWorkerPool,
  runOptimizerWithWorkerPool,
} from '@/engine/optimizer/rebuild/workers/pool'
import { deriveInitialOptimizerSettings } from '@/engine/optimizer/rebuild/defaultSettings'
import type { OptimizerCompileOutMessage } from '@/engine/optimizer/compileWorker.types'
import {
  ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU,
  ECHO_OPTIMIZER_JOB_TARGET_COMBOS_GPU,
  ECHO_OPTIMIZER_JOB_TARGET_COMBOS_ROTATION_GPU,
} from '@/engine/optimizer/constants'
import {
  areEchoInstancesEquivalent,
  areBuildSnapshotsEquivalent,
  cloneEchoLoadout,
  cloneEchoForSlot,
  createInventoryEchoEntry,
  createInventoryBuildEntry,
  isEmptyBuildSnapshot,
  createInventoryRotationEntry,
  cloneRotationNodes,
} from '@/domain/entities/inventoryStorage'
import {
  createDefaultAppState,
  createDefaultResonatorSuggestionsState,
  createOptimizerContextFromRuntime,
  createDefaultResonatorProfile,
  initializePersistedAppState,
  DEFAULT_RESONATOR_ID,
} from '@/domain/state/defaults'
import { loadPersistedAppState, loadPersistedInventoryState } from '@/infra/persistence/storage'
import {
  applyRuntimeToCalculatorState,
  buildActiveRuntime,
  buildSelectedTargetResonatorMap,
  buildRuntimeFromProfile,
  buildTeamMemberRuntimeView,
  findSlotIdForResonator,
  getActiveResonatorId,
} from '@/domain/state/runtimeAdapters'
import { resonatorSeedsById } from '@/domain/services/resonatorSeedService'
import {
  cloneResonatorProfile,
  cloneSlotLocalStateValue,
} from '@/domain/state/runtimeCloning'
import { getSystemThemeMode, type ResolvedSystemThemeMode } from '@/shared/lib/systemTheme'

const INVENTORY_DEPENDENT_LEFT_PANE_VIEWS = new Set<LeftPaneView>(['echoes', 'teams', 'rotations'])

function bumpCalculatorRuntimeRevision<T extends { runtimeRevision: number }>(calculator: T): T {
  return {
    ...calculator,
    runtimeRevision: calculator.runtimeRevision + 1,
  }
}

function replaceCalculatorWithRuntimeRevision(
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

export interface AppStore extends PersistedAppState {
  inventoryOpen: boolean
  inventoryHasMounted: boolean
  inventoryHydrated: boolean
  optimizer: {
    status: OptimizerStatus
    progress: OptimizerProgress | null
    results: Array<OptimizerBagResultRef | OptimizerResultEntry>
    error: string | null
    batchSize: number | null
    resolutionPayload: PreparedOptimizerPayload | null
    resultEchoes: EchoInstance[]
  }
  hydrate: (payload: PersistedAppState) => void
  resetState: () => void
  ensureInventoryHydrated: () => void
  setTheme: (theme: ThemeMode) => void
  setThemePreference: (themePreference: ThemePreference) => void
  syncThemeWithSystem: (theme: ResolvedSystemThemeMode) => void
  setLightVariant: (variant: LightThemeVariant) => void
  setDarkVariant: (variant: DarkThemeVariant) => void
  setBackgroundVariant: (variant: BackgroundThemeVariant) => void
  setBackgroundImageKey: (key: string) => void
  setBackgroundTextMode: (mode: 'light' | 'dark') => void
  setBodyFontSelection: (fontName: string, fontUrl: string) => void
  setBlurMode: (mode: BlurMode) => void
  setEntranceAnimations: (mode: 'on' | 'off') => void
  setLeftPaneView: (view: LeftPaneView) => void
  setMainMode: (mode: 'default' | 'optimizer' | 'overview') => void
  setShowSubHits: (enabled: boolean) => void
  setOptimizerCpuHintSeen: (seen: boolean) => void
  setSavedRotationPreferences: (
      updater: (
          preferences: UiState['savedRotationPreferences'],
      ) => UiState['savedRotationPreferences'],
  ) => void
  setInventoryOpen: (open: boolean) => void
  setEnemyProfile: (enemy: EnemyProfile) => void
  setActiveResonator: (resonatorId: ResonatorId) => void
  activateResonator: (seed: ResonatorSeed) => void
  switchToResonator: (resonatorId: ResonatorId) => void
  deleteResonatorProfile: (resonatorId: ResonatorId, preferredNextResonatorId?: ResonatorId | null) => void
  resetResonator: (resonatorId: ResonatorId) => void
  loadResonatorProfile: (profile: ResonatorProfile) => void
  ensureResonatorRuntime: (seed: ResonatorSeed) => void
  ensureTeamMemberRuntime: (seed: ResonatorSeed) => void
  updateResonatorRuntime: (
      resonatorId: ResonatorId,
      updater: (runtime: ResonatorRuntimeState) => ResonatorRuntimeState,
  ) => void
  updateTeamMemberRuntimeView: (
      resonatorId: ResonatorId,
      updater: (runtimeView: TeamMemberRuntimeView) => TeamMemberRuntimeView,
  ) => void
  updateActiveResonatorRuntime: (
      updater: (runtime: ResonatorRuntimeState) => ResonatorRuntimeState,
  ) => void
  updateResonatorSuggestionsState: (
      resonatorId: ResonatorId,
      updater: (state: ResonatorSuggestionsState) => ResonatorSuggestionsState,
  ) => void
  updateActiveResonatorSuggestionsState: (
      updater: (state: ResonatorSuggestionsState) => ResonatorSuggestionsState,
  ) => void
  setResonatorTargetSelection: (
      resonatorId: ResonatorId,
      ownerKey: string,
      targetResonatorId: ResonatorId | null,
  ) => void
  addEchoToInventory: (echo: EchoInstance) => InventoryEchoEntry | null
  replaceInventoryEchoes: (echoes: EchoInstance[]) => void
  updateEchoInInventory: (entryId: string, echo: EchoInstance) => void
  removeEchoFromInventory: (entryId: string) => void
  clearInventoryEchoes: () => void
  addBuildToInventory: (input: {
    name?: string
    resonatorId: ResonatorId
    resonatorName: string
    build: {
      weapon: ResonatorRuntimeState['build']['weapon']
      echoes: Array<EchoInstance | null>
    }
  }) => InventoryBuildEntry | null
  updateInventoryBuild: (
      entryId: string,
      changes: Partial<Pick<InventoryBuildEntry, 'name'>> & {
        build?: {
          weapon: ResonatorRuntimeState['build']['weapon']
          echoes: Array<EchoInstance | null>
        }
      },
  ) => void
  removeInventoryBuild: (entryId: string) => void
  clearInventoryBuilds: () => void
  addRotationToInventory: (input: {
    name?: string
    mode: 'personal' | 'team'
    resonatorId: ResonatorId
    resonatorName: string
    team?: ResonatorRuntimeState['build']['team']
    items: ResonatorRuntimeState['rotation']['personalItems']
    snapshot?: ResonatorProfile
    summary?: RotationEntrySummary
  }) => InventoryRotationEntry | null
  updateInventoryRotation: (
      entryId: string,
      changes: Partial<Pick<InventoryRotationEntry, 'name'>> & {
        items?: ResonatorRuntimeState['rotation']['personalItems']
        team?: ResonatorRuntimeState['build']['team']
      },
  ) => void
  removeInventoryRotation: (entryId: string) => void
  clearInventoryRotations: () => void
  ensureOptimizerContext: () => void
  syncOptimizerContextToLiveRuntime: (resonatorId?: ResonatorId) => void
  updateOptimizerRuntime: (
      updater: (runtime: OptimizerContextState['runtime']) => OptimizerContextState['runtime'],
  ) => void
  updateOptimizerSettings: (
      updater: (settings: OptimizerSettings) => OptimizerSettings,
  ) => void
  clearOptimizerContext: () => void
  startOptimizer: (
      input: OptimizerStartPayload,
      hooks?: {
        onProgress?: (progress: OptimizerProgress) => void
      },
  ) => void
  cancelOptimizer: () => void
  clearOptimizerResults: () => void
  applyOptimizerResult: (index: number) => void
}

// build a default saved build name
function buildDefaultBuildName(resonatorName: string, existingCount: number): string {
  return `${resonatorName} Build ${existingCount + 1}`
}

// build a default saved rotation name
function buildDefaultRotationName(
    resonatorName: string,
    mode: 'personal' | 'team',
    existingCount: number,
): string {
  return mode === 'team'
      ? `${resonatorName} Team Rotation ${existingCount + 1}`
      : `${resonatorName} Rotation ${existingCount + 1}`
}

// create the initial app state, using persisted storage in the browser
function createInitialAppState(): PersistedAppState {
  if (typeof window === 'undefined') {
    return createDefaultAppState()
  }

  const baseState = loadPersistedAppState({ includeInventory: false }) ?? createDefaultAppState()
  if (
    baseState.ui.mainMode === 'optimizer'
    || INVENTORY_DEPENDENT_LEFT_PANE_VIEWS.has(baseState.ui.leftPaneView)
  ) {
    return loadPersistedAppState({ includeInventory: true }) ?? baseState
  }

  return baseState
}

// get an optimizer context synced to the current active runtime
function getSyncedOptimizerContext(state: AppStore): OptimizerContextState | null {
  const activeRuntime = buildActiveRuntime(state.calculator)
  if (!activeRuntime) {
    return null
  }

  const existing = state.calculator.optimizerContext
  if (existing?.resonatorId === activeRuntime.id) {
    return existing
  }

  return createOptimizerContextFromRuntime(
      activeRuntime,
      deriveInitialOptimizerSettings({
        runtime: activeRuntime,
        enemy: state.calculator.session.enemyProfile,
        selectedTargetsByOwnerKey: buildSelectedTargetResonatorMap(state.calculator),
      }),
  )
}

// rebuild an optimizer context from the current live runtime
function getOptimizerContextFromLiveRuntime(
    state: AppStore,
    resonatorId?: ResonatorId,
): OptimizerContextState | null {
  const targetResonatorId =
      resonatorId
      ?? state.calculator.optimizerContext?.resonatorId
      ?? getActiveResonatorId(state.calculator)

  if (!targetResonatorId) {
    return null
  }

  const liveRuntime = buildRuntimeFromProfile(state.calculator, targetResonatorId)
      ?? buildActiveRuntime(state.calculator)

  if (!liveRuntime) {
    return null
  }

  const existing = state.calculator.optimizerContext
  const settings = existing?.resonatorId === liveRuntime.id
      ? existing.settings
      : deriveInitialOptimizerSettings({
        runtime: liveRuntime,
        enemy: state.calculator.session.enemyProfile,
        selectedTargetsByOwnerKey: buildSelectedTargetResonatorMap(state.calculator),
      })

  return createOptimizerContextFromRuntime(liveRuntime, settings)
}

// optimizer worker lifecycle state
let optimizerRunToken = 0
let optimizerCompileWorker: Worker | null = null

// create or reuse the compile worker
function ensureOptimizerCompileWorker(): Worker {
  if (optimizerCompileWorker) {
    return optimizerCompileWorker
  }

  optimizerCompileWorker = new Worker(
      new URL('@/engine/optimizer/compile.worker.ts', import.meta.url),
      { type: 'module' },
  )
  return optimizerCompileWorker
}

// fully stop the compile worker
function stopOptimizerCompileWorker(): void {
  optimizerCompileWorker?.terminate()
  optimizerCompileWorker = null
}

// collect transferable buffers from a prepared optimizer payload
function collectPreparedPayloadTransferables(payload: PreparedOptimizerPayload): Transferable[] {
  const maybePush = (items: Transferable[], buffer: ArrayBufferLike) => {
    if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
      return
    }
    items.push(buffer)
  }

  const out: Transferable[] = []
  maybePush(out, payload.constraints.buffer)
  maybePush(out, payload.costs.buffer)
  maybePush(out, payload.sets.buffer)
  maybePush(out, payload.kinds.buffer)
  maybePush(out, payload.comboIndexMap.buffer)
  maybePush(out, payload.comboBinom.buffer)
  maybePush(out, payload.lockedMainCandidateIndices.buffer)

  if (payload.mode === 'rotation') {
    maybePush(out, payload.contexts.buffer)
    maybePush(out, payload.contextWeights.buffer)
    maybePush(out, payload.displayContext.buffer)
    maybePush(out, payload.stats.buffer)
    maybePush(out, payload.setConstLut.buffer)
    maybePush(out, payload.mainEchoBuffs.buffer)
    return out
  }

  maybePush(out, payload.stats.buffer)
  maybePush(out, payload.setConstLut.buffer)
  maybePush(out, payload.mainEchoBuffs.buffer)
  return out
}

// wait for a specific compile worker response type
async function waitForCompileWorkerMessage<T extends OptimizerCompileOutMessage['type']>(
    worker: Worker,
    runId: number,
    expectedType: T,
    dispatch: () => void,
): Promise<Extract<OptimizerCompileOutMessage, { type: T }>> {
  return await new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent<OptimizerCompileOutMessage>) => {
      const message = event.data
      if (message.runId !== runId) {
        return
      }

      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)

      if (message.type === 'error') {
        reject(new Error(message.message))
        return
      }

      if (message.type !== expectedType) {
        reject(new Error(`Unexpected optimizer compile worker response: ${message.type}`))
        return
      }

      resolve(message as Extract<OptimizerCompileOutMessage, { type: T }>)
    }

    const handleError = (event: ErrorEvent) => {
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
      reject(new Error(event.message || 'Optimizer compile worker failed unexpectedly'))
    }

    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)
    dispatch()
  })
}

// compile the optimizer payload in the worker
async function compileOptimizerPayloadInWorker(
    worker: Worker,
    runId: number,
    input: OptimizerStartPayload,
): Promise<PreparedOptimizerPayload> {
  const message = await waitForCompileWorkerMessage(worker, runId, 'done', () => {
    worker.postMessage({
      type: 'start',
      runId,
      payload: input,
    })
  })
  return message.payload
}

// materialize optimizer result refs into full result entries
async function materializeOptimizerResultsInWorker(
    worker: Worker,
    runId: number,
    payload: PreparedOptimizerPayload,
    results: OptimizerBagResultRef[],
    uidByIndex: string[],
    limit: number,
): Promise<OptimizerResultEntry[]> {
  const message = await waitForCompileWorkerMessage(worker, runId, 'materialized', () => {
    worker.postMessage({
      type: 'materialize',
      runId,
      payload,
      results,
      uidByIndex,
      limit,
    }, collectPreparedPayloadTransferables(payload))
  })
  return message.results
}

// infer the batch size before execution starts
function inferOptimizerBatchSizeFromInput(input: OptimizerStartPayload): number | null {
  if (input.settings.rotationMode) {
    return input.settings.enableGpu
        ? ECHO_OPTIMIZER_JOB_TARGET_COMBOS_ROTATION_GPU
        : ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU
  }

  return input.settings.enableGpu
      ? ECHO_OPTIMIZER_JOB_TARGET_COMBOS_GPU
      : ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU
}

// resolve the batch size from the chosen backend
function resolveOptimizerBatchSize(backend: OptimizerBackend): number | null {
  return backend === 'gpu'
      ? ECHO_OPTIMIZER_JOB_TARGET_COMBOS_GPU
      : ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU
}

// get a safe cloned suggestions state for a resonator
function getSuggestionsStateForResonator(
    state: AppStore,
    resonatorId: ResonatorId,
): ResonatorSuggestionsState {
  return state.calculator.suggestionsByResonatorId[resonatorId]
      ? structuredClone(state.calculator.suggestionsByResonatorId[resonatorId])
      : createDefaultResonatorSuggestionsState()
}

// main zustand store
const initialPersistedState = createInitialAppState()
const initialInventoryHydrated =
    initialPersistedState.ui.mainMode === 'optimizer'
    || INVENTORY_DEPENDENT_LEFT_PANE_VIEWS.has(initialPersistedState.ui.leftPaneView)

export const useAppStore = create<AppStore>((set, get) => ({
  ...initialPersistedState,
  inventoryOpen: false,
  inventoryHasMounted: false,
  inventoryHydrated: initialInventoryHydrated,
  optimizer: {
    status: 'idle',
    progress: null,
    results: [],
    error: null,
    batchSize: null,
    resolutionPayload: null,
    resultEchoes: [],
  },

  hydrate: (payload) => {
    set(() => ({
      ...initializePersistedAppState(payload),
      inventoryHydrated: true,
    }))
  },

  resetState: () => {
    stopOptimizerCompileWorker()
    cancelActiveOptimizerWorkerPoolRun()
    set(() => ({
      ...createDefaultAppState(),
      inventoryHydrated: false,
    }))
  },

  ensureInventoryHydrated: () => {
    if (get().inventoryHydrated || typeof window === 'undefined') {
      return
    }

    const inventory = loadPersistedInventoryState()
    set((state) => ({
      ...state,
      inventoryHydrated: true,
      calculator: {
        ...state.calculator,
        inventoryEchoes: inventory.inventoryEchoes,
        inventoryBuilds: inventory.inventoryBuilds,
        inventoryRotations: inventory.inventoryRotations,
      },
    }))
  },

  setTheme: (theme) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        theme,
        themePreference: theme,
      },
    }))
  },

  setThemePreference: (themePreference) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        themePreference,
        theme: themePreference === 'system'
          ? getSystemThemeMode()
          : themePreference,
      },
    }))
  },

  syncThemeWithSystem: (theme) => {
    set((state) => {
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
    })
  },

  setLightVariant: (lightVariant) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        lightVariant,
      },
    }))
  },

  setDarkVariant: (darkVariant) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        darkVariant,
      },
    }))
  },

  setBackgroundVariant: (backgroundVariant) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        backgroundVariant,
      },
    }))
  },

  setBackgroundImageKey: (backgroundImageKey) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        backgroundImageKey,
      },
    }))
  },

  setBackgroundTextMode: (backgroundTextMode) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        backgroundTextMode,
      },
    }))
  },

  setBodyFontSelection: (bodyFontName, bodyFontUrl) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        bodyFontName,
        bodyFontUrl,
      },
    }))
  },

  setBlurMode: (blurMode) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        blurMode,
      },
    }))
  },

  setEntranceAnimations: (entranceAnimations) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        entranceAnimations,
      },
    }))
  },

  setLeftPaneView: (leftPaneView) => {
    if (INVENTORY_DEPENDENT_LEFT_PANE_VIEWS.has(leftPaneView)) {
      get().ensureInventoryHydrated()
    }

    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        leftPaneView,
      },
    }))
  },

  setMainMode: (mainMode) => {
    if (mainMode === 'optimizer') {
      get().ensureInventoryHydrated()
    }

    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        mainMode,
      },
      calculator: {
        ...state.calculator,
        optimizerContext: mainMode === 'optimizer'
            ? getSyncedOptimizerContext(state)
            : state.calculator.optimizerContext,
      },
    }))
  },

  setShowSubHits: (showSubHits) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        showSubHits,
      },
    }))
  },

  setOptimizerCpuHintSeen: (optimizerCpuHintSeen) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        optimizerCpuHintSeen,
      },
    }))
  },

  setSavedRotationPreferences: (updater) => {
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        savedRotationPreferences: updater(state.ui.savedRotationPreferences),
      },
    }))
  },

  setInventoryOpen: (inventoryOpen) => {
    if (inventoryOpen) {
      get().ensureInventoryHydrated()
    }

    set((state) => ({
      ...state,
      inventoryOpen,
      inventoryHasMounted: state.inventoryHasMounted || inventoryOpen,
    }))
  },

  setEnemyProfile: (enemyProfile) => {
    set((state) => ({
      ...state,
      calculator: bumpCalculatorRuntimeRevision({
        ...state.calculator,
        session: {
          ...state.calculator.session,
          enemyProfile,
        },
      }),
    }))
  },

  setActiveResonator: (resonatorId) => {
    if (get().calculator.session.activeResonatorId === resonatorId) {
      return
    }

    set((state) => ({
      ...state,
      calculator: bumpCalculatorRuntimeRevision({
        ...state.calculator,
        session: {
          ...state.calculator.session,
          activeResonatorId: resonatorId,
        },
      }),
    }))
  },

  activateResonator: (seed) => {
    set((state) => {
      const existing = state.calculator.profiles[seed.id]
      if (existing && state.calculator.session.activeResonatorId === seed.id) {
        return state
      }

      return {
        ...state,
        calculator: bumpCalculatorRuntimeRevision({
          ...state.calculator,
          profiles: existing
              ? state.calculator.profiles
              : {
                ...state.calculator.profiles,
                [seed.id]: createDefaultResonatorProfile(seed),
              },
          suggestionsByResonatorId: state.calculator.suggestionsByResonatorId[seed.id]
              ? state.calculator.suggestionsByResonatorId
              : {
                ...state.calculator.suggestionsByResonatorId,
                [seed.id]: createDefaultResonatorSuggestionsState(),
              },
          session: {
            ...state.calculator.session,
            activeResonatorId: seed.id,
          },
        }),
      }
    })
  },

  switchToResonator: (resonatorId) => {
    const seed = resonatorSeedsById[resonatorId]
    if (!seed) return
    get().activateResonator(seed)
  },

  deleteResonatorProfile: (resonatorId, preferredNextResonatorId = null) => {
    set((state) => {
      const targetProfile = state.calculator.profiles[resonatorId]
      if (!targetProfile) {
        return state
      }

      const nextProfiles = { ...state.calculator.profiles }
      const nextSuggestionsByResonatorId = { ...state.calculator.suggestionsByResonatorId }

      delete nextProfiles[resonatorId]
      delete nextSuggestionsByResonatorId[resonatorId]

      const remainingIds = Object.keys(nextProfiles)
      const activeResonatorId = state.calculator.session.activeResonatorId

      if (remainingIds.length === 0) {
        const fallbackSeed = resonatorSeedsById[DEFAULT_RESONATOR_ID]
        if (!fallbackSeed) {
          return {
            ...state,
            calculator: bumpCalculatorRuntimeRevision({
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
          calculator: bumpCalculatorRuntimeRevision({
            ...state.calculator,
            profiles: {
              [fallbackSeed.id]: createDefaultResonatorProfile(fallbackSeed),
            },
            suggestionsByResonatorId: {
              [fallbackSeed.id]: createDefaultResonatorSuggestionsState(),
            },
            session: {
              ...state.calculator.session,
              activeResonatorId: fallbackSeed.id,
            },
          }),
        }
      }

      const resolvedNextActiveId =
        activeResonatorId === resonatorId
          ? (
              (preferredNextResonatorId && nextProfiles[preferredNextResonatorId]
                ? preferredNextResonatorId
                : null)
              ?? remainingIds[0]
            )
          : activeResonatorId && nextProfiles[activeResonatorId]
            ? activeResonatorId
            : (
                (preferredNextResonatorId && nextProfiles[preferredNextResonatorId]
                  ? preferredNextResonatorId
                  : null)
                ?? remainingIds[0]
              )

      return {
        ...state,
        calculator: bumpCalculatorRuntimeRevision({
          ...state.calculator,
          profiles: nextProfiles,
          suggestionsByResonatorId: nextSuggestionsByResonatorId,
          session: {
            ...state.calculator.session,
            activeResonatorId: resolvedNextActiveId,
          },
        }),
      }
    })
  },

  resetResonator: (resonatorId) => {
    const seed = resonatorSeedsById[resonatorId]
    if (!seed) return

    set((state) => {
      if (!state.calculator.profiles[resonatorId]) return state

      return {
        ...state,
        calculator: bumpCalculatorRuntimeRevision({
          ...state.calculator,
          profiles: {
            ...state.calculator.profiles,
            [resonatorId]: createDefaultResonatorProfile(seed),
          },
        }),
      }
    })
  },

  loadResonatorProfile: (profile) => {
    set((state) => ({
      ...state,
      calculator: bumpCalculatorRuntimeRevision({
        ...state.calculator,
        profiles: {
          ...state.calculator.profiles,
          [profile.resonatorId]: cloneResonatorProfile(profile),
        },
      }),
    }))
  },

  ensureResonatorRuntime: (seed) => {
    const existing = get().calculator.profiles[seed.id]
    if (existing && get().calculator.suggestionsByResonatorId[seed.id]) return

    const profile = createDefaultResonatorProfile(seed)

    set((state) => ({
      ...state,
      calculator: bumpCalculatorRuntimeRevision({
        ...state.calculator,
        profiles: {
          ...state.calculator.profiles,
          ...(state.calculator.profiles[seed.id] ? {} : { [seed.id]: profile }),
        },
        suggestionsByResonatorId: state.calculator.suggestionsByResonatorId[seed.id]
            ? state.calculator.suggestionsByResonatorId
            : {
              ...state.calculator.suggestionsByResonatorId,
              [seed.id]: createDefaultResonatorSuggestionsState(),
            },
        session:
            state.calculator.session.activeResonatorId != null
                ? state.calculator.session
                : {
                  ...state.calculator.session,
                  activeResonatorId: seed.id,
                },
      }),
    }))
  },

  ensureTeamMemberRuntime: (seed) => {
    void seed
    // no-op: team member runtimes are created when the teammate is actually assigned to a slot
    // this stays as a stable api for callers that previously ensured a profile existed
  },

  updateResonatorRuntime: (resonatorId, updater) => {
    const target = buildRuntimeFromProfile(get().calculator, resonatorId)
    if (!target) return

    const next = updater(target)
    if (next === target) return

    set((state) => ({
      ...state,
      calculator: replaceCalculatorWithRuntimeRevision(
          state.calculator,
          applyRuntimeToCalculatorState(state.calculator, resonatorId, next),
      ),
    }))
  },

  updateTeamMemberRuntimeView: (resonatorId, updater) => {
    const target = buildTeamMemberRuntimeView(get().calculator, resonatorId)
    if (!target) return

    const next = updater(target)
    if (next === target) return

    const activeRuntime = buildRuntimeFromProfile(get().calculator, resonatorId)
    if (!activeRuntime) {
      return
    }

      const bridgedRuntime: ResonatorRuntimeState = {
      ...activeRuntime,
      base: {
        ...activeRuntime.base,
        sequence: next.base.sequence,
      },
      build: {
        ...activeRuntime.build,
        weapon: {
          ...activeRuntime.build.weapon,
          id: next.build.weapon.id,
          rank: next.build.weapon.rank,
          baseAtk: next.build.weapon.baseAtk,
        },
        echoes: next.build.echoes,
      },
      state: cloneSlotLocalStateValue(next.state),
    }

    set((state) => ({
      ...state,
      calculator: replaceCalculatorWithRuntimeRevision(
          state.calculator,
          applyRuntimeToCalculatorState(state.calculator, resonatorId, bridgedRuntime),
      ),
    }))
  },

  updateActiveResonatorRuntime: (updater) => {
    const activeResonatorId = getActiveResonatorId(get().calculator)
    if (!activeResonatorId) return
    get().updateResonatorRuntime(activeResonatorId, updater)
  },

  updateResonatorSuggestionsState: (resonatorId, updater) => {
    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        suggestionsByResonatorId: {
          ...state.calculator.suggestionsByResonatorId,
          [resonatorId]: updater(getSuggestionsStateForResonator(state, resonatorId)),
        },
      },
    }))
  },

  updateActiveResonatorSuggestionsState: (updater) => {
    const activeResonatorId = getActiveResonatorId(get().calculator)
    if (!activeResonatorId) return
    get().updateResonatorSuggestionsState(activeResonatorId, updater)
  },

  setResonatorTargetSelection: (resonatorId, ownerKey, targetResonatorId) => {
    set((state) => {
      // for teammates, write routing to the active resonator's profile
      const slotId = findSlotIdForResonator(state.calculator, resonatorId)
      const profileId = slotId && slotId !== 'active'
          ? getActiveResonatorId(state.calculator)
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
          [ownerKey]: targetResonatorId,
        },
      }

      return {
        ...state,
        calculator: bumpCalculatorRuntimeRevision({
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
    })
  },

  addEchoToInventory: (echo) => {
    get().ensureInventoryHydrated()
    const existing = get().calculator.inventoryEchoes.find((entry) =>
        areEchoInstancesEquivalent(entry.echo, echo),
    )

    if (existing) {
      return null
    }

    const nextEntry = createInventoryEchoEntry(echo)
    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryEchoes: [...state.calculator.inventoryEchoes, nextEntry],
      },
    }))

    return nextEntry
  },

  replaceInventoryEchoes: (echoes) => {
    get().ensureInventoryHydrated()
    const dedupedEchoes = echoes.reduce<EchoInstance[]>((acc, echo) => {
      if (acc.some((existing) => areEchoInstancesEquivalent(existing, echo))) {
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

    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryEchoes: dedupedEchoes.map((echo, index) => createInventoryEchoEntry(echo, now + index)),
      },
    }))
  },

  updateEchoInInventory: (entryId, echo) => {
    get().ensureInventoryHydrated()
    set((state) => ({
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
    }))
  },

  removeEchoFromInventory: (entryId) => {
    get().ensureInventoryHydrated()
    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryEchoes: state.calculator.inventoryEchoes.filter((entry) => entry.id !== entryId),
      },
    }))
  },

  clearInventoryEchoes: () => {
    get().ensureInventoryHydrated()
    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryEchoes: [],
      },
    }))
  },

  addBuildToInventory: ({ name, resonatorId, resonatorName, build }) => {
    get().ensureInventoryHydrated()
    if (isEmptyBuildSnapshot(build)) {
      return null
    }

    const existing = get().calculator.inventoryBuilds.find((entry) =>
        areBuildSnapshotsEquivalent(entry.build, build),
    )

    if (existing) {
      return null
    }

    const builds = get().calculator.inventoryBuilds
    const nextEntry = createInventoryBuildEntry({
      name: name?.trim() || buildDefaultBuildName(resonatorName, builds.length),
      resonatorId,
      resonatorName,
      build,
    })

    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryBuilds: [...state.calculator.inventoryBuilds, nextEntry],
      },
    }))

    return nextEntry
  },

  updateInventoryBuild: (entryId, changes) => {
    get().ensureInventoryHydrated()
    set((state) => ({
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
                    echoes: cloneEchoLoadout(changes.build.echoes),
                  },
                }
                : {}),
            updatedAt: Date.now(),
          }
        }),
      },
    }))
  },

  removeInventoryBuild: (entryId) => {
    get().ensureInventoryHydrated()
    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryBuilds: state.calculator.inventoryBuilds.filter((entry) => entry.id !== entryId),
      },
    }))
  },

  clearInventoryBuilds: () => {
    get().ensureInventoryHydrated()
    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryBuilds: [],
      },
    }))
  },

  addRotationToInventory: ({ name, mode, resonatorId, resonatorName, team, items, snapshot, summary }) => {
    get().ensureInventoryHydrated()
    const rotations = get().calculator.inventoryRotations
    const nextEntry = createInventoryRotationEntry({
      name: name?.trim() || buildDefaultRotationName(
          resonatorName,
          mode,
          rotations.filter((entry) => entry.mode === mode).length,
      ),
      mode,
      resonatorId,
      resonatorName,
      ...(mode === 'team' && team ? { team } : {}),
      items,
      snapshot,
      summary,
    })

    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryRotations: [...state.calculator.inventoryRotations, nextEntry],
      },
    }))

    return nextEntry
  },

  updateInventoryRotation: (entryId, changes) => {
    get().ensureInventoryHydrated()
    set((state) => ({
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
            ...(changes.team !== undefined
                ? {
                  team: changes.team
                      ? [...changes.team] as ResonatorRuntimeState['build']['team']
                      : undefined,
                }
                : {}),
            ...(changes.items ? { items: cloneRotationNodes(changes.items) } : {}),
            updatedAt: Date.now(),
          }
        }),
      },
    }))
  },

  removeInventoryRotation: (entryId) => {
    get().ensureInventoryHydrated()
    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryRotations: state.calculator.inventoryRotations.filter((entry) => entry.id !== entryId),
      },
    }))
  },

  clearInventoryRotations: () => {
    get().ensureInventoryHydrated()
    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        inventoryRotations: [],
      },
    }))
  },

  ensureOptimizerContext: () => {
    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        optimizerContext: getSyncedOptimizerContext(state),
      },
    }))
  },

  syncOptimizerContextToLiveRuntime: (resonatorId) => {
    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        optimizerContext: getOptimizerContextFromLiveRuntime(state, resonatorId),
      },
    }))
  },

  updateOptimizerRuntime: (updater) => {
    set((state) => {
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
            runtime: updater(existing.runtime),
          },
        },
      }
    })
  },

  updateOptimizerSettings: (updater) => {
    set((state) => {
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
    })
  },

  clearOptimizerContext: () => {
    set((state) => ({
      ...state,
      calculator: {
        ...state.calculator,
        optimizerContext: null,
      },
    }))
  },

  startOptimizer: (input, hooks = {}) => {
    const current = get()
    if (current.optimizer.status === 'running') {
      current.cancelOptimizer()
    }

    stopOptimizerCompileWorker()
    resetOptimizerWorkerPool()
    const runToken = ++optimizerRunToken

    set((state) => ({
      ...state,
      optimizer: {
        status: 'running' as const,
        progress: null,
        results: [],
        error: null,
        batchSize: inferOptimizerBatchSizeFromInput(input),
        resolutionPayload: null,
        resultEchoes: [],
      },
    }))

    const compileWorker = ensureOptimizerCompileWorker()

    void (async () => {
      try {
        const compiledPayload = await compileOptimizerPayloadInWorker(compileWorker, runToken, input)
        if (optimizerRunToken !== runToken) {
          return
        }

        const backend: OptimizerBackend = input.settings.enableGpu ? 'gpu' : 'cpu'

        set((state) => ({
          ...state,
          optimizer: {
            ...state.optimizer,
            batchSize:
                compiledPayload.mode === 'rotation' && backend === 'gpu'
                    ? ECHO_OPTIMIZER_JOB_TARGET_COMBOS_ROTATION_GPU
                    : resolveOptimizerBatchSize(backend),
            resolutionPayload: null,
          },
        }))

        const results = await runOptimizerWithWorkerPool(compiledPayload, backend, {
          onProgress: (progress) => {
            if (optimizerRunToken !== runToken) {
              return
            }

            hooks.onProgress?.(progress)
          },
        })

        if (optimizerRunToken !== runToken) {
          return
        }

        const finalizedResults = await materializeOptimizerResultsInWorker(
            compileWorker,
            runToken,
            compiledPayload,
            results,
            input.inventoryEchoes.map((echo) => echo.uid),
            results.length,
        )

        if (optimizerRunToken !== runToken) {
          return
        }

        set((state) => ({
          ...state,
          optimizer: {
            status: 'done',
            progress: state.optimizer.progress,
            results: finalizedResults,
            error: null,
            batchSize: state.optimizer.batchSize,
            resolutionPayload: null,
            resultEchoes: [],
          },
        }))

        if (optimizerCompileWorker === compileWorker) {
          stopOptimizerCompileWorker()
        }
      } catch (error) {
        if (optimizerCompileWorker === compileWorker) {
          stopOptimizerCompileWorker()
        }

        if (optimizerRunToken !== runToken) {
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
            resolutionPayload: null,
            resultEchoes: [],
          },
        }))
      }
    })()
  },

  cancelOptimizer: () => {
    optimizerRunToken += 1
    stopOptimizerCompileWorker()
    cancelActiveOptimizerWorkerPoolRun()

    set((state) => ({
      ...state,
      optimizer: {
        status: 'cancelled',
        progress: state.optimizer.progress,
        results: state.optimizer.results,
        error: null,
        batchSize: state.optimizer.batchSize,
        resolutionPayload: state.optimizer.resolutionPayload,
        resultEchoes: state.optimizer.resultEchoes,
      },
    }))
  },

  clearOptimizerResults: () => {
    stopOptimizerCompileWorker()
    set((state) => ({
      ...state,
      optimizer: {
        status: 'idle',
        progress: null,
        results: [],
        error: null,
        batchSize: null,
        resolutionPayload: null,
        resultEchoes: [],
      },
    }))
  },

  applyOptimizerResult: (index) => {
    const result = get().optimizer.results[index]
    if (!result) return

    // apply materialized uid-based results
    if ('uids' in result && Array.isArray(result.uids)) {
      const inventoryEchoesByUid = new Map(
          get().calculator.inventoryEchoes.map((entry) => [entry.echo.uid, entry.echo] as const),
      )

      const nextEchoes = result.uids
          .map((uid) => inventoryEchoesByUid.get(uid) ?? null)
          .filter((echo): echo is EchoInstance => echo != null)
          .map((echo, i) => cloneEchoForSlot(echo, i))

      if (nextEchoes.length === 0) return

      const activeResonatorId = getActiveResonatorId(get().calculator)
      if (!activeResonatorId) return

      get().updateResonatorRuntime(activeResonatorId, (runtime) => ({
        ...runtime,
        build: {
          ...runtime.build,
          echoes: nextEchoes,
        },
      }))
      return
    }

    // apply bag index-based results
    const bagResult = result as OptimizerBagResultRef
    const resultEchoes = get().optimizer.resultEchoes
    const nextEchoes = [
      resultEchoes[bagResult.i0] ?? null,
      resultEchoes[bagResult.i1] ?? null,
      resultEchoes[bagResult.i2] ?? null,
      resultEchoes[bagResult.i3] ?? null,
      resultEchoes[bagResult.i4] ?? null,
    ]
        .filter((echo): echo is EchoInstance => echo != null)
        .map((echo, i) => cloneEchoForSlot(echo, i))

    if (nextEchoes.length === 0) return

    const activeResonatorId = getActiveResonatorId(get().calculator)
    if (!activeResonatorId) return

    get().updateResonatorRuntime(activeResonatorId, (runtime) => ({
      ...runtime,
      build: {
        ...runtime.build,
        echoes: nextEchoes,
      },
    }))
  },
}))
