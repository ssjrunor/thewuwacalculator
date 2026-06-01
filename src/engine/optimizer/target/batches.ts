/*
  Author: Runor Ewhro
  Description: generates cpu-side batches of 5-echo optimizer combinations,
               optionally enforcing a locked main echo, while pruning any
               branch whose accumulated echo cost already exceeds the max.
*/

import {
  MAX_ECHO_COST,
  ECHOES_PER_SET,
} from '@/engine/optimizer/config/constants.ts'

export interface TgtCpuCmbBtc {
  // flat packed combo indices, stored as consecutive groups of 5
  combos: Int32Array

  // number of 5-index combos currently stored in `combos`
  comboCount: number
}

export function* gnrtTgtCpuCm(options: {
  costs: Uint8Array
  batchSize: number
  lockMainIdx?: number
  borrowBuffer?: (length: number) => Int32Array
}): Generator<TgtCpuCmbBtc> {
  const { costs, batchSize } = options
  const lockedMainIndex = options.lockMainIdx ?? -1
  const n = costs.length

  // cannot form a valid optimizer combo if fewer than 5 echoes exist
  if (n < ECHOES_PER_SET) {
    return
  }

  // if the locked main alone already exceeds the cost cap, no combo can work
  if (lockedMainIndex >= 0 && ((costs[lockedMainIndex] | 0) > MAX_ECHO_COST)) {
    return
  }

  // holds the currently explored 5-combo during dfs
  const combo = new Int32Array(ECHOES_PER_SET)

  // one batch stores `batchSize` combos, each combo taking 5 slots
  const batchLength = Math.max(1, batchSize) * ECHOES_PER_SET

  // scratch buffer for the current outgoing batch
  let scratch = options.borrowBuffer?.(batchLength) ?? new Int32Array(batchLength)

  // how many full combos have been written into the current scratch buffer
  let cursor = 0

  // packages the current scratch buffer as one yielded batch and resets state
  const flush = () => {
    if (cursor <= 0) {
      return null
    }

    const out: TgtCpuCmbBtc = {
      combos: scratch,
      comboCount: cursor,
    }

    scratch = options.borrowBuffer?.(batchLength) ?? new Int32Array(batchLength)
    cursor = 0
    return out
  }

  // writes the current 5-index combo into the active scratch batch
  function* emitCombo(): Generator<TgtCpuCmbBtc> {
    scratch.set(combo, cursor * ECHOES_PER_SET)
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
  ): Generator<TgtCpuCmbBtc> {
    // reached 5 picked echoes
    if (depth === ECHOES_PER_SET) {
      // reject combos that do not include the requested locked main
      if (lockedMainIndex >= 0 && !hasLocked) {
        return
      }

      yield* emitCombo()
      return
    }

    // remaining slots including the current depth
    const rmnnSlts = ECHOES_PER_SET - depth

    // latest valid starting point that still leaves enough items to fill the combo
    const maxStart = n - rmnnSlts

    for (let index = start; index <= maxStart; index += 1) {
      const nextCost = costSum + (costs[index] | 0)

      // prune branches that already exceed the total echo cost cap
      if (nextCost > MAX_ECHO_COST) {
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
