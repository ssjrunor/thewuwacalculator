/*
  Author: Runor Ewhro
  description: maps total scenario damage to baseline, benchmark, and perfect-build score anchors.
*/

import type { ScenarioRefs } from '@/domain/leaderboard/ruleset'
import { scorePercent } from '@/engine/evaluation/stats'

export type ScoreAnchors = Pick<ScenarioRefs, 'baselineDamage' | 'benchDamage' | 'perfectDamage'>

/** true when the three reference damage values can anchor a score. */
export function validAnchors({ baselineDamage, benchDamage, perfectDamage }: ScoreAnchors): boolean {
  return [baselineDamage, benchDamage, perfectDamage].every(Number.isFinite) && baselineDamage >= 0 &&
    baselineDamage < benchDamage && benchDamage < perfectDamage
}

/** the perfect build's score. scores are uncapped: one above it means the perfect anchor missed a better build, and
    it is flagged (overPerfect) and left unclamped. */
export const PERFECT_SCORE = 200

/** a score past the perfect build's, beyond float noise. */
export const overPerfect = (score: number | null | undefined) => score != null && score > PERFECT_SCORE + 1e-6

/** percent score of total damage, or null when the anchors are unusable. */
export function buildScore(damage: number, anchors: ScoreAnchors): number | null {
  if (!Number.isFinite(damage) || !validAnchors(anchors)) return null
  const { baselineDamage, benchDamage, perfectDamage } = anchors
  return 100 * scorePercent(damage, baselineDamage, benchDamage, perfectDamage)
}
