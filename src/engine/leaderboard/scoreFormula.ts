/*
  Author: Runor Ewhro
  description: maps scenario DPS to baseline, benchmark, and perfect-build score anchors.
*/

import type { ScenarioRefs } from '@/domain/leaderboard/ruleset'

export type ScoreAnchors = Pick<ScenarioRefs, 'baselineDps' | 'benchDps' | 'perfectDps'>

/** true when the three reference dps values can anchor a score. */
export function validAnchors({ baselineDps, benchDps, perfectDps }: ScoreAnchors): boolean {
  return [baselineDps, benchDps, perfectDps].every(Number.isFinite) && baselineDps >= 0 &&
    baselineDps < benchDps && benchDps < perfectDps
}

/** percent score of `dps`, or null when the anchors are unusable. */
export function buildScore(dps: number, anchors: ScoreAnchors): number | null {
  if (!Number.isFinite(dps) || !validAnchors(anchors)) return null
  const { baselineDps, benchDps, perfectDps } = anchors
  // the lower segment is clamped at zero; results above the perfect anchor continue along the upper segment's slope.
  if (dps <= benchDps) return Math.max(0, 100 * (dps - baselineDps) / (benchDps - baselineDps))
  return 100 + 100 * (dps - benchDps) / (perfectDps - benchDps)
}
