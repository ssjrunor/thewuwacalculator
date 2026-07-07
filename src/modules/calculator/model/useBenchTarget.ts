/*
  Author: Runor Ewhro
  Description: derives the runtime, combat graph, prepared workspace,
               simulation, and active-state summary for whichever resonator is
               currently being benchmarked.
*/

import { useMemo } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime, ResSeed } from '@/domain/entities/runtime'
import { makeCombatGraph } from '@/domain/state/combatGraph'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { mkPrepLiveCm } from '@/modules/calculator/model/selectors.ts'
import { makeStateSummary, type StateGroup } from '@/modules/calculator/model/stateSummary.ts'
import { mkPrepWork, type PrepWork } from '@/engine/pipeline/preparedWorkspace'
import type { SimResult } from '@/engine/pipeline/types'

interface BenchTargetIn {
  targetRuntime: ResRuntime | null
  targetSeed: ResSeed | null
  targetSelections: Record<string, string | null>
  activeResId: string | null
  activePrepWork?: PrepWork | null
  activeRuntimesById: Record<string, ResRuntime>
  initializedRuntimesById: Record<string, ResRuntime>
  enemy: EnemyProfile
  showAllStates: boolean
  activeSimulation?: SimResult | null
  activeStateGroups?: StateGroup[]
}

export interface BenchTarget {
  runtimesById: Record<string, ResRuntime>
  combatGraph: PrepWork['combatGraph'] | null
  prepWork: PrepWork | null
  simulation: SimResult | null
  stateGroups: StateGroup[]
}

export function useBenchTarget({
  targetRuntime,
  targetSeed,
  targetSelections,
  activeResId,
  activePrepWork = null,
  activeRuntimesById,
  initializedRuntimesById,
  enemy,
  showAllStates,
  activeSimulation,
  activeStateGroups,
}: BenchTargetIn): BenchTarget {
  const isActive = Boolean(targetRuntime && targetRuntime.id === activeResId)

  // inactive targets need a synthetic team map with the target runtime spliced
  // in, while the active resonator can reuse the already prepared team map
  const runtimesById = useMemo(() => {
    if (!targetRuntime) return activeRuntimesById
    return makeRuntimeMap(
      targetRuntime,
      isActive ? activeRuntimesById : initializedRuntimesById,
    )
  }, [activeRuntimesById, initializedRuntimesById, isActive, targetRuntime])

  // active benchmark views reuse the live combat graph so state toggles stay
  // identical to the calculator, but off-target previews build a local graph
  const combatGraph = useMemo(() => {
    if (!targetRuntime) return null
    if (isActive) return activePrepWork?.combatGraph ?? null
    return makeCombatGraph({
      actRt: targetRuntime,
      partRts: runtimesById,
      targetsByRes: { [targetRuntime.id]: targetSelections },
    })
  }, [activePrepWork, isActive, runtimesById, targetRuntime, targetSelections])

  // if callers supplied active simulation and state groups, there is no need to
  // rebuild prep work only to derive values that already came from live state
  const prepWork = useMemo(() => {
    if (!targetRuntime || !targetSeed) return null
    if (isActive && activePrepWork) return activePrepWork
    if (isActive && activeSimulation !== undefined && activeStateGroups !== undefined) return null
    return mkPrepWork({
      runtime: targetRuntime,
      seed: targetSeed,
      enemy,
      prtcRntmById: runtimesById,
      activeTarget: targetSelections,
      combatGraph,
    })
  }, [
    activePrepWork,
    activeSimulation,
    activeStateGroups,
    combatGraph,
    enemy,
    isActive,
    runtimesById,
    targetRuntime,
    targetSeed,
    targetSelections,
  ])

  // simulation is nullable rather than always recomputed so inactive or missing
  // seeds cannot accidentally use stale active results
  const simulation = useMemo(() => {
    if (isActive && activeSimulation !== undefined) return activeSimulation
    return mkPrepLiveCm(targetSeed ? prepWork : null)
  }, [activeSimulation, isActive, prepWork, targetSeed])

  // state groups must follow the same graph and prep work as the simulated
  // damage or the source list can explain a different build than it scores
  const stateGroups = useMemo(() => {
    if (isActive && activeStateGroups !== undefined) return activeStateGroups
    return makeStateSummary(targetRuntime, runtimesById, combatGraph, targetSelections, {
      cntxByResId: prepWork?.cntxByResId,
      enemyProfile: enemy,
      showAllStates,
    })
  }, [
    activeStateGroups,
    combatGraph,
    enemy,
    isActive,
    prepWork,
    runtimesById,
    showAllStates,
    targetRuntime,
    targetSelections,
  ])

  return { runtimesById, combatGraph, prepWork, simulation, stateGroups }
}
