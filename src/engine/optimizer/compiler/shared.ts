/*
  Author: Runor Ewhro
  Description: Shared optimizer compiler helpers for stripping equipped
               echoes out of a runtime, resolving locked-main candidates,
               and building the common combinadic/counting payload used by
               both target and rotation optimizer runs.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { OptStartPay } from '@/engine/optimizer/types.ts'
import { mkOptCmbnNdx } from '@/engine/optimizer/combos/combinadic.ts'
import type { EncEchoRows } from '@/engine/optimizer/encode/echoes.ts'

// Return a runtime copy with all equipped echoes removed.
//
// The optimizer evaluates inventory echoes separately, so the runtime used
// to build combat context should not carry the currently equipped 5-piece set.
export function stripEchoes(runtime: ResRuntime): ResRuntime {
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
export function cllcLckdMain(input: OptStartPay): Int32Array {
  const picked = input.settings.lockedMainEchoId

  // Unlocked main echo means all inventory entries are valid candidates.
  if (!picked) {
    return Int32Array.from(input.invChs.map((_, index) => index))
  }

  const indices: number[] = []

  // Keep only indices whose echo id matches the requested locked main id.
  for (let index = 0; index < input.invChs.length; index += 1) {
    if (input.invChs[index]?.id === picked) {
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
export function mkShrdPay(
    encoded: Pick<EncEchoRows, 'costs' | 'sets' | 'kinds' | 'count'>,
    input: OptStartPay,
    constraints: Float32Array,
) {
  // Resolve which inventory indices can act as the main echo.
  const lckdMainNdcs = cllcLckdMain(input)

  // Whether the user explicitly requested a locked main echo.
  const locked = Boolean(input.settings.lockedMainEchoId)

  // Build combinadic indexing metadata for the inventory size.
  //
  // When a main echo is locked, the combinadic builder receives one concrete
  // locked index seed so it can derive the correct combination dimensions.
  // The full candidate list is still preserved separately in lockedMainIndices.
  const comboIndex = mkOptCmbnNdx({
    echoCount: encoded.count,
    lockEchoIdx: locked ? (lckdMainNdcs[0] ?? null) : null,
  })

  return {
    // Top-K / result retention settings
    resultsLimit: input.settings.resultsLimit,
    lowMmryMode: input.settings.lowMemoryMode,

    // Constraint vector produced from optimizer settings
    constraints,

    // Encoded inventory arrays reused by execution backends
    costs: encoded.costs,
    sets: encoded.sets,
    kinds: encoded.kinds,

    // Combinadic indexing metadata for mapping combo ids to actual echo indices
    comboN: comboIndex.comboN,
    comboK: comboIndex.comboK,
    totalCombos: comboIndex.totalCombos,
    comboIndexMap: comboIndex.indexMap,
    comboBinom: comboIndex.binom,

    // Locked-main metadata
    lockMainReq: locked,
    lockMainCands: lckdMainNdcs,

    // Progress scaling:
    // - locked main -> each combo corresponds to one evaluation path
    // - unlocked main -> each combo is effectively explored across 5 main-row positions
    progFact: locked ? 1 : 5,
  }
}
