/*
  Author: Runor Ewhro
  Description: applies encoded set bonus rows to the combo stat vector
               based on the resolved piece-count bucket for each touched set.
*/

import { getSetCntBkt, getSetRowFfs } from '@/engine/optimizer/encode/sets.ts'

// add the encoded set-effect contribution for each touched set into the combo vector
export function applySetFfct(
    comboVector: Float32Array,
    setCounts: Uint8Array,
    tchdSetIds: Uint8Array,
    tchdSetCnt: number,
    setConstLut: Float32Array,
): void {
  for (let index = 0; index < tchdSetCnt; index += 1) {
    const setId = tchdSetIds[index]

    // map the raw piece count to the encoded bucket used by the set lut
    const bucket = getSetCntBkt(setCounts[setId] ?? 0)
    if (bucket <= 0) {
      continue
    }

    // compute the starting row offset for this set id + bucket pair
    const base = getSetRowFfs(setId, bucket)

    // add the full encoded stat row into the combo vector
    // only the first 9 elements (atkP through er) map directly to the start of comboVector
    for (let offset = 0; offset < 9; offset += 1) {
      comboVector[offset] += setConstLut[base + offset]
    }

    // skip piece-count specific fields (basic, heavy, etc.) as they are handled elsewhere
    // or mapped differently in the combo vector
  }
}
