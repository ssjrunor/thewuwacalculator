/*
  Author: Runor Ewhro
  Description: Shared optimizer compiler helpers for stripping equipped
               echoes out of a runtime, resolving locked-main candidates,
               and building the common combinadic/counting payload used by
               both target and rotation optimizer runs.
*/

import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { OptimizerStartPayload } from '@/engine/optimizer/types'
import { buildOptimizerCombinadicIndexing } from '@/engine/optimizer/rebuild/combinadic'
import type { EncodedEchoRows } from '@/engine/optimizer/rebuild/encode/echoes'

// Return a runtime copy with all equipped echoes removed.
//
// The optimizer evaluates inventory echoes separately, so the runtime used
// to build combat context should not carry the currently equipped 5-piece set.
export function stripEchoes(runtime: ResonatorRuntimeState): ResonatorRuntimeState {
  return {
    ...runtime,
    build: {
      ...runtime.build,
      echoes: [null, null, null, null, null],
    },
  }
}

// Collect every inventory index allowed to serve as the locked main echo.
//
// Behavior:
// - If no main echo is locked, every inventory echo index is eligible.
// - If a specific main echo id is locked, only matching inventory indices remain.
export function collectLockedMainIndices(input: OptimizerStartPayload): Int32Array {
  const picked = input.settings.lockedMainEchoId

  // Unlocked main echo means all inventory entries are valid candidates.
  if (!picked) {
    return Int32Array.from(input.inventoryEchoes.map((_, index) => index))
  }

  const indices: number[] = []

  // Keep only indices whose echo id matches the requested locked main id.
  for (let index = 0; index < input.inventoryEchoes.length; index += 1) {
    if (input.inventoryEchoes[index]?.id === picked) {
      indices.push(index)
    }
  }

  return Int32Array.from(indices)
}

// Build the shared optimizer payload fields that both target-mode and
// rotation-mode compilers need.
//
// This includes:
// - encoded echo cost/set/kind arrays
// - constraint vector
// - combinadic indexing tables
// - locked-main candidate indices
// - result limits and low-memory settings
// - a progress scaling factor used by the worker pool
export function buildSharedPayload(
    encoded: Pick<EncodedEchoRows, 'costs' | 'sets' | 'kinds' | 'count'>,
    input: OptimizerStartPayload,
    constraints: Float32Array,
) {
  // Resolve which inventory indices can act as the main echo.
  const lockedMainIndices = collectLockedMainIndices(input)

  // Whether the user explicitly requested a locked main echo.
  const locked = Boolean(input.settings.lockedMainEchoId)

  // Build combinadic indexing metadata for the inventory size.
  //
  // When a main echo is locked, the combinadic builder receives one concrete
  // locked index seed so it can derive the correct combination dimensions.
  // The full candidate list is still preserved separately in lockedMainIndices.
  const comboIndexing = buildOptimizerCombinadicIndexing({
    echoCount: encoded.count,
    lockedEchoIndex: locked ? (lockedMainIndices[0] ?? null) : null,
  })

  return {
    // Top-K / result retention settings
    resultsLimit: input.settings.resultsLimit,
    lowMemoryMode: input.settings.lowMemoryMode,

    // Constraint vector produced from optimizer settings
    constraints,

    // Encoded inventory arrays reused by execution backends
    costs: encoded.costs,
    sets: encoded.sets,
    kinds: encoded.kinds,

    // Combinadic indexing metadata for mapping combo ids to actual echo indices
    comboN: comboIndexing.comboN,
    comboK: comboIndexing.comboK,
    comboTotalCombos: comboIndexing.totalCombos,
    comboIndexMap: comboIndexing.indexMap,
    comboBinom: comboIndexing.binom,

    // Locked-main metadata
    lockedMainRequested: locked,
    lockedMainCandidateIndices: lockedMainIndices,

    // Progress scaling:
    // - locked main -> each combo corresponds to one evaluation path
    // - unlocked main -> each combo is effectively explored across 5 main-row positions
    progressFactor: locked ? 1 : 5,
  }
}