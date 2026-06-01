/*
  Author: Runor Ewhro
  Description: Generates explicit optimizer combo batches for theory mode by
               walking synthetic packed rows. The search no longer enforces
               cross-row catalog id uniqueness or scoring-equivalence dedupe;
               the count of emitted combos is therefore a pure function of
               cost feasibility + set-plan satisfaction, and is computable
               in milliseconds by cntThryEmt without running the full
               iteration.
*/

import type { SetPlanEntry } from '@/engine/suggestions/types.ts'
import { mkSetPlanCnd } from '@/engine/suggestions/mutate.ts'
import {
  MAX_ECHO_COST,
  MAIN_FIRST,
  ECHOES_PER_SET,
} from '@/engine/optimizer/config/constants.ts'
import type {
  PrepTheoryRot,
  PrepTheoryTarget,
  TheoryRow,
} from '@/engine/optimizer/types.ts'
import type { TgtCpuCmbBtc } from '@/engine/optimizer/target/batches.ts'

type ThryPay = PrepTheoryTarget | PrepTheoryRot

interface ThryBtc extends TgtCpuCmbBtc {
  lockMainIdx: number
}

interface PlanReq {
  req: Map<number, number>
  sets: number[]
  reqCounts: Uint8Array
  reqIndex: Int8Array
  reqNeed: number
}

// convert a set-plan shape into small arrays so the hot loop can track
// required pieces without using maps or sets per candidate combo.
function compPlan(plan: SetPlanEntry[]): PlanReq {
  const req = new Map<number, number>()
  for (const entry of plan) {
    req.set(entry.setId, entry.pieces)
  }
  const sets = [...req.keys()]
  const reqIndex = new Int8Array(64)
  reqIndex.fill(-1)
  for (let index = 0; index < sets.length; index += 1) {
    reqIndex[sets[index] ?? 0] = index
  }
  return {
    req,
    sets,
    reqCounts: Uint8Array.from(sets.map((setId) => req.get(setId) ?? 0)),
    reqIndex,
    reqNeed: sets.reduce((total, setId) => total + (req.get(setId) ?? 0), 0),
  }
}

// keep only set plans that can be represented by the currently compiled rows.
function buildPlans(rows: readonly TheoryRow[]): PlanReq[] {
  const sets = new Set<number>()
  for (const row of rows) {
    sets.add(row.set)
  }

  return [
    compPlan([]),
    ...mkSetPlanCnd(ECHOES_PER_SET)
        .filter((plan) => plan.every((entry) => sets.has(entry.setId)))
        .map(compPlan),
  ]
}

// add one row's set contribution, returning a token that undoSet can reverse.
// required sets count toward their target; non-required sets are kept unique
// so equivalent off-plan rows do not inflate the theory search.
function addSet(
    setId: number,
    counts: Uint8Array,
    offUsed: Uint8Array,
    plan: PlanReq,
): number {
  const reqIndex = plan.reqIndex[setId] ?? -1
  if (reqIndex >= 0) {
    if ((counts[reqIndex] ?? 0) + 1 > (plan.reqCounts[reqIndex] ?? 0)) {
      return -1
    }
    counts[reqIndex] += 1
    return reqIndex + 1
  }

  if (offUsed[setId]) {
    return -1
  }
  offUsed[setId] = 1
  return 0
}

// reverse one addSet token after returning from a nested branch.
function undoSet(
    setId: number,
    token: number,
    counts: Uint8Array,
    offUsed: Uint8Array,
): void {
  if (token > 0) {
    counts[token - 1] -= 1
    return
  }

  offUsed[setId] = 0
}

// build a key for deduping rows that are equivalent for scoring.
function planRowKey(row: TheoryRow, req: Map<number, number>): string {
  if (req.has(row.set)) {
    return `${row.set}|${row.cost}|${row.main}|${row.mainOk ? row.id : ''}`
  }

  return `off|${row.cost}|${row.main}|${row.mainOk ? row.id : ''}`
}

// group filler rows by equipped profile slot after shape dedupe.
function rowsBySlot(rows: readonly TheoryRow[], req: Map<number, number>): number[][] {
  const out = Array.from({ length: ECHOES_PER_SET }, () => [] as number[])
  const seen = Array.from({ length: ECHOES_PER_SET }, () => new Set<string>())
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row || row.mainOk) {
      continue
    }
    const key = planRowKey(row, req)
    if (seen[row.slot]?.has(key)) {
      continue
    }
    seen[row.slot]?.add(key)
    out[row.slot]?.push(index)
  }
  return out
}

// collect fixed-main candidate rows after shape dedupe.
function mainRows(rows: readonly TheoryRow[], req: Map<number, number>): number[] {
  const out: number[] = []
  const seen = new Set<string>()
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row?.mainOk) {
      const key = planRowKey(row, req)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      out.push(index)
    }
  }
  return out
}

