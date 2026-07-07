/*
  Author: Runor Ewhro
  Description: runs the full feature/rotation simulation for a resonator,
               then derives personal/team totals and aggregation buckets
               from the produced entry lists.
*/

import type { ResRuntime, ResSeed } from '@/domain/entities/runtime'
import type { CombatContext, DamageTotals, SimResult } from '@/engine/pipeline/types'
import {
  runFeatSmlt,
  type PrepRotNvrn,
  type RotSimulationDetail,
  type RotSimulationMode,
} from '@/engine/rotation/system'
import type { SkillAggType } from '@/domain/entities/stats'
import type { PrepDrctTpt } from '@/engine/pipeline/preparedWorkspace'
import type { FeatureResult } from '@/domain/gameData/contracts'

function getLoopVrgDv(entry: FeatureResult): number {
  if (!entry.loopRunCounts) {
    return 1
  }

  return Object.values(entry.loopRunCounts).reduce(
      (divisor, runs) => divisor * Math.max(1, Math.floor(runs)),
      1,
  )
}

function addNrmlEntTt(total: DamageTotals, entry: FeatureResult): void {
  const divisor = getLoopVrgDv(entry)
  total.normal += entry.normal / divisor
  total.crit += entry.crit / divisor
  total.avg += entry.avg / divisor
}

// sum only direct damage entries into one total bundle
// healing and shield rows are ignored here because this helper is meant for damage totals
function sumRotTtls(entries: SimResult['perSkill']): DamageTotals {
  return entries.reduce(
      (acc, entry) => {
        if (entry.aggregationType !== 'damage') {
          return acc
        }

        addNrmlEntTt(acc, entry)
        return acc
      },
      { normal: 0, crit: 0, avg: 0 },
  )
}

// build an empty totals object for every supported aggregation bucket
// this gives reducers a stable shape to accumulate into
function mkAggTtls(): Record<SkillAggType, DamageTotals> {
  return {
    damage: { normal: 0, crit: 0, avg: 0 },
    healing: { normal: 0, crit: 0, avg: 0 },
    shield: { normal: 0, crit: 0, avg: 0 },
  }
}

// sum all entries into their matching aggregation bucket
// unlike sumRotationTotals, this preserves damage/healing/shield separation
function sumTtlsByAgg(entries: SimResult['perSkill']): Record<SkillAggType, DamageTotals> {
  return entries.reduce((acc, entry) => {
    const bucket = acc[entry.aggregationType]
    addNrmlEntTt(bucket, entry)
    return acc
  }, mkAggTtls())
}

// run the lower-level feature simulation, then reshape its output into the
// higher-level simulation result object expected by the rest of the app
export function smltRot(
    context: CombatContext,
    seed: ResSeed,
    runtimesById: Record<string, ResRuntime> = {},
    options: {
      directOutput?: PrepDrctTpt | null
      rotNvrn?: PrepRotNvrn | null
      mode?: RotSimulationMode
      detail?: RotSimulationDetail
    } = {},
): SimResult {
  // execute the core simulation for this combat context
  const simulation = runFeatSmlt(
      context,
      seed,
      runtimesById,
      options.rotNvrn ?? undefined,
      options.directOutput?.allFeatures ?? undefined,
      {
        mode: options.mode,
        detail: options.detail,
      },
  )

  // split out personal and team rotation entry lists for summary building
  const persEnts = simulation.rotations.personal.entries
  const teamEntries = simulation.rotations.team.entries

  // compute overall damage-only totals for each rotation view
  const persTtl = sumRotTtls(persEnts)
  const teamTotal = sumRotTtls(teamEntries)

  // compute per-aggregation totals so healing and shield outputs are preserved too
  const persTtlsByAg = sumTtlsByAgg(persEnts)
  const teamTtlsByAg = sumTtlsByAgg(teamEntries)

  return {
    // final resolved combat stats for the active context
    finalStats: context.finalStats,

    // all simulated feature rows, including sub-hits and derived rows
    allFeatures: simulation.allFeatures,

    // detailed personal/team rotation outputs with both overall damage totals
    // and per-aggregation bucket totals
    rotations: {
      personal: {
        entries: persEnts,
        total: persTtl,
        totalsByGroup: persTtlsByAg,
      },
      team: {
        entries: teamEntries,
        total: teamTotal,
        totalsByGroup: teamTtlsByAg,
      },
    },

    // expose non-subhit feature rows as the "all skills" surface
    allSkills: simulation.allFeatures.filter((entry) => entry.feature.variant !== 'subHit'),

    // keep personal rotation as the default per-skill / total summary surface
    perSkill: persEnts,
    total: persTtl,
    totalsByGroup: persTtlsByAg,
  }
}
