/*
  Author: Runor Ewhro
  Description: shared combinadic indexing helpers for optimizer jobs (cpu and
               gpu). a job derives a combo index view and, in locked-main mode,
               an index map that excludes the locked echo from the selectable
               pool.
*/

import type { ComboIndex } from '@/engine/optimizer/combos/combinadic.ts'

// the slice of a packed execution payload needed to rebuild per-job combinadic
// state. costs is read only for its length, so any numeric array type works.
export interface JobComboPay {
  costs: ArrayLike<number>
  comboN: number
  comboK: number
  totalCombos: number
  comboIndexMap: Int32Array
  comboBinom: Uint32Array
  lockMainReq: boolean
  lockMainCands: Int32Array
}

// build a combo index map that excludes one locked main echo from the
// selectable pool. used by locked-main jobs whose locked echo is not the
// default one.
export function mkNdxMapXcld(payload: JobComboPay, lockedMainIndex: number): Int32Array {
  const indexMap = new Int32Array(payload.costs.length - 1)
  let cursor = 0

  for (let index = 0; index < payload.costs.length; index += 1) {
    if (index === lockedMainIndex) {
      continue
    }

    indexMap[cursor] = index
    cursor += 1
  }

  return indexMap
}

// derive the combinadic indexing view for one job. unlocked jobs reuse the
// payload's indexing directly; locked jobs may need a remapped index map
// depending on which locked main is active.
export function mkJobCmbNdxn(payload: JobComboPay, lockedMainIndex: number): ComboIndex {
  if (!payload.lockMainReq || lockedMainIndex < 0) {
    return {
      comboN: payload.comboN,
      comboK: payload.comboK,
      totalCombos: payload.totalCombos,
      indexMap: payload.comboIndexMap,
      binom: payload.comboBinom,
      lockedIndex: -1,
    }
  }

  const frstLckdMain = payload.lockMainCands[0] ?? -1

  // when this job uses the same locked main as the base payload, reuse the
  // original index map as-is.
  if (lockedMainIndex === frstLckdMain) {
    return {
      comboN: payload.comboN,
      comboK: payload.comboK,
      totalCombos: payload.totalCombos,
      indexMap: payload.comboIndexMap,
      binom: payload.comboBinom,
      lockedIndex: lockedMainIndex,
    }
  }

  // otherwise rebuild the candidate map for this locked echo.
  return {
    comboN: payload.comboN,
    comboK: payload.comboK,
    totalCombos: payload.totalCombos,
    indexMap: mkNdxMapXcld(payload, lockedMainIndex),
    binom: payload.comboBinom,
    lockedIndex: lockedMainIndex,
  }
}
