/*
  Author: Runor Ewhro
  Description: derives the runtime, combat graph, prepared workspace,
               simulation, and active-state summary for whichever resonator is
               currently being evaluationed.
*/

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime, ResSeed } from '@/domain/entities/runtime'
import { makeCombatGraph } from '@/domain/state/combatGraph'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { mkPrepLiveCm } from '@/modules/simulation/model/selectors.ts'
import { makeStateSummary, type StateGroup } from '@/modules/simulation/model/stateSummary.ts'
import { mkPrepWork, type PrepWork } from '@/engine/pipeline/preparedWorkspace'
import type { SimResult } from '@/engine/pipeline/types'
import { scheduleAfterSettled } from '@/shared/lib/scheduleAfterSettled.ts'

interface EvaluationTargetIn {
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
  deferHeavyWork?: boolean
}

export interface EvaluationTarget {
  runtimesById: Record<string, ResRuntime>
  combatGraph: PrepWork['combatGraph'] | null
  prepWork: PrepWork | null
  simulation: SimResult | null
  stateGroups: StateGroup[]
  stateGroupsForStat: (statKey: string) => StateGroup[]
}

export function useEvaluationTarget({
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
  deferHeavyWork = false,
}: EvaluationTargetIn): EvaluationTarget {
  const settleInputs = useMemo(() => [
    targetRuntime,
    targetSeed,
    targetSelections,
    activeResId,
    activePrepWork,
    activeRuntimesById,
    initializedRuntimesById,
    enemy,
    showAllStates,
    activeSimulation,
    activeStateGroups,
  ], [
    activePrepWork,
    activeResId,
    activeRuntimesById,
    activeSimulation,
    activeStateGroups,
    enemy,
    initializedRuntimesById,
    showAllStates,
    targetRuntime,
    targetSeed,
    targetSelections,
  ])
  const [settledInputs, setSettledInputs] = useState<readonly unknown[] | null>(
    () => deferHeavyWork ? null : settleInputs,
  )

  /* eslint-disable react-hooks/set-state-in-effect -- this state is the external idle-scheduler boundary. */
  useEffect(() => {
    if (!deferHeavyWork) {
      return undefined
    }

    setSettledInputs(null)
    return scheduleAfterSettled(() => setSettledInputs(settleInputs))
  }, [deferHeavyWork, settleInputs])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Compare the settled input identity during render so a new edit cannot run
  // one stale heavy memo before the effect has a chance to reset the gate.
  const heavyWorkReady = !deferHeavyWork || settledInputs === settleInputs
  const resolvedTargetRuntime = heavyWorkReady ? targetRuntime : null
  const resolvedTargetSeed = heavyWorkReady ? targetSeed : null
  const isActive = Boolean(resolvedTargetRuntime && resolvedTargetRuntime.id === activeResId)

  // inactive targets need a synthetic team map with the target runtime spliced
  // in, while the active resonator can reuse the already prepared team map
  const runtimesById = useMemo(() => {
    if (!resolvedTargetRuntime) return activeRuntimesById
    return makeRuntimeMap(
      resolvedTargetRuntime,
      isActive ? activeRuntimesById : initializedRuntimesById,
    )
  }, [activeRuntimesById, initializedRuntimesById, isActive, resolvedTargetRuntime])

  // active evaluation views reuse the live combat graph so state toggles stay
  // identical to the live simulation, but off-target previews build a local graph
  const combatGraph = useMemo(() => {
    if (!resolvedTargetRuntime) return null
    if (isActive) return activePrepWork?.combatGraph ?? null
    return makeCombatGraph({
      actRt: resolvedTargetRuntime,
      partRts: runtimesById,
      targetsByRes: { [resolvedTargetRuntime.id]: targetSelections },
    })
  }, [activePrepWork, isActive, resolvedTargetRuntime, runtimesById, targetSelections])

  // if callers supplied active simulation and state groups, there is no need to
  // rebuild prep work only to derive values that already came from live state
  const prepWork = useMemo(() => {
    if (!resolvedTargetRuntime || !resolvedTargetSeed) return null
    if (isActive && activePrepWork) return activePrepWork
    if (isActive && activeSimulation !== undefined && activeStateGroups !== undefined) return null
    return mkPrepWork({
      runtime: resolvedTargetRuntime,
      seed: resolvedTargetSeed,
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
    resolvedTargetRuntime,
    resolvedTargetSeed,
    targetSelections,
  ])

  // simulation is nullable rather than always recomputed so inactive or missing
  // seeds cannot accidentally use stale active results
  const simulation = useMemo(() => {
    if (isActive && activeSimulation !== undefined) return activeSimulation
    return mkPrepLiveCm(resolvedTargetSeed ? prepWork : null)
  }, [activeSimulation, isActive, prepWork, resolvedTargetSeed])

  // state groups must follow the same graph and prep work as the simulated
  // damage or the source list can explain a different build than it scores
  const stateGroups = useMemo(() => {
    if (isActive && activeStateGroups !== undefined) return activeStateGroups
    return makeStateSummary(resolvedTargetRuntime, runtimesById, combatGraph, targetSelections, {
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
    resolvedTargetRuntime,
    targetSelections,
  ])

  const stateGroupsForStat = useCallback((statKey: string) => makeStateSummary(
      resolvedTargetRuntime,
      runtimesById,
      combatGraph,
      targetSelections,
      {
        cntxByResId: prepWork?.cntxByResId,
        enemyProfile: enemy,
        showAllStates: false,
        statTarget: { key: statKey },
      },
  ), [
    combatGraph,
    enemy,
    prepWork,
    resolvedTargetRuntime,
    runtimesById,
    targetSelections,
  ])

  return { runtimesById, combatGraph, prepWork, simulation, stateGroups, stateGroupsForStat }
}
