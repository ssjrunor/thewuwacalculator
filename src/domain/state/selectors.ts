/*
  Author: Runor Ewhro
  Description: Defines memoized store selectors for active runtime, combat,
               optimizer, team lookup, and calculator-derived state.
*/

import type { AppStore } from '@/domain/state/store'
import type { CalculatorState } from '@/domain/entities/appState'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { OptimizerContextState } from '@/domain/entities/optimizer'
import {
  buildInitializedRuntimeLookup,
  buildWorkspaceRuntimeBundle,
  getActiveResonatorId,
} from '@/domain/state/runtimeAdapters'
import { buildCombatGraphFromWorkspaceBundle } from '@/domain/state/combatGraph'
import { buildPreparedWorkspace, type PreparedWorkspace } from '@/engine/pipeline/preparedWorkspace'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'

interface WorkspaceDerivedState {
  preparedWorkspace: PreparedWorkspace
  activeRuntime: ResonatorRuntimeState | null
  participantRuntimesById: Record<string, ResonatorRuntimeState>
  activeTargetSelections: Record<string, string | null>
  combatGraph: ReturnType<typeof buildCombatGraphFromWorkspaceBundle>
}

interface OverviewDerivedState extends WorkspaceDerivedState {
  initializedRuntimesById: Record<string, ResonatorRuntimeState>
}

interface PreparedWorkspaceCacheEntry {
  runtimeRevision: number
  activeResonatorId: string | null
  enemyProfile: EnemyProfile
  value: WorkspaceDerivedState
}

interface InitializedRuntimeLookupCacheEntry {
  runtimeRevision: number
  value: Record<string, ResonatorRuntimeState>
}

let workspaceDerivedCache: PreparedWorkspaceCacheEntry | null = null
let overviewDerivedCache: {
  runtimeRevision: number
  activeResonatorId: string | null
  enemyProfile: EnemyProfile
  value: OverviewDerivedState
} | null = null
let initializedRuntimeLookupCache: InitializedRuntimeLookupCacheEntry | null = null

function buildWorkspaceDerived(calculator: CalculatorState): WorkspaceDerivedState {
  const workspace = buildWorkspaceRuntimeBundle(calculator)
  const combatGraph = buildCombatGraphFromWorkspaceBundle(calculator, workspace)
  const activeSeed = workspace.activeRuntime ? getResonatorSeedById(workspace.activeRuntime.id) : null
  const enemyProfile = calculator.session.enemyProfile

  return {
    preparedWorkspace: buildPreparedWorkspace({
      revision: calculator.runtimeRevision,
      runtime: workspace.activeRuntime,
      seed: activeSeed,
      enemy: enemyProfile,
      participantRuntimesById: workspace.participantRuntimesById,
      activeTargetSelections: workspace.activeTargetSelections,
      combatGraph,
    }),
    activeRuntime: workspace.activeRuntime,
    participantRuntimesById: workspace.participantRuntimesById,
    activeTargetSelections: workspace.activeTargetSelections,
    combatGraph,
  }
}

export function selectWorkspaceDerived(state: AppStore): WorkspaceDerivedState {
  const activeResonatorId = getActiveResonatorId(state.calculator)
  const enemyProfile = state.calculator.session.enemyProfile
  const cached = workspaceDerivedCache

  if (
    cached
    && cached.runtimeRevision === state.calculator.runtimeRevision
    && cached.activeResonatorId === activeResonatorId
    && cached.enemyProfile === enemyProfile
  ) {
    return cached.value
  }

  const value = buildWorkspaceDerived(state.calculator)
  workspaceDerivedCache = {
    runtimeRevision: state.calculator.runtimeRevision,
    activeResonatorId,
    enemyProfile,
    value,
  }
  return value
}

export function selectOverviewDerived(state: AppStore): OverviewDerivedState {
  const activeResonatorId = getActiveResonatorId(state.calculator)
  const enemyProfile = state.calculator.session.enemyProfile
  const cached = overviewDerivedCache

  if (
    cached
    && cached.runtimeRevision === state.calculator.runtimeRevision
    && cached.activeResonatorId === activeResonatorId
    && cached.enemyProfile === enemyProfile
  ) {
    return cached.value
  }

  const workspace = selectWorkspaceDerived(state)
  const initializedRuntimesById = selectInitializedRuntimeLookup(state)
  const value = {
    ...workspace,
    initializedRuntimesById,
  }

  overviewDerivedCache = {
    runtimeRevision: state.calculator.runtimeRevision,
    activeResonatorId,
    enemyProfile,
    value,
  }

  return value
}

// select the active resonator id
export function selectActiveResonatorId(state: AppStore): string | null {
  return getActiveResonatorId(state.calculator)
}

// select the current enemy profile
export function selectEnemyProfile(state: AppStore): EnemyProfile {
  return state.calculator.session.enemyProfile
}

// select the participant runtime lookup
export function selectParticipantRuntimeLookup(state: AppStore): Record<string, ResonatorRuntimeState> {
  return selectWorkspaceDerived(state).participantRuntimesById
}

// select the initialized runtime lookup
export function selectInitializedRuntimeLookup(state: AppStore): Record<string, ResonatorRuntimeState> {
  const cached = initializedRuntimeLookupCache
  if (cached && cached.runtimeRevision === state.calculator.runtimeRevision) {
    return cached.value
  }

  const value = buildInitializedRuntimeLookup(state.calculator)
  initializedRuntimeLookupCache = {
    runtimeRevision: state.calculator.runtimeRevision,
    value,
  }

  return value
}

// select the active target routing map
export function selectActiveTargetSelections(state: AppStore): Record<string, string | null> {
  return selectWorkspaceDerived(state).activeTargetSelections
}

// select the derived combat graph
export function selectCombatGraph(state: AppStore) {
  return selectWorkspaceDerived(state).combatGraph
}

// select the active runtime
export function selectActiveRuntime(state: AppStore): ResonatorRuntimeState | null {
  return selectWorkspaceDerived(state).activeRuntime
}

// select the optimizer context
export function selectOptimizerContext(state: AppStore): OptimizerContextState | null {
  return state.calculator.optimizerContext
}