// emit concrete optimizer batches from the compact theory row space.
// one fixed main row is paired with the four remaining profile slots.
export function* gnrtThryCpuCm(options: {
  payload: ThryPay
  batchSize: number
  borrowBuffer?: (length: number) => Int32Array
}): Generator<ThryBtc> {
  const { payload, batchSize } = options
  const rows = payload.theoryRows
  const plans = buildPlans(rows)
  const batchLength = Math.max(1, batchSize) * ECHOES_PER_SET
  const combo = new Int32Array(ECHOES_PER_SET)
  let scratch = options.borrowBuffer?.(batchLength) ?? new Int32Array(batchLength)
  let cursor = 0
  let fillers = Array.from({ length: ECHOES_PER_SET }, () => [] as number[])

  function flush(): ThryBtc | null {
    if (cursor <= 0) {
      return null
    }

    const out: ThryBtc = {
      combos: scratch,
      comboCount: cursor,
      lockMainIdx: MAIN_FIRST,
    }

    scratch = options.borrowBuffer?.(batchLength) ?? new Int32Array(batchLength)
    cursor = 0
    return out
  }

  function emit(): ThryBtc | null {
    scratch.set(combo, cursor * ECHOES_PER_SET)
    cursor += 1
    if (cursor >= batchSize) {
      return flush()
    }

    return null
  }

  const slotSeq = new Int8Array(ECHOES_PER_SET - 1)
  const setSlots = Math.max(
      64,
      rows.reduce((max, row) => Math.max(max, row.set + 1), 0),
  )

  for (const plan of plans) {
    fillers = rowsBySlot(rows, plan.req)
    const mains = mainRows(rows, plan.req)

    for (const mainIndex of mains) {
      const main = rows[mainIndex]
      if (!main) {
        continue
      }

      combo[0] = mainIndex
      const counts = new Uint8Array(plan.reqCounts.length)
      const offUsed = new Uint8Array(setSlots)
      const mainToken = addSet(main.set, counts, offUsed, plan)
      if (mainToken < 0) {
        continue
      }
      const needAfterMain = plan.reqNeed - (mainToken > 0 ? 1 : 0)
      let slotCnt = 0
      for (let slot = 0; slot < ECHOES_PER_SET; slot += 1) {
        if (slot !== main.slot) {
          slotSeq[slotCnt] = slot
          slotCnt += 1
        }
      }

      const firstRows = fillers[slotSeq[0] ?? -1] ?? []
      const secondRows = fillers[slotSeq[1] ?? -1] ?? []
      const thirdRows = fillers[slotSeq[2] ?? -1] ?? []
      const fourthRows = fillers[slotSeq[3] ?? -1] ?? []

      for (let i0 = 0; i0 < firstRows.length; i0 += 1) {
        const firstRowIndex = firstRows[i0] ?? -1
        const firstRow = rows[firstRowIndex]
        if (!firstRow) continue

        const costAfterFirst = main.cost + firstRow.cost
        if (costAfterFirst > MAX_ECHO_COST) continue

        const firstToken = addSet(firstRow.set, counts, offUsed, plan)
        if (firstToken < 0) continue

        const needAfterFirst = needAfterMain - (firstToken > 0 ? 1 : 0)
        combo[1] = firstRowIndex

        for (let i1 = 0; i1 < secondRows.length; i1 += 1) {
          const secondRowIndex = secondRows[i1] ?? -1
          const secondRow = rows[secondRowIndex]
          if (!secondRow) continue

          const costAfterSecond = costAfterFirst + secondRow.cost
          if (costAfterSecond > MAX_ECHO_COST) continue

          const secondToken = addSet(secondRow.set, counts, offUsed, plan)
          if (secondToken < 0) continue

          const needAfterSecond = needAfterFirst - (secondToken > 0 ? 1 : 0)
          combo[2] = secondRowIndex

          for (let i2 = 0; i2 < thirdRows.length; i2 += 1) {
            const thirdRowIndex = thirdRows[i2] ?? -1
            const thirdRow = rows[thirdRowIndex]
            if (!thirdRow) continue

            const costAfterThird = costAfterSecond + thirdRow.cost
            if (costAfterThird > MAX_ECHO_COST) continue

            const thirdToken = addSet(thirdRow.set, counts, offUsed, plan)
            if (thirdToken < 0) continue

            const needAfterThird = needAfterSecond - (thirdToken > 0 ? 1 : 0)
            combo[3] = thirdRowIndex

            for (let i3 = 0; i3 < fourthRows.length; i3 += 1) {
              const fourthRowIndex = fourthRows[i3] ?? -1
              const fourthRow = rows[fourthRowIndex]
              if (!fourthRow) continue

              const costAfterFourth = costAfterThird + fourthRow.cost
              if (costAfterFourth > MAX_ECHO_COST) continue

              const fourthToken = addSet(fourthRow.set, counts, offUsed, plan)
              if (fourthToken < 0) continue

              const needAfterFourth = needAfterThird - (fourthToken > 0 ? 1 : 0)
              combo[4] = fourthRowIndex

              if (needAfterFourth === 0) {
                const out = emit()
                if (out) {
                  yield out
                }
              }

              undoSet(fourthRow.set, fourthToken, counts, offUsed)
            }

            undoSet(thirdRow.set, thirdToken, counts, offUsed)
          }

          undoSet(secondRow.set, secondToken, counts, offUsed)
        }

        undoSet(firstRow.set, firstToken, counts, offUsed)
      }

      undoSet(main.set, mainToken, counts, offUsed)

    }
  }

  const leftover = flush()
  if (leftover) {
    yield leftover
  }
}

