/*
  Author: Runor Ewhro
  Description: builds the compact target-search payload used by cpu and gpu
               optimizer runners, including packed target context data.
*/

import type {
  PackedSkill,
  PrepTheoryTarget,
  PrepTargetSkill,
} from '@/engine/optimizer/types.ts'
import { packTargetCtx } from '@/engine/optimizer/context/pack.ts'

// choose the first allowed locked main candidate when the run requested one;
// otherwise default to "no locked echo"
type TgtPrepPay = PrepTargetSkill | PrepTheoryTarget

function resDefLckdEc(prepared: TgtPrepPay): number {
  return prepared.lockMainReq
      ? (prepared.lockMainCands[0] ?? -1)
      : -1
}

export function packTargetSkill(
    prepared: TgtPrepPay,
    options: {
      comboCount?: number
      comboBaseIndex?: number
      lockEchoIdx?: number
    } = {},
): PackedSkill {
  return {
    mode: 'targetSkill',

    // shared optimizer search settings
    resultsLimit: prepared.resultsLimit,
    lowMmryMode: prepared.lowMmryMode,
    constraints: prepared.constraints,

    // encoded inventory data consumed directly by cpu/gpu evaluators
    costs: prepared.costs,
    sets: prepared.sets,
    kinds: prepared.kinds,

    // combinadic indexing metadata for enumerating combos
    comboN: prepared.comboN,
    comboK: prepared.comboK,
    totalCombos: prepared.totalCombos,
    comboIndexMap: prepared.comboIndexMap,
    comboBinom: prepared.comboBinom,

    // locked-main bookkeeping stays available to downstream search code
    lockMainReq: prepared.lockMainReq,
    lockMainCands: prepared.lockMainCands,
    progFact: prepared.progFact,

    // pack the dense target context now so evaluators only need one flat float buffer
    // options can override the combo span / base offset / locked echo for sub-jobs
    context: packTargetCtx({
      compiled: prepared.compiled,
      skill: prepared.skill,
      runtime: prepared.runtime,
      comboN: prepared.comboN,
      comboK: prepared.comboK,
      comboCount: options.comboCount ?? prepared.totalCombos,
      comboBaseIndex: options.comboBaseIndex ?? 0,
      lockEchoIdx: options.lockEchoIdx ?? resDefLckdEc(prepared),
      setRtMask: prepared.setRtMask,
    }),

    // pre-encoded rows reused across every combo evaluation
    stats: prepared.stats,
    setConstLut: prepared.setConstLut,
    mainEchoBuffs: prepared.mainEchoBuffs,
  }
}

export function shrPckdTgtSk(
    payload: PackedSkill,
): PackedSkill {
  // if shared buffers are unavailable, or the context is already shared,
  // return the payload unchanged
  if (typeof SharedArrayBuffer === 'undefined' || payload.context.buffer instanceof SharedArrayBuffer) {
    return payload
  }

  // copy just the context into shared memory so worker threads can reuse it
  // without transferring ownership or duplicating fresh buffers repeatedly
  const shrdCtx = new Float32Array(new SharedArrayBuffer(payload.context.byteLength))
  shrdCtx.set(payload.context)

  return {
    ...payload,
    context: shrdCtx,
  }
}
