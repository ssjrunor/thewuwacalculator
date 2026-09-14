/*
  Author: Runor Ewhro
  Description: runs the full feature/rotation simulation for a resonator,
               then reshapes the produced entry lists into the result object
               the rest of the app consumes. Totalling those rows belongs to
               rotationTotals.
*/

import type { ResRuntime, ResSeed } from '@/domain/entities/runtime'
import type { CombatContext, SimResult } from '@/engine/pipeline/types'
import {
  runFeatureSimulation,
  type RunEnvironment,
  type RunDetail,
} from '@/engine/rotation/execute'
import { summarizeRotationEntries } from '@/engine/pipeline/rotationTotals'
import type { PrepDrctTpt } from '@/engine/pipeline/preparedWorkspace'
import type { RotationNode } from '@/domain/gameData/contracts'

// run the lower-level feature simulation, then reshape its output into the
// higher-level simulation result object expected by the rest of the app
export function smltRot(
    context: CombatContext,
    seed: ResSeed,
    runtimesById: Record<string, ResRuntime> = {},
    options: {
      directOutput?: PrepDrctTpt | null
      rotNvrn?: RunEnvironment | null
      sequence?: RotationNode[]
      program?: RotationNode[]
      detail?: RunDetail
    } = {},
): SimResult {
  // execute the core simulation for this combat context
  const simulation = runFeatureSimulation(
      context,
      seed,
      options.rotNvrn ?? undefined,
      options.directOutput?.allFeatures ?? undefined,
      {
        sequence: options.sequence,
        program: options.program,
        detail: options.detail,
      },
  )
  void runtimesById

  const sequence = summarizeRotationEntries(simulation.rotation.sequence.entries)
  const program = summarizeRotationEntries(simulation.rotation.program.entries)

  return {
    // final resolved combat stats for the active context
    finalStats: context.finalStats,

    // all simulated feature rows, including sub-hits and derived rows
    allFeatures: simulation.allFeatures,

    rotation: { sequence, program },

    // expose non-subhit feature rows as the "all skills" surface
    allSkills: simulation.allFeatures.filter((entry) => entry.feature.variant !== 'subHit'),

    perSkill: sequence.entries,
    total: sequence.total,
    totalsByGroup: sequence.totalsByGroup,
  }
}
