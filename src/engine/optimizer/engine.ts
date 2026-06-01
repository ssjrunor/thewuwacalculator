/*
  Author: Runor Ewhro
  Description: Orchestrates optimizer compilation, packed CPU execution,
               main-candidate collection, and final result materialization.
*/

import type {
  OptBagResult,
  OptFinalResult,
  OptPrgr,
  OptRawResult,
  OptStartPay,
  PckdOptXctnP,
  PckdRotXctnP,
  PackedSkill,
  PrepOptPay,
  PrepTheoryRot,
  PrepTheoryTarget,
} from '@/engine/optimizer/types'
import { compOptPay } from '@/engine/optimizer/compiler'
import { matOptRslts, matThryRslts } from '@/engine/optimizer/results/materialize.ts'
import { packRotation } from '@/engine/optimizer/payloads/rotationPayload'
import { packTargetSkill } from '@/engine/optimizer/payloads/targetPayload'
import { runRotSrchBt, runRotSrchFo } from '@/engine/optimizer/search/rotationCpu'
import { runTgtSrchBt, runTgtSrchFo } from '@/engine/optimizer/search/targetCpu'
import { gnrtThryCpuCm } from '@/engine/optimizer/target/theoryBatches.ts'
import { OptResultSet } from '@/engine/optimizer/results/collector.ts'
import { mkOptPrgrTrc } from '@/engine/optimizer/search/progress.ts'
import { CPU_THEORY_JOB } from '@/engine/optimizer/config/constants.ts'

// hooks used during optimizer execution for cancellation and progress reporting
interface OptRunHks {
  isCancelled?: () => boolean
  onProgress?: (progress: OptPrgr) => void
  onProcessed?: (prcsDlt: number) => void
}

type InvPrepPay = Extract<PrepOptPay, { mode: 'targetSkill' | 'rotation' }>
type ThryPrepPay = PrepTheoryTarget | PrepTheoryRot

// convert a prepared payload into the packed CPU execution shape
// expected by the concrete search routines.
function mkCpuXctnPay(payload: InvPrepPay): PckdOptXctnP {
  return payload.mode === 'rotation'
      ? packRotation(payload)
      : packTargetSkill(payload)
}

function mkThryXctPay(payload: ThryPrepPay): PackedSkill | PckdRotXctnP {
  return payload.mode === 'theoryRotation'
      ? ({ ...payload, mode: 'rotation' } as PckdRotXctnP)
      : packTargetSkill(payload as unknown as Parameters<typeof packTargetSkill>[0])
}

async function runThryBtchFo(
    payload: ThryPrepPay,
    hooks: OptRunHks,
): Promise<OptBagResult[]> {
  const execution = mkThryXctPay(payload)
  const collector = new OptResultSet(payload.resultsLimit, payload.lowMmryMode)
  const progress = mkOptPrgrTrc(payload.theoryTotal, {
    onProgress: hooks.onProgress,
    onProcessed: hooks.onProcessed,
  })
  let genCmbs = 0

  for (const batch of gnrtThryCpuCm({
    payload,
    batchSize: CPU_THEORY_JOB,
  })) {
    const rmnnCmbs = payload.theoryTotal - genCmbs
    if (rmnnCmbs <= 0) {
      break
    }

    const comboCount = Math.min(batch.comboCount, rmnnCmbs)
    genCmbs += comboCount

    if (hooks.isCancelled?.()) {
      progress.emit(true)
      return collector.sorted()
    }

    const results = execution.mode === 'rotation'
        ? await runRotSrchBt(
            execution,
            {
              combosBatch: batch.combos,
              comboCount,
              lockMainIdx: batch.lockMainIdx,
              jobResultLimit: payload.resultsLimit,
            },
            {
              isCancelled: hooks.isCancelled,
              onProcessed: progress.onProcessed,
            },
          )
        : await runTgtSrchBt(
            execution,
            {
              combosBatch: batch.combos,
              comboCount,
              lockMainIdx: batch.lockMainIdx,
              jobResultLimit: payload.resultsLimit,
            },
            {
              isCancelled: hooks.isCancelled,
              onProcessed: progress.onProcessed,
            },
          )

    for (const result of results) {
      collector.push(result)
    }

    if (hooks.isCancelled?.()) {
      progress.emit(true)
      return collector.sorted()
    }

    if (genCmbs >= payload.theoryTotal) {
      break
    }
  }

  progress.emit(true)
  return collector.sorted()
}

// resolve the list of candidate main-echo indices that the optimizer should try.
// when a prepared payload is already available, reuse its precomputed indices.
// otherwise derive them from the raw inventory and locked-main settings.
export function cllcOptMainC(
    payload: OptStartPay | PrepOptPay,
): number[] {
  // prepared payloads already carry the filtered candidate list
  if ('lockMainCands' in payload) {
    return Array.from(payload.lockMainCands)
  }

  const indices: number[] = []

  for (let index = 0; index < payload.invChs.length; index += 1) {
    // if no main echo is locked, every inventory echo is eligible
    // otherwise only keep echoes whose id matches the requested locked main echo
    if (
        !payload.settings.lockedMainEchoId ||
        payload.invChs[index]?.id === payload.settings.lockedMainEchoId
    ) {
      indices.push(index)
    }
  }

  return indices
}

// run the already-compiled optimizer search for a specific set of main-candidate indices.
// this is the main handoff point into either the target-skill or rotation search engine.
export async function runCompOptSr(
    payload: PrepOptPay,
    mainIndices: ReadonlyArray<number> | Int32Array,
    hooks: OptRunHks = {},
): Promise<OptRawResult[]> {
  if (payload.mode === 'theoryTarget' || payload.mode === 'theoryRotation') {
    return runThryBtchFo(payload, hooks)
  }

  const execution = mkCpuXctnPay(payload)

  return execution.mode === 'rotation'
      ? runRotSrchFo(execution, mainIndices, hooks)
      : runTgtSrchFo(execution, mainIndices, hooks)
}

// run the compiled optimizer using the payload's own precomputed main candidates
export async function runCompiledOpt(
    payload: PrepOptPay,
    hooks: OptRunHks = {},
): Promise<OptRawResult[]> {
  return runCompOptSr(
      payload,
      payload.lockMainCands,
      hooks,
  )
}

// full high-level optimizer entrypoint:
// 1. compile the raw start payload
// 2. run the packed search
// 3. materialize the bag-style results back into user-facing result entries
export async function runOptSrch(
    payload: OptStartPay,
    hooks: OptRunHks = {},
): Promise<OptFinalResult[]> {
  const compiled = compOptPay(payload)
  const results = await runCompiledOpt(compiled, hooks)

  if (compiled.mode === 'theoryTarget' || compiled.mode === 'theoryRotation') {
    return matThryRslts(
        compiled,
        results,
        compiled.resultsLimit,
    )
  }

  const bagRslts = results.filter((result): result is OptBagResult => !('ids' in result))

  return matOptRslts(payload.invChs, bagRslts, {
    payload: compiled,
    limit: compiled.resultsLimit,
  })
}
