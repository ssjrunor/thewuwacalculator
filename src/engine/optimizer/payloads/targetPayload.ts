/*
  Author: Runor Ewhro
  Description: builds the compact target-search payload used by cpu and gpu
               optimizer runners, including packed target context data.
*/

import type {
  PackedTargetSkillExecutionPayload,
  PreparedTargetSkillRun,
} from '@/engine/optimizer/types.ts'
import { packTargetContext } from '@/engine/optimizer/context/pack.ts'

// choose the first allowed locked main candidate when the run requested one;
// otherwise default to "no locked echo"
function resolveDefaultLockedEchoIndex(prepared: PreparedTargetSkillRun): number {
  return prepared.lockedMainRequested
      ? (prepared.lockedMainCandidateIndices[0] ?? -1)
      : -1
}

export function createPackedTargetSkillExecution(
    prepared: PreparedTargetSkillRun,
    options: {
      comboCount?: number
      comboBaseIndex?: number
      lockedEchoIndex?: number
    } = {},
): PackedTargetSkillExecutionPayload {
  return {
    mode: 'targetSkill',

    // shared optimizer search settings
    resultsLimit: prepared.resultsLimit,
    lowMemoryMode: prepared.lowMemoryMode,
    constraints: prepared.constraints,

    // encoded inventory data consumed directly by cpu/gpu evaluators
    costs: prepared.costs,
    sets: prepared.sets,
    kinds: prepared.kinds,

    // combinadic indexing metadata for enumerating combos
    comboN: prepared.comboN,
    comboK: prepared.comboK,
    comboTotalCombos: prepared.comboTotalCombos,
    comboIndexMap: prepared.comboIndexMap,
    comboBinom: prepared.comboBinom,

    // locked-main bookkeeping stays available to downstream search code
    lockedMainRequested: prepared.lockedMainRequested,
    lockedMainCandidateIndices: prepared.lockedMainCandidateIndices,
    progressFactor: prepared.progressFactor,

    // pack the dense target context now so evaluators only need one flat float buffer
    // options can override the combo span / base offset / locked echo for sub-jobs
    context: packTargetContext({
      compiled: prepared.compiled,
      skill: prepared.skill,
      runtime: prepared.runtime,
      comboN: prepared.comboN,
      comboK: prepared.comboK,
      comboCount: options.comboCount ?? prepared.comboTotalCombos,
      comboBaseIndex: options.comboBaseIndex ?? 0,
      lockedEchoIndex: options.lockedEchoIndex ?? resolveDefaultLockedEchoIndex(prepared),
      setRuntimeMask: prepared.setRuntimeMask,
    }),

    // pre-encoded rows reused across every combo evaluation
    stats: prepared.stats,
    setConstLut: prepared.setConstLut,
    mainEchoBuffs: prepared.mainEchoBuffs,
  }
}

export function sharePackedTargetSkillExecution(
    payload: PackedTargetSkillExecutionPayload,
): PackedTargetSkillExecutionPayload {
  // if shared buffers are unavailable, or the context is already shared,
  // return the payload unchanged
  if (typeof SharedArrayBuffer === 'undefined' || payload.context.buffer instanceof SharedArrayBuffer) {
    return payload
  }

  // copy just the context into shared memory so worker threads can reuse it
  // without transferring ownership or duplicating fresh buffers repeatedly
  const sharedContext = new Float32Array(new SharedArrayBuffer(payload.context.byteLength))
  sharedContext.set(payload.context)

  return {
    ...payload,
    context: sharedContext,
  }
}
