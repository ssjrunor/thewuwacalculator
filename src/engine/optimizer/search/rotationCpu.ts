/*
  Author: Runor Ewhro
  Description: runs the cpu fallback path for rotation-mode optimizer search.
               it evaluates generated combo batches exactly across all rotation
               contexts, applies constraints using the display context, tracks
               progress, and returns the best bag result refs.
*/

import type {
  OptBagResult,
  OptPrgr,
  PckdRotXctnP,
} from '@/engine/optimizer/types.ts'
import { makeCpuScratch } from '@/engine/optimizer/cpu/scratch.ts'
import {
  DISABLED_CONSTRAINTS,
  psssCstrs as psssCpuCstrs,
} from '@/engine/optimizer/constraints/statConstraints.ts'
import { countMainCombos } from '@/engine/optimizer/search/counting.ts'
import { mkOptPrgrTrc } from '@/engine/optimizer/search/progress.ts'
import { OptResultSet } from '@/engine/optimizer/results/collector.ts'
import { evalTgtCpuCm } from '@/engine/optimizer/target/cpu.ts'
import { evalTarget } from '@/engine/optimizer/target/evaluate.ts'
import { gnrtTgtCpuCm } from '@/engine/optimizer/target/batches.ts'

interface RotRunHks {
  // optional cancellation signal
  isCancelled?: () => boolean

  // optional progress callback for the outer full search
  onProgress?: (progress: OptPrgr) => void

  // optional callback with processed row deltas
  onProcessed?: (prcsDlt: number) => void
}

export interface RotSrchBtchS {
  // flattened batch of combos, 5 indices per combo
  combosBatch: Int32Array

  // number of combos inside combosBatch
  comboCount: number

  // forced main echo index, or -1 when all 5 positions may be tested
  lockMainIdx: number

  // local result limit for this batch collector
  jobResultLimit: number
}

// evaluate one combo exactly for rotation mode by:
// 1. trying each valid main echo position
// 2. summing weighted damage across every rotation context
// 3. re-evaluating the best candidate through the display context for constraints
function evalRotCmbXc(
    payload: PckdRotXctnP,
    comboIds: Int32Array,
    lockedMainIndex: number,
    scratch: ReturnType<typeof makeCpuScratch>,
): { damage: number; mainIndex: number } | null {
  let bestMainIndex = -1
  let bestDamage = 0

  // if the main echo is locked, only test that one index
  // otherwise test all 5 combo positions as potential mains
  const candMainNdcs = lockedMainIndex >= 0
      ? [lockedMainIndex]
      : Array.from(comboIds)

  for (const mainIndex of candMainNdcs) {
    let totalDamage = 0

    // exact rotation damage is the weighted sum across all contexts
    for (let contextIndex = 0; contextIndex < payload.contextCount; contextIndex += 1) {
      const contextBase = contextIndex * payload.contextStride
      const context = payload.contexts.subarray(contextBase, contextBase + payload.contextStride)

      // use the target cpu evaluator with disabled constraints here
      // constraints are checked later against the display context only
      const evaluated = evalTgtCpuCm({
        context,
        stats: payload.stats,
        setConstLut: payload.setConstLut,
        mainEchoBuffs: payload.mainEchoBuffs,
        sets: payload.sets,
        kinds: payload.kinds,
        constraints: DISABLED_CONSTRAINTS,
        comboIds,
        lockMainIdx: mainIndex,
        scratch,
      })
      if (!evaluated) {
        continue
      }

      totalDamage += evaluated.damage * (payload.contextWeight[contextIndex] ?? 1)
    }

    // skip invalid or non-improving candidates early
    if (totalDamage <= 0 || totalDamage <= bestDamage) {
      continue
    }

    // displayContext is used to compute the user-facing stat line and
    // constraint values for the final chosen main candidate
    const display = evalTarget({
      context: payload.displayContext,
      stats: payload.stats,
      setConstLut: payload.setConstLut,
      mainEchoBuffs: payload.mainEchoBuffs,
      sets: payload.sets,
      kinds: payload.kinds,
      comboIds,
      mainIndex,
    })
    if (!display) {
      continue
    }

    // constraint checker expects normalized cr/cd/bonus forms here
    if (!psssCpuCstrs(
        payload.constraints,
        display.stats.atk,
        display.stats.hp,
        display.stats.def,
        display.stats.cr / 100,
        display.stats.cd / 100,
        display.stats.er,
        1 + (display.stats.bonus / 100),
        totalDamage,
    )) {
      continue
    }

    bestDamage = totalDamage
    bestMainIndex = mainIndex
  }

  return bestDamage > 0 && bestMainIndex >= 0
      ? { damage: bestDamage, mainIndex: bestMainIndex }
      : null
}

