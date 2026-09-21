/*
  Author: Runor Ewhro
  Description: resolves raw Echo set counts into activated Sonata set plans.
*/

import { getEchoSetDe } from '@/data/gameData/echoSets/effects'

export interface EffectiveSetPlanEntry {
  setId: number
  pieces: number
}

export function effectiveSetPieces(setId: number, count: number): number | null {
  const set = getEchoSetDe(setId)
  if (!set) return null
  if (set.setMax === 1) return count >= 1 ? 1 : null
  if (set.setMax === 3) return count >= 3 ? 3 : null
  return count >= 5 ? 5 : count >= 2 ? 2 : null
}

export function isUtilitySet(setId: number): boolean {
  return getEchoSetDe(setId)?.type === 'utility'
}

export function isMaxSetPlan(setId: number, pieces: number): boolean {
  const set = getEchoSetDe(setId)
  return Boolean(set && pieces === set.setMax)
}

export function makeEffectiveSetPlan(
  counts: Iterable<readonly [number, number]>,
): EffectiveSetPlanEntry[] {
  const result: EffectiveSetPlanEntry[] = []
  for (const [setId, count] of counts) {
    const pieces = effectiveSetPieces(setId, count)
    if (setId > 0 && pieces != null) result.push({ setId, pieces })
  }
  return result.sort((left, right) => right.pieces - left.pieces || left.setId - right.setId)
}
