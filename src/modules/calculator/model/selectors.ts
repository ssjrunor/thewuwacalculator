/*
  Author: Runor Ewhro
  Description: chooses the correct live simulation path for the active
               resonator, using an existing combat graph when possible and
               falling back to a standalone resonator simulation otherwise.
*/

import { runCmbtGrphS, runResSmlt } from '@/engine/pipeline'
import type { ResSeed, ResRuntime } from '@/domain/entities/runtime'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import {
  mkPrepWork,
  runPrepWorkS,
  type PrepWork,
} from '@/engine/pipeline/preparedWorkspace'

export function mkPrepLiveCm(
  prepWork: PrepWork | null,
) {
  if (!prepWork) {
    return null
  }

  return runPrepWorkS(prepWork)
}

// build the current live computation result for the calculator
// returns null when the active runtime or seed is missing
export function mkLiveCmpt(
  runtime: ResRuntime | null,
  seed: ResSeed | null,
  enemy: EnemyProfile,
  runtimesById: Record<string, ResRuntime> = {},
  graph: CombatGraph | null = null,
  selTrgtByOwn: Record<string, string | null> = {},
) {
  if (!runtime || !seed) return null

  const prepWork = mkPrepWork({
    runtime,
    seed,
    enemy,
    prtcRntmById: runtimesById,
    activeTarget: selTrgtByOwn,
    combatGraph: graph,
  })

  const prepSmlt = runPrepWorkS(prepWork)
  if (prepSmlt) {
    // the prepared workspace path already knows how to simulate graph-aware and
    // standalone cases, so prefer it whenever it can materialize a result.
    return prepSmlt
  }

  // if we already have a combat graph whose active participant matches
  // this runtime, reuse the graph-based simulation path so all participant
  // interactions and graph state stay consistent
  if (graph?.participants.active?.resonatorId === runtime.id) {
    return runCmbtGrphS(graph, 'active', seed, enemy)
  }

  // otherwise simulate directly from the runtime plus any linked teammate runtimes
  return runResSmlt(runtime, seed, enemy, runtimesById, selTrgtByOwn)
}
