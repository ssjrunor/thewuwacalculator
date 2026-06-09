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
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
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

// per-slot equivalence representative: every theory slot maps to a single class
// (rep = slot 0). all slots are interchangeable because a build's damage is a
// pure function of its *aggregate* stats: every contribution (a slot's locked
// substats, the chosen main stat, set bonuses) is summed, and every build fills
// all slots, so the slot-locked substat total is a constant offset shared by
// every build. permuting which slot holds which (set, cost, main, id) spec
// therefore leaves the totals, and the damage, bit-identical (verified: every
// permutation of a spec-multiset scores exactly equal). the producer pins the
// main to slot 0 and forces non-decreasing filler positions, emitting one
// canonical arrangement per distinct build instead of all 5!/dup permutations.
//
// (profs is in the signature so the rep array is sized to the live slot count;
// its substat contents do not affect equivalence.)
export function buildSlotReps(
    profs: ReadonlyArray<{ substats: Record<string, number> }>,
): Int8Array {
  return new Int8Array(profs.length)
}

// setMax==1 ("1pc") set lookup by id. these are the only sets a build can carry
// as a single off-plan piece that is *also* promotable to a plan requirement,
// so they are the sole degree of freedom in which set-plan a given build matches
// (see canonOnePc / the plan-subsumption canonicalization below).
const IS_ONE_PC: Uint8Array = (() => {
  const maxId = ECHO_SET_DEFS.reduce((max, def) => Math.max(max, def.id), 0)
  const flags = new Uint8Array(maxId + 1)
  for (const def of ECHO_SET_DEFS) {
    if (def.setMax === 1) {
      flags[def.id] = 1
    }
  }
  return flags
})()

function isOnePc(setId: number): boolean {
  return setId >= 0 && setId < IS_ONE_PC.length && IS_ONE_PC[setId] === 1
}

// occurrences of x among the five combo set ids.
function occ5(x: number, a: number, b: number, c: number, d: number, e: number): number {
  return (a === x ? 1 : 0) + (b === x ? 1 : 0) + (c === x ? 1 : 0) + (d === x ? 1 : 0) + (e === x ? 1 : 0)
}

// the canonical 1pc set for a build: the lowest-id set that is 1pc-eligible and
// appears exactly once across the five echoes (-1 if none). a build matches
// several set-plans that differ only in whether (and which) such a singleton
// 1pc set is promoted from off-plan filler to a plan requirement (e.g. {2pc A}
// vs {1pc B + 2pc A}). all those plans share the same forced requirements (any
// set appearing >=2 times must be required) and the same off-plan remainder, so
// they emit bit-identical combos. pinning the promotion to the lowest-id 1pc
// singleton selects one canonical plan per build, dropping the rest.
function canonOnePc(a: number, b: number, c: number, d: number, e: number): number {
  let best = -1
  if (isOnePc(a) && occ5(a, a, b, c, d, e) === 1) best = a
  if (isOnePc(b) && occ5(b, a, b, c, d, e) === 1 && (best < 0 || b < best)) best = b
  if (isOnePc(c) && occ5(c, a, b, c, d, e) === 1 && (best < 0 || c < best)) best = c
  if (isOnePc(d) && occ5(d, a, b, c, d, e) === 1 && (best < 0 || d < best)) best = d
  if (isOnePc(e) && occ5(e, a, b, c, d, e) === 1 && (best < 0 || e < best)) best = e
  return best
}