// evaluate one pre-generated batch of combos for rotation mode
export async function runRotSrchBt(
    payload: PckdRotXctnP,
    job: RotSrchBtchS,
    hooks: Pick<RotRunHks, 'isCancelled' | 'onProcessed'> = {},
): Promise<OptBagResult[]> {
  if (payload.contextCount <= 0 || job.comboCount <= 0) {
    return []
  }

  const collector = new OptResultSet(job.jobResultLimit, payload.lowMmryMode)
  const scratch = makeCpuScratch()

  // scratch.comboIds is reused per combo to avoid new allocations
  const comboIds = scratch.comboIds

  for (let comboIndex = 0; comboIndex < job.comboCount; comboIndex += 1) {
    if (hooks.isCancelled?.()) {
      return collector.sorted()
    }

    // each combo occupies 5 consecutive integers in the flattened batch
    const base = comboIndex * 5
    comboIds[0] = job.combosBatch[base]
    comboIds[1] = job.combosBatch[base + 1]
    comboIds[2] = job.combosBatch[base + 2]
    comboIds[3] = job.combosBatch[base + 3]
    comboIds[4] = job.combosBatch[base + 4]

    const evaluated = evalRotCmbXc(
        payload,
        comboIds,
        job.lockMainIdx,
        scratch,
    )

    if (evaluated) {
      collector.pushRdrdCmb(evaluated.damage, comboIds, evaluated.mainIndex)
    }
  }

  // report processed rows scaled by payload.progressFactor to stay aligned
  // with how the optimizer counts effective search work
  hooks.onProcessed?.(job.comboCount * payload.progFact)
  return collector.sorted()
}

// outer cpu rotation search loop
// iterates over locked-main candidates, generates combo batches, evaluates them,
// merges local batch results, and emits throttled progress updates
export async function runRotSrchFo(
    payload: PckdRotXctnP,
    mainIndices: ReadonlyArray<number> | Int32Array,
    hooks: RotRunHks = {},
): Promise<OptBagResult[]> {
  if (payload.contextCount <= 0) {
    return []
  }

  // when main is locked, iterate those candidate indices
  // otherwise use -1 to mean "unlocked main handling"
  const lckdMainNdcs = payload.lockMainReq
      ? mainIndices
      : [-1]

  const totalRows = countMainCombos(
      payload.costs,
      payload.lockMainReq ? lckdMainNdcs : payload.lockMainCands,
  )

  if (totalRows <= 0 || (payload.lockMainReq && lckdMainNdcs.length === 0)) {
    return []
  }

  const collector = new OptResultSet(payload.resultsLimit, payload.lowMmryMode)
  const progress = mkOptPrgrTrc(totalRows, {
    onProgress: hooks.onProgress,
    onProcessed: hooks.onProcessed,
  })

  for (const lockedMainIndex of lckdMainNdcs) {
    for (const batch of gnrtTgtCpuCm({
      costs: payload.costs,
      batchSize: 75_000,
      lockMainIdx: lockedMainIndex,
    })) {
      const results = await runRotSrchBt(
          payload,
          {
            combosBatch: batch.combos,
            comboCount: batch.comboCount,
            lockMainIdx: lockedMainIndex,
            jobResultLimit: payload.resultsLimit,
          },
          {
            isCancelled: hooks.isCancelled,
            onProcessed: progress.onProcessed,
          },
      )

      // merge batch-local top results into the global collector
      for (const result of results) {
        collector.push(result)
      }

      if (hooks.isCancelled?.()) {
        progress.emit(true)
        return collector.sorted()
      }
    }
  }

  progress.emit(true)
  return collector.sorted()
}
