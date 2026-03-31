/*
  Author: Runor Ewhro
  Description: generates cpu-side batches of 5-echo optimizer combinations,
               optionally enforcing a locked main echo, while pruning any
               branch whose accumulated echo cost already exceeds the max.
*/

import {
  ECHO_OPTIMIZER_MAX_COST,
  OPTIMIZER_ECHOS_PER_COMBO,
} from '@/engine/optimizer/constants'

export interface TargetCpuComboBatch {
  // flat packed combo indices, stored as consecutive groups of 5
  combos: Int32Array

  // number of 5-index combos currently stored in `combos`
  comboCount: number
}

export function* generateTargetCpuComboBatches(options: {
  costs: Uint8Array
  batchSize: number
  lockedMainIndex?: number
  borrowBuffer?: (length: number) => Int32Array
}): Generator<TargetCpuComboBatch> {
  const { costs, batchSize } = options
  const lockedMainIndex = options.lockedMainIndex ?? -1
  const n = costs.length

  // cannot form a valid optimizer combo if fewer than 5 echoes exist
  if (n < OPTIMIZER_ECHOS_PER_COMBO) {
    return
  }

  // if the locked main alone already exceeds the cost cap, no combo can work
  if (lockedMainIndex >= 0 && ((costs[lockedMainIndex] | 0) > ECHO_OPTIMIZER_MAX_COST)) {
    return
  }

  // holds the currently explored 5-combo during dfs
  const combo = new Int32Array(OPTIMIZER_ECHOS_PER_COMBO)

  // one batch stores `batchSize` combos, each combo taking 5 slots
  const batchLength = Math.max(1, batchSize) * OPTIMIZER_ECHOS_PER_COMBO

  // scratch buffer for the current outgoing batch
  let scratch = options.borrowBuffer?.(batchLength) ?? new Int32Array(batchLength)

  // how many full combos have been written into the current scratch buffer
  let cursor = 0

  // packages the current scratch buffer as one yielded batch and resets state
  const flush = () => {
    if (cursor <= 0) {
      return null
    }

    const out: TargetCpuComboBatch = {
      combos: scratch,
      comboCount: cursor,
    }

    scratch = options.borrowBuffer?.(batchLength) ?? new Int32Array(batchLength)
    cursor = 0
    return out
  }

  // writes the current 5-index combo into the active scratch batch
  function* emitCombo(): Generator<TargetCpuComboBatch> {
    scratch.set(combo, cursor * OPTIMIZER_ECHOS_PER_COMBO)
    cursor += 1

    // once the batch is full, yield it immediately
    if (cursor >= batchSize) {
      const out = flush()
      if (out) {
        yield out
      }
    }
  }

  // depth-first enumeration of strictly increasing 5-index combinations
  function* dfs(
      depth: number,
      start: number,
      costSum: number,
      hasLocked: boolean,
  ): Generator<TargetCpuComboBatch> {
    // reached 5 picked echoes
    if (depth === OPTIMIZER_ECHOS_PER_COMBO) {
      // reject combos that do not include the requested locked main
      if (lockedMainIndex >= 0 && !hasLocked) {
        return
      }

      yield* emitCombo()
      return
    }

    // remaining slots including the current depth
    const remainingSlots = OPTIMIZER_ECHOS_PER_COMBO - depth

    // latest valid starting point that still leaves enough items to fill the combo
    const maxStart = n - remainingSlots

    for (let index = start; index <= maxStart; index += 1) {
      const nextCost = costSum + (costs[index] | 0)

      // prune branches that already exceed the total echo cost cap
      if (nextCost > ECHO_OPTIMIZER_MAX_COST) {
        continue
      }

      combo[depth] = index

      yield* dfs(
          depth + 1,
          index + 1,
          nextCost,
          hasLocked || index === lockedMainIndex,
      )
    }
  }

  // begin recursive generation from an empty combo
  yield* dfs(0, 0, 0, false)

  // emit any partially filled final batch
  const leftover = flush()
  if (leftover) {
    yield leftover
  }
}