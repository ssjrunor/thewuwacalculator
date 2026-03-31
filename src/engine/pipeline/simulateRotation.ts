/*
  Author: Runor Ewhro
  Description: runs the full feature/rotation simulation for a resonator,
               then derives personal/team totals and aggregation buckets
               from the produced entry lists.
*/

import type { ResonatorRuntimeState, ResonatorSeed } from '@/domain/entities/runtime'
import type { CombatContext, DamageTotals, SimulationResult } from '@/engine/pipeline/types'
import { runFeatureSimulation, type PreparedRotationEnvironment } from '@/engine/rotation/system'
import type { SkillAggregationType } from '@/domain/entities/stats'
import type { PreparedDirectOutput } from '@/engine/pipeline/preparedWorkspace'

// sum only direct damage entries into one total bundle
// healing and shield rows are ignored here because this helper is meant for damage totals
function sumRotationTotals(entries: SimulationResult['perSkill']): DamageTotals {
  return entries.reduce(
      (acc, entry) => {
        if (entry.aggregationType !== 'damage') {
          return acc
        }

        acc.normal += entry.normal
        acc.crit += entry.crit
        acc.avg += entry.avg
        return acc
      },
      { normal: 0, crit: 0, avg: 0 },
  )
}

// build an empty totals object for every supported aggregation bucket
// this gives reducers a stable shape to accumulate into
function makeAggregationTotals(): Record<SkillAggregationType, DamageTotals> {
  return {
    damage: { normal: 0, crit: 0, avg: 0 },
    healing: { normal: 0, crit: 0, avg: 0 },
    shield: { normal: 0, crit: 0, avg: 0 },
  }
}

// sum all entries into their matching aggregation bucket
// unlike sumRotationTotals, this preserves damage/healing/shield separation
function sumTotalsByAggregation(entries: SimulationResult['perSkill']): Record<SkillAggregationType, DamageTotals> {
  return entries.reduce((acc, entry) => {
    const bucket = acc[entry.aggregationType]
    bucket.normal += entry.normal
    bucket.crit += entry.crit
    bucket.avg += entry.avg
    return acc
  }, makeAggregationTotals())
}

// run the lower-level feature simulation, then reshape its output into the
// higher-level simulation result object expected by the rest of the app
export function simulateRotation(
    context: CombatContext,
    seed: ResonatorSeed,
    runtimesById: Record<string, ResonatorRuntimeState> = {},
    options: {
      directOutput?: PreparedDirectOutput | null
      rotationEnvironment?: PreparedRotationEnvironment | null
    } = {},
): SimulationResult {
  // execute the core simulation for this combat context
  const simulation = runFeatureSimulation(
      context,
      seed,
      runtimesById,
      options.rotationEnvironment ?? undefined,
      options.directOutput?.allFeatures ?? undefined,
  )

  // split out personal and team rotation entry lists for summary building
  const personalEntries = simulation.rotations.personal.entries
  const teamEntries = simulation.rotations.team.entries

  // compute overall damage-only totals for each rotation view
  const personalTotal = sumRotationTotals(personalEntries)
  const teamTotal = sumRotationTotals(teamEntries)

  // compute per-aggregation totals so healing and shield outputs are preserved too
  const personalTotalsByAggregation = sumTotalsByAggregation(personalEntries)
  const teamTotalsByAggregation = sumTotalsByAggregation(teamEntries)

  return {
    // final resolved combat stats for the active context
    finalStats: context.finalStats,

    // all simulated feature rows, including sub-hits and derived rows
    allFeatures: simulation.allFeatures,

    // detailed personal/team rotation outputs with both overall damage totals
    // and per-aggregation bucket totals
    rotations: {
      personal: {
        entries: personalEntries,
        total: personalTotal,
        totalsByAggregation: personalTotalsByAggregation,
      },
      team: {
        entries: teamEntries,
        total: teamTotal,
        totalsByAggregation: teamTotalsByAggregation,
      },
    },

    // expose non-subhit feature rows as the "all skills" surface
    allSkills: simulation.allFeatures.filter((entry) => entry.feature.variant !== 'subHit'),

    // keep personal rotation as the default per-skill / total summary surface
    perSkill: personalEntries,
    total: personalTotal,
    totalsByAggregation: personalTotalsByAggregation,
  }
}