interface PlanReq {
  req: Map<number, number>
  sets: number[]
  reqCounts: Uint8Array
  reqIndex: Int8Array
  reqNeed: number
  // the single 1pc set this plan requires (pieces==1, setMax==1), or -1. plans
  // carry at most one such entry, so a combo is emitted under its canonical plan
  // iff this equals canonOnePc(combo).
  onePcReq: number
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
  let onePcReq = -1
  for (const setId of sets) {
    if (req.get(setId) === 1 && isOnePc(setId)) {
      onePcReq = setId
      break
    }
  }
  return {
    req,
    sets,
    reqCounts: Uint8Array.from(sets.map((setId) => req.get(setId) ?? 0)),
    reqIndex,
    reqNeed: sets.reduce((total, setId) => total + (req.get(setId) ?? 0), 0),
    onePcReq,
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
  // when set, only emit the (plan, main-row) units whose running index is
  // congruent to shard.index modulo shard.count. the union of all shards over
  // [0, count) reproduces the full single-producer combo space exactly, so the
  // top-k result set is identical regardless of how units are partitioned.
  shard?: { index: number; count: number }
  // drop bit-identical builds (permutations of specs across slots with equal
  // substats). on by default; off emits the full permutation-inclusive space,
  // which is useful for verifying the canonical set covers the same builds.
  canonicalize?: boolean
}): Generator<ThryBtc> {
  const { payload, batchSize } = options
  const shardCount = options.shard && options.shard.count > 1 ? options.shard.count : 1
  const shardIndex = options.shard ? options.shard.index : 0
  const rows = payload.theoryRows
  const canon = options.canonicalize ?? true
  const slotReps = canon && payload.profs ? buildSlotReps(payload.profs) : null
  const plans = buildPlans(rows)
  const batchLength = Math.max(1, batchSize) * ECHOES_PER_SET
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

  const slotSeq = new Int8Array(ECHOES_PER_SET - 1)
  const setSlots = Math.max(
      64,
      rows.reduce((max, row) => Math.max(max, row.set + 1), 0),
  )

  // shard partitioning by greedy load balancing. each (main-row, first-filler)
  // pair is a work unit; its size is the count of cost-feasible (i1,i2,i3) row
  // combinations given the remaining cost budget. we assign every unit to the
  // currently least-loaded shard. the load array evolves identically in every
  // producer (all see every unit and update loads the same way), so each
  // producer emits exactly the units whose least-loaded shard is its own index.
  // union over shards = the full single-producer space.
  //
  // the weight must reflect actual emitted combos. the raw inner product
  // (f1*f2*f3) does not: it is constant across all i0 of a main, so greedy with
  // equal increments degenerates to round-robin and the per-i0 cost-pruning
  // skew (the real source of imbalance) stays invisible. the cost-feasible
  // count varies with firstRow.cost, breaking that degeneracy and balancing the
  // true work.
  const shardLoads = shardCount > 1 ? new Float64Array(shardCount) : null

  // cumulative count of (i1,i2,i3) row combinations whose summed cost is <= b,
  // indexed by remaining budget b; rebuilt per main from the three filler slots
  // via histogram convolution (O(slots * maxCost^2), no inner-product walk).
  const innerFeas = shardLoads ? new Float64Array(MAX_ECHO_COST + 1) : null
  function buildInnerFeas(f1: number[], f2: number[], f3: number[]): void {
    if (!innerFeas) {
      return
    }
    let dist = new Float64Array(MAX_ECHO_COST + 1)
    dist[0] = 1
    for (const list of [f1, f2, f3]) {
      const hist = new Float64Array(MAX_ECHO_COST + 1)
      for (let i = 0; i < list.length; i += 1) {
        const r = rows[list[i] ?? -1]
        if (r && r.cost <= MAX_ECHO_COST) {
          hist[r.cost] = (hist[r.cost] ?? 0) + 1
        }
      }
      const next = new Float64Array(MAX_ECHO_COST + 1)
      for (let c = 0; c <= MAX_ECHO_COST; c += 1) {
        const base = dist[c] ?? 0
        if (base === 0) {
          continue
        }
        for (let k = 0; c + k <= MAX_ECHO_COST; k += 1) {
          const h = hist[k] ?? 0
          if (h !== 0) {
            next[c + k] = (next[c + k] ?? 0) + base * h
          }
        }
      }
      dist = next
    }
    let acc = 0
    for (let b = 0; b <= MAX_ECHO_COST; b += 1) {
      acc += dist[b] ?? 0
      innerFeas[b] = acc
    }
  }

  for (const plan of plans) {
    fillers = rowsBySlot(rows, plan.req)
    const mains = mainRows(rows, plan.req)

    for (const mainIndex of mains) {
      const main = rows[mainIndex]
      if (!main) {
        continue
      }

      // canonical main: pin the main echo to the lowest-index slot of its
      // substat-equivalence class. main rows on a non-representative slot are
      // permutation duplicates (the equivalent build with the main on the rep
      // slot is generated instead).
      if (slotReps && slotReps[main.slot] !== main.slot) {
        continue
      }

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

      // filler-slot canonicalization: filler lists are parallel across slots
      // (position i == same spec everywhere), so for filler positions whose
      // slots share a substat class we require non-decreasing positions. prevEq
      // gives the nearest earlier filler position in the same class (-1 = none),
      // and the inner loops start at that position's current index.
      const prevEq = (p: number): number => {
        if (!slotReps) return -1
        const repP = slotReps[slotSeq[p] ?? -1]
        for (let q = p - 1; q >= 0; q -= 1) {
          if (slotReps[slotSeq[q] ?? -1] === repP) return q
        }
        return -1
      }
      const prev1 = prevEq(1)
      const prev2 = prevEq(2)
      const prev3 = prevEq(3)

      // cost-feasible inner-combo counts for this main, as a function of the
      // budget left after the main + first filler.
      if (shardLoads) {
        buildInnerFeas(secondRows, thirdRows, fourthRows)
      }

      for (let i0 = 0; i0 < firstRows.length; i0 += 1) {
        const firstRowIndex = firstRows[i0] ?? -1
        const firstRow = rows[firstRowIndex]
        if (!firstRow) continue

        const costAfterFirst = main.cost + firstRow.cost

        // assign this (main, first-filler) sub-unit to the least-loaded shard,
        // weighted by how many inner combos it can actually emit (cost-feasible
        // count for the remaining budget). done before set rejection so the
        // partition is identical across producers; ties resolve to the lowest
        // shard index, deterministically.
        if (shardLoads && innerFeas) {
          const budget = MAX_ECHO_COST - costAfterFirst
          const weight = budget < 0 ? 0 : (innerFeas[budget] ?? 0)
          let best = 0
          for (let s = 1; s < shardCount; s += 1) {
            if ((shardLoads[s] ?? 0) < (shardLoads[best] ?? 0)) {
              best = s
            }
          }
          shardLoads[best] = (shardLoads[best] ?? 0) + weight
          if (best !== shardIndex) {
            continue
          }
        }

        if (costAfterFirst > MAX_ECHO_COST) continue

        const firstToken = addSet(firstRow.set, counts, offUsed, plan)
        if (firstToken < 0) continue

        const needAfterFirst = needAfterMain - (firstToken > 0 ? 1 : 0)

        const i1Start = prev1 === 0 ? i0 : 0
        for (let i1 = i1Start; i1 < secondRows.length; i1 += 1) {
          const secondRowIndex = secondRows[i1] ?? -1
          const secondRow = rows[secondRowIndex]
          if (!secondRow) continue

          const costAfterSecond = costAfterFirst + secondRow.cost
          if (costAfterSecond > MAX_ECHO_COST) continue

          const secondToken = addSet(secondRow.set, counts, offUsed, plan)
          if (secondToken < 0) continue

          const needAfterSecond = needAfterFirst - (secondToken > 0 ? 1 : 0)

          const i2Start = prev2 === 1 ? i1 : (prev2 === 0 ? i0 : 0)
          for (let i2 = i2Start; i2 < thirdRows.length; i2 += 1) {
            const thirdRowIndex = thirdRows[i2] ?? -1
            const thirdRow = rows[thirdRowIndex]
            if (!thirdRow) continue

            const costAfterThird = costAfterSecond + thirdRow.cost
            if (costAfterThird > MAX_ECHO_COST) continue

            const thirdToken = addSet(thirdRow.set, counts, offUsed, plan)
            if (thirdToken < 0) continue

            const needAfterThird = needAfterSecond - (thirdToken > 0 ? 1 : 0)

            // innermost level: addSet/undoSet would mutate then immediately
            // revert, so inline a non-mutating equivalent. a required set
            // satisfies one more piece (need-1) unless it is already at its
            // cap (conflict); an off-plan set must be unused (conflict if
            // seen). this avoids two function calls + array writes per node,
            // the hottest path in the walk.
            const budgetForFourth = MAX_ECHO_COST - costAfterThird
            const i3Start = prev3 === 2 ? i2 : (prev3 === 1 ? i1 : (prev3 === 0 ? i0 : 0))
            for (let i3 = i3Start; i3 < fourthRows.length; i3 += 1) {
              const fourthRowIndex = fourthRows[i3] ?? -1
              const fourthRow = rows[fourthRowIndex]
              if (!fourthRow) continue

              if (fourthRow.cost > budgetForFourth) continue

              const setId = fourthRow.set
              const reqIndex = plan.reqIndex[setId] ?? -1
              let needAfterFourth: number
              if (reqIndex >= 0) {
                if ((counts[reqIndex] ?? 0) + 1 > (plan.reqCounts[reqIndex] ?? 0)) {
                  continue
                }
                needAfterFourth = needAfterThird - 1
              } else {
                if (offUsed[setId]) {
                  continue
                }
                needAfterFourth = needAfterThird
              }

              if (needAfterFourth === 0) {
                // plan-subsumption canonicalization: a build matches several
                // set-plans differing only in which singleton 1pc set is
                // promoted to a requirement; emit only under the plan whose 1pc
                // requirement is the build's canonical (lowest-id) 1pc singleton.
                if (
                    canon &&
                    plan.onePcReq !== canonOnePc(
                        main.set, firstRow.set, secondRow.set, thirdRow.set, fourthRow.set,
                    )
                ) {
                  continue
                }
                const base = cursor * ECHOES_PER_SET
                scratch[base] = mainIndex
                scratch[base + 1] = firstRowIndex
                scratch[base + 2] = secondRowIndex
                scratch[base + 3] = thirdRowIndex
                scratch[base + 4] = fourthRowIndex
                cursor += 1
                if (cursor >= batchSize) {
                  const out = flush()
                  if (out) {
                    yield out
                  }
                }
              }
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
export function cntThryEmt(
    rows: readonly TheoryRow[],
    slotReps: Int8Array | null = null,
): number {
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

      // canonical main slot (see gnrtThryCpuCm)
      if (slotReps && slotReps[main.slot] !== main.slot) continue

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

      const prevEq = (p: number): number => {
        if (!slotReps) return -1
        const repP = slotReps[slotSeq[p] ?? -1]
        for (let q = p - 1; q >= 0; q -= 1) {
          if (slotReps[slotSeq[q] ?? -1] === repP) return q
        }
        return -1
      }
      const prev1 = prevEq(1)
      const prev2 = prevEq(2)
      const prev3 = prevEq(3)

      for (let i0 = 0; i0 < firstRows.length; i0 += 1) {
        const firstRow = rows[firstRows[i0] ?? -1]
        if (!firstRow) continue
        const costAfterFirst = main.cost + firstRow.cost
        if (costAfterFirst > MAX_ECHO_COST) continue
        const firstToken = addSet(firstRow.set, counts, offUsed, plan)
        if (firstToken < 0) continue
        const needAfterFirst = needAfterMain - (firstToken > 0 ? 1 : 0)

        const i1Start = prev1 === 0 ? i0 : 0
        for (let i1 = i1Start; i1 < secondRows.length; i1 += 1) {
          const secondRow = rows[secondRows[i1] ?? -1]
          if (!secondRow) {
            continue
          }
          const costAfterSecond = costAfterFirst + secondRow.cost
          if (costAfterSecond > MAX_ECHO_COST) continue
          const secondToken = addSet(secondRow.set, counts, offUsed, plan)
          if (secondToken < 0) continue
          const needAfterSecond = needAfterFirst - (secondToken > 0 ? 1 : 0)

          const i2Start = prev2 === 1 ? i1 : (prev2 === 0 ? i0 : 0)
          for (let i2 = i2Start; i2 < thirdRows.length; i2 += 1) {
            const thirdRow = rows[thirdRows[i2] ?? -1]
            if (!thirdRow) continue
            const costAfterThird = costAfterSecond + thirdRow.cost
            if (costAfterThird > MAX_ECHO_COST) continue
            const thirdToken = addSet(thirdRow.set, counts, offUsed, plan)
            if (thirdToken < 0) continue
            const needAfterThird = needAfterSecond - (thirdToken > 0 ? 1 : 0)

            const i3Start = prev3 === 2 ? i2 : (prev3 === 1 ? i1 : (prev3 === 0 ? i0 : 0))
            for (let i3 = i3Start; i3 < fourthRows.length; i3 += 1) {
              const fourthRow = rows[fourthRows[i3] ?? -1]
              if (!fourthRow) continue
              const costAfterFourth = costAfterThird + fourthRow.cost
              if (costAfterFourth > MAX_ECHO_COST) continue
              const fourthToken = addSet(fourthRow.set, counts, offUsed, plan)
              if (fourthToken < 0) continue
              const needAfterFourth = needAfterThird - (fourthToken > 0 ? 1 : 0)

              if (
                  needAfterFourth === 0 &&
                  (slotReps === null ||
                      plan.onePcReq === canonOnePc(
                          main.set, firstRow.set, secondRow.set, thirdRow.set, fourthRow.set,
                      ))
              ) {
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
