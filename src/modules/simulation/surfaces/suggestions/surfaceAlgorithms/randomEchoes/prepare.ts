/*
  Author: Runor Ewhro
  Description: Converts simulation inputs into random-Echo worker data and
               applies the configured bias to its stat-weight distribution.
*/

import type { SimResult } from '@/engine/pipeline/types'
import type { OptStatWeight } from '@/engine/optimizer/search/filtering'
import {
  mkSuggVltnCt,
  mkSuggWghtMa,
} from '@/engine/suggestions/shared'
import type { RandomEchoInput, RandomEchoPrep } from './types'

function applyWeightBias(
    weights: OptStatWeight,
    bias: number,
): OptStatWeight {
  const entries = Object.entries(weights)
  if (entries.length === 0) {
    return weights
  }

  const avg = entries.reduce((sum, [, value]) => sum + (value ?? 0), 0) / entries.length

  return Object.fromEntries(
      entries.map(([key, value]) => [
        key,
        Math.max(0.05, avg + (((value ?? 0) - avg) * Math.max(0, Math.min(1, bias)))),
      ]),
  )
}

export function prepareRandomEchoGeneration(
    input: RandomEchoInput,
    simulation: SimResult,
): RandomEchoPrep | null {
  const context = mkSuggVltnCt(input, simulation)
  if (!context) {
    return null
  }

  const rawWeightMap = mkSuggWghtMa(simulation, input, input.settings.bias)

  return {
    context,
    runtimeId: input.runtime.id,
    rawWeightMap,
    statWeight: applyWeightBias(rawWeightMap, input.settings.bias),
    settings: input.settings,
    resultsLimit: input.resultsLimit,
  }
}