// walk the same combo space as gnrtThryCpuCm and return the exact emit count.
// no allocations per combo; just increments a counter when the set-plan is
// satisfied. completes in ms for the row catalogs the optimizer compiles.
export function cntThryEmt(rows: readonly TheoryRow[]): number {
  const plans = buildPlans(rows)
  const slotSeq = new Int8Array(ECHOES_PER_SET - 1)
  const setSlots = Math.max(
      64,
      rows.reduce((max, row) => Math.max(max, row.set + 1), 0),
  )
  let total = 0

  for (const plan of plans) {
    const fillers = rowsBySlot(rows, plan.req)
    const mains = mainRows(rows, plan.req)

    for (const mainIndex of mains) {
      const main = rows[mainIndex]
      if (!main) continue

      const counts = new Uint8Array(plan.reqCounts.length)
      const offUsed = new Uint8Array(setSlots)
      const mainToken = addSet(main.set, counts, offUsed, plan)
      if (mainToken < 0) continue
      const needAfterMain = plan.reqNeed - (mainToken > 0 ? 1 : 0)

      let slotCnt = 0
      for (let slot = 0; slot < ECHOES_PER_SET; slot += 1) {
        if (slot !== main.slot) {
          slotSeq[slotCnt] = slot
          slotCnt += 1
        }
      }

      const firstRows = fillers[slotSeq[0] ?? -1] ?? []
      const secondRows = fillers[slotSeq[1] ?? -1] ?? []
      const thirdRows = fillers[slotSeq[2] ?? -1] ?? []
      const fourthRows = fillers[slotSeq[3] ?? -1] ?? []

      for (let i0 = 0; i0 < firstRows.length; i0 += 1) {
        const firstRow = rows[firstRows[i0] ?? -1]
        if (!firstRow) continue
        const costAfterFirst = main.cost + firstRow.cost
        if (costAfterFirst > MAX_ECHO_COST) continue
        const firstToken = addSet(firstRow.set, counts, offUsed, plan)
        if (firstToken < 0) continue
        const needAfterFirst = needAfterMain - (firstToken > 0 ? 1 : 0)

        for (let i1 = 0; i1 < secondRows.length; i1 += 1) {
          const secondRow = rows[secondRows[i1] ?? -1]
          if (!secondRow) {
            continue
          }
          const costAfterSecond = costAfterFirst + secondRow.cost
          if (costAfterSecond > MAX_ECHO_COST) continue
          const secondToken = addSet(secondRow.set, counts, offUsed, plan)
          if (secondToken < 0) continue
          const needAfterSecond = needAfterFirst - (secondToken > 0 ? 1 : 0)

          for (let i2 = 0; i2 < thirdRows.length; i2 += 1) {
            const thirdRow = rows[thirdRows[i2] ?? -1]
            if (!thirdRow) continue
            const costAfterThird = costAfterSecond + thirdRow.cost
            if (costAfterThird > MAX_ECHO_COST) continue
            const thirdToken = addSet(thirdRow.set, counts, offUsed, plan)
            if (thirdToken < 0) continue
            const needAfterThird = needAfterSecond - (thirdToken > 0 ? 1 : 0)

            for (let i3 = 0; i3 < fourthRows.length; i3 += 1) {
              const fourthRow = rows[fourthRows[i3] ?? -1]
              if (!fourthRow) continue
              const costAfterFourth = costAfterThird + fourthRow.cost
              if (costAfterFourth > MAX_ECHO_COST) continue
              const fourthToken = addSet(fourthRow.set, counts, offUsed, plan)
              if (fourthToken < 0) continue
              const needAfterFourth = needAfterThird - (fourthToken > 0 ? 1 : 0)

              if (needAfterFourth === 0) {
                total += 1
              }

              undoSet(fourthRow.set, fourthToken, counts, offUsed)
            }
            undoSet(thirdRow.set, thirdToken, counts, offUsed)
          }
          undoSet(secondRow.set, secondToken, counts, offUsed)
        }
        undoSet(firstRow.set, firstToken, counts, offUsed)
      }
      undoSet(main.set, mainToken, counts, offUsed)
    }
  }

  return total
}
