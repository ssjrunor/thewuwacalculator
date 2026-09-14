/*
  Author: Runor Ewhro
  Description: Implements rotation totals data-flow and calculation invariants.
*/

import type { FeatureResult } from '@/domain/gameData/contracts'
import type { SkillAggType } from '@/domain/entities/stats'
import type { DamageTotals } from '@/engine/pipeline/types'

/** A rotation total is always a damage total; support outputs stay row-local. */
export function isDamageRotationEntry(
  entry: Pick<FeatureResult, 'aggregationType'>,
): boolean {
  return entry.aggregationType === 'damage'
}

export function getLoopAverageDivisor(loopRunCounts: Record<string, number> | undefined): number {
  if (!loopRunCounts) {
    return 1
  }

  return Object.values(loopRunCounts).reduce(
      (divisor, runs) => divisor * Math.max(1, Math.floor(runs)),
      1,
  )
}

/**
 * The same divisor with one loop left out, for totals stated per run of that
 * loop: the surrounding passes still divide, the loop's own passes do not.
 */
export function getOtherLoopAverageDivisor(
  loopRunCounts: Record<string, number> | undefined,
  loopId: string | null,
): number {
  if (!loopRunCounts || !loopId) {
    return getLoopAverageDivisor(loopRunCounts)
  }

  return getLoopAverageDivisor(
    Object.fromEntries(
      Object.entries(loopRunCounts).filter(([candidate]) => candidate !== loopId),
    ),
  )
}

/*
  a row inside a loop is simulated once per pass, so left as it is the totals
  would read the whole rotation rather than one pass of it. dividing by the
  passes states every row as what one pass is worth, which is what the app
  means by a rotation total. `normalizeLoops: false` asks for the other
  reading: every pass counted, the rotation as it actually ran.
*/
function addNrmlEntTt(total: DamageTotals, entry: FeatureResult, normalizeLoops: boolean): void {
  const divisor = normalizeLoops ? getLoopAverageDivisor(entry.loopRunCounts) : 1
  total.normal += entry.normal / divisor
  total.crit += entry.crit / divisor
  total.avg += entry.avg / divisor
}

// sum only direct damage entries into one total bundle
// healing and shield rows are ignored here because this helper is meant for damage totals
export function sumRotTtls(
    entries: readonly FeatureResult[],
    options: { normalizeLoops?: boolean } = {},
): DamageTotals {
  const normalizeLoops = options.normalizeLoops ?? true

  return entries.reduce(
      (acc, entry) => {
        if (!isDamageRotationEntry(entry)) {
          return acc
        }

        addNrmlEntTt(acc, entry, normalizeLoops)
        return acc
      },
      { normal: 0, crit: 0, avg: 0 },
  )
}

/** Both readings of the same rows in one pass, for surfaces that show each. */
export function sumRotTtlsPair(entries: readonly FeatureResult[]): {
  totals: DamageTotals
  fullTotals: DamageTotals
} {
  const totals = { normal: 0, crit: 0, avg: 0 }
  const fullTotals = { normal: 0, crit: 0, avg: 0 }
  for (const entry of entries) {
    if (!isDamageRotationEntry(entry)) continue
    addNrmlEntTt(totals, entry, true)
    addNrmlEntTt(fullTotals, entry, false)
  }
  return { totals, fullTotals }
}

/** Average damage attributed to each run of each loop, keyed by loop id. */
export function indexLoopDamageByRun(
  entries: readonly FeatureResult[],
): Map<string, Record<number, number>> {
  const byLoopId = new Map<string, Record<number, number>>()
  for (const entry of entries) {
    if (!isDamageRotationEntry(entry)) {
      continue
    }
    for (const [loopId, run] of Object.entries(entry.loopRuns ?? {})) {
      let byRun = byLoopId.get(loopId)
      if (!byRun) {
        byRun = {}
        byLoopId.set(loopId, byRun)
      }
      byRun[run] = (byRun[run] ?? 0)
        + entry.avg / getOtherLoopAverageDivisor(entry.loopRunCounts, loopId)
    }
  }
  return byLoopId
}

function mkAggTtls(): Record<SkillAggType, DamageTotals> {
  return {
    damage: { normal: 0, crit: 0, avg: 0 },
    healing: { normal: 0, crit: 0, avg: 0 },
    shield: { normal: 0, crit: 0, avg: 0 },
  }
}

/** Separate support output totals for displays; never use these for damage score. */
export function sumRotTtlsByAgg(
  entries: readonly FeatureResult[],
  options: { normalizeLoops?: boolean } = {},
): Record<SkillAggType, DamageTotals> {
  const normalizeLoops = options.normalizeLoops ?? true
  return entries.reduce((acc, entry) => {
    addNrmlEntTt(acc[entry.aggregationType], entry, normalizeLoops)
    return acc
  }, mkAggTtls())
}

/** Both loop-normalized and full-run support totals from one entry list. */
export function sumRotTtlsByAggPair(entries: readonly FeatureResult[]): {
  totalsByGroup: Record<SkillAggType, DamageTotals>
  fullTotalsByGroup: Record<SkillAggType, DamageTotals>
} {
  const totalsByGroup = mkAggTtls()
  const fullTotalsByGroup = mkAggTtls()
  for (const entry of entries) {
    addNrmlEntTt(totalsByGroup[entry.aggregationType], entry, true)
    addNrmlEntTt(fullTotalsByGroup[entry.aggregationType], entry, false)
  }
  return { totalsByGroup, fullTotalsByGroup }
}

export interface RotationEntrySummary {
  entries: readonly FeatureResult[]
  total: DamageTotals
  totalsByGroup: Record<SkillAggType, DamageTotals>
}

export function summarizeRotationEntries(entries: FeatureResult[]): {
  entries: FeatureResult[]
  total: DamageTotals
  totalsByGroup: Record<SkillAggType, DamageTotals>
} {
  return {
    entries,
    total: sumRotTtls(entries),
    totalsByGroup: sumRotTtlsByAgg(entries),
  }
}
