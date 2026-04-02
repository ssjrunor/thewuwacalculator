/*
  Author: Runor Ewhro
  Description: applies encoded set bonus rows to the combo stat vector
               based on the resolved piece-count bucket for each touched set.
*/

import { OPTIMIZER_STATS_PER_ECHO } from '@/engine/optimizer/config/constants.ts'
import { getSetCountBucket, getSetRowOffset } from '@/engine/optimizer/encode/sets.ts'

// add the encoded set-effect contribution for each touched set into the combo vector
export function applySetEffectsEncoded(
    comboVector: Float32Array,
    setCounts: Uint8Array,
    touchedSetIds: Uint8Array,
    touchedSetCount: number,
    setConstLut: Float32Array,
): void {
  for (let index = 0; index < touchedSetCount; index += 1) {
    const setId = touchedSetIds[index]

    // map the raw piece count to the encoded bucket used by the set lut
    const bucket = getSetCountBucket(setCounts[setId] ?? 0)
    if (bucket <= 0) {
      continue
    }

    // compute the starting row offset for this set id + bucket pair
    const base = getSetRowOffset(setId, bucket)

    // add the full encoded stat row into the combo vector
    for (let offset = 0; offset < OPTIMIZER_STATS_PER_ECHO; offset += 1) {
      comboVector[offset] += setConstLut[base + offset]
    }
  }
}
