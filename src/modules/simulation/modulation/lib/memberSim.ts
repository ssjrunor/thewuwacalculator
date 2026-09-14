/*
  Author: Runor Ewhro
  Description: Builds the live simulation for a progression member from the
               current scenario's member runtimes, environment routing, and
               enemy. Member zero reuses the prepared scenario workspace;
               teammates receive an equivalent member-scoped workspace.
*/

import { useCallback, useMemo } from 'react'
import type { CombatScenario } from '@/domain/entities/combatScenario.ts'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SimResult } from '@/engine/pipeline/types'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { selLiveRun } from '@/modules/simulation/model/selectors.ts'
import { mkPrepWork } from '@/engine/pipeline/preparedWorkspace'
import { prepareCombatScenarioForUi } from '@/engine/pipeline/combatScenario.ts'
import { makeStateSummary, type StateGroup } from '@/modules/simulation/model/stateSummary.ts'

export interface MemberAnalysis {
  simulation: SimResult | null
  stateGroupsForStat: (statKey: string) => StateGroup[]
}

export function useMemberAnalysis(
  runtime: ResRuntime | null,
  scenario: CombatScenario | null,
): MemberAnalysis {
  const prepared = useMemo(
    () => scenario ? prepareCombatScenarioForUi(scenario) : null,
    [scenario],
  )
  const memberId = runtime?.id ?? null
  const analyzedRuntime = memberId ? prepared?.runtimesById[memberId] ?? runtime : null
  const seed = memberId ? seedRsntById[memberId] ?? null : null
  const isSubject = Boolean(memberId && memberId === prepared?.subjectRuntime.id)
  const combatGraph = prepared?.workspace.combatGraph ?? null

  const memberWork = useMemo(() => {
    if (!analyzedRuntime || !seed || !prepared) return null
    if (isSubject) return prepared.workspace
    return mkPrepWork({
      revision: scenario?.revision ?? 0,
      runtime: analyzedRuntime,
      seed,
      enemy: prepared.scenario.target,
      prtcRntmById: prepared.runtimesById,
      activeTarget: prepared.selectedTargets,
      combatGraph,
    })
  }, [analyzedRuntime, combatGraph, isSubject, prepared, scenario?.revision, seed])

  const simulation = useMemo(() => selLiveRun(memberWork), [memberWork])
  const stateGroupsForStat = useCallback((statKey: string) => makeStateSummary(
    analyzedRuntime,
    prepared?.runtimesById ?? {},
    combatGraph,
    prepared?.selectedTargets ?? {},
    {
      cntxByResId: memberWork?.cntxByResId,
      enemyProfile: prepared?.scenario.target,
      activeRuntime: prepared?.subjectRuntime,
      showAllStates: false,
      statTarget: { key: statKey },
    },
  ), [analyzedRuntime, combatGraph, memberWork, prepared])

  return { simulation, stateGroupsForStat }
}
