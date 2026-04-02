/*
  Author: Runor Ewhro
  Description: Orchestrates optimizer compilation, packed CPU execution,
               main-candidate collection, and final result materialization.
*/

import type {
  OptimizerBagResultRef,
  OptimizerProgress,
  OptimizerResultEntry,
  OptimizerStartPayload,
  PackedOptimizerExecutionPayload,
  PreparedOptimizerPayload,
} from '@/engine/optimizer/types'
import { compileOptimizerPayload } from '@/engine/optimizer/compiler'
import { countOptimizerCombinations } from '@/engine/optimizer/search/counting'
import { materializeOptimizerResults } from '@/engine/optimizer/results/materialize.ts'
import { createPackedRotationExecution } from '@/engine/optimizer/payloads/rotationPayload'
import { createPackedTargetSkillExecution } from '@/engine/optimizer/payloads/targetPayload'
import { runRotationSearchForMainIndices } from '@/engine/optimizer/search/rotationCpu'
import { runTargetSearchForMainIndices } from '@/engine/optimizer/search/targetCpu'

// hooks used during optimizer execution for cancellation and progress reporting
interface OptimizerRunHooks {
  isCancelled?: () => boolean
  onProgress?: (progress: OptimizerProgress) => void
  onProcessed?: (processedDelta: number) => void
}

// convert a prepared payload into the packed CPU execution shape
// expected by the concrete search routines.
function buildCpuExecutionPayload(payload: PreparedOptimizerPayload): PackedOptimizerExecutionPayload {
  return payload.mode === 'rotation'
      ? createPackedRotationExecution(payload)
      : createPackedTargetSkillExecution(payload)
}

// resolve the list of candidate main-echo indices that the optimizer should try.
// when a prepared payload is already available, reuse its precomputed indices.
// otherwise derive them from the raw inventory and locked-main settings.
export function collectOptimizerMainCandidateIndices(
    payload: OptimizerStartPayload | PreparedOptimizerPayload,
): number[] {
  // prepared payloads already carry the filtered candidate list
  if ('lockedMainCandidateIndices' in payload) {
    return Array.from(payload.lockedMainCandidateIndices)
  }

  const indices: number[] = []

  for (let index = 0; index < payload.inventoryEchoes.length; index += 1) {
    // if no main echo is locked, every inventory echo is eligible
    // otherwise only keep echoes whose id matches the requested locked main echo
    if (
        !payload.settings.lockedMainEchoId ||
        payload.inventoryEchoes[index]?.id === payload.settings.lockedMainEchoId
    ) {
      indices.push(index)
    }
  }

  return indices
}

// run the already-compiled optimizer search for a specific set of main-candidate indices.
// this is the main handoff point into either the target-skill or rotation search engine.
export async function runCompiledOptimizerSearchForMainIndices(
    payload: PreparedOptimizerPayload,
    mainCandidateIndices: ReadonlyArray<number> | Int32Array,
    hooks: OptimizerRunHooks = {},
): Promise<OptimizerBagResultRef[]> {
  const execution = buildCpuExecutionPayload(payload)

  return execution.mode === 'rotation'
      ? runRotationSearchForMainIndices(execution, mainCandidateIndices, hooks)
      : runTargetSearchForMainIndices(execution, mainCandidateIndices, hooks)
}

// run the compiled optimizer using the payload's own precomputed main candidates
export async function runCompiledOptimizerSearch(
    payload: PreparedOptimizerPayload,
    hooks: OptimizerRunHooks = {},
): Promise<OptimizerBagResultRef[]> {
  return runCompiledOptimizerSearchForMainIndices(
      payload,
      payload.lockedMainCandidateIndices,
      hooks,
  )
}

// full high-level optimizer entrypoint:
// 1. compile the raw start payload
// 2. run the packed search
// 3. materialize the bag-style results back into user-facing result entries
export async function runOptimizerSearch(
    payload: OptimizerStartPayload,
    hooks: OptimizerRunHooks = {},
): Promise<OptimizerResultEntry[]> {
  const compiled = compileOptimizerPayload(payload)
  const results = await runCompiledOptimizerSearch(compiled, hooks)

  return materializeOptimizerResults(payload.inventoryEchoes, results, {
    payload: compiled,
    limit: compiled.resultsLimit,
  })
}

// re-export the compiler and combination counter so callers can use the same module
// for both setup and execution-related optimizer operations.
export { compileOptimizerPayload, countOptimizerCombinations }
