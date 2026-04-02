/*
  Author: Runor Ewhro
  Description: runs the cpu target-search pipeline for optimizer batches or
               main-index subsets by evaluating valid echo combinations,
               collecting top results, and emitting optional progress updates.
*/

import type {
  OptimizerBagResultRef,
  PackedTargetSkillExecutionPayload,
  OptimizerProgress,
} from '@/engine/optimizer/types.ts'
import { ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU } from '@/engine/optimizer/config/constants.ts'
import { createCpuScratch } from '@/engine/optimizer/cpu/scratch.ts'
import { countOptimizerCombinationsForMainIndices } from '@/engine/optimizer/search/counting.ts'
import { createOptimizerProgressTracker } from '@/engine/optimizer/search/progress.ts'
import { OptimizerBagResultCollector } from '@/engine/optimizer/results/collector.ts'
import type { CombinadicIndexing } from '@/engine/optimizer/combos/combinadic.ts'
import {
  advanceCombinadicPositionsInPlace,
  fillCombinadicEchoIdsFromPositions,
  unrankCombinadicPositionsInto,
} from '@/engine/optimizer/combos/combinadic.ts'
import { evaluateTargetCpuCombo } from '@/engine/optimizer/target/cpu.ts'
import { generateTargetCpuComboBatches } from '@/engine/optimizer/target/batches.ts'

// absolute combo cost ceiling for a valid echo loadout
const OPTIMIZER_MAX_COST = 12

export interface TargetSearchJobSpec {
  // starting combinadic rank inside the active job window
  comboStart: number

  // number of combinations to scan from comboStart
  comboCount: number

  // locked main echo index, or -1 when any combo member may be the main echo
  lockedMainIndex: number

  // how many best results this job should keep locally
  jobResultsLimit: number
}

interface TargetRunHooks {
  // cancellation signal checked between batches/iterations
  isCancelled?: () => boolean

  // optional progress callback for ui reporting
  onProgress?: (progress: OptimizerProgress) => void

  // optional raw processed-row callback
  onProcessed?: (processedDelta: number) => void
}

export interface TargetSearchBatchSpec {
  // explicit pre-generated batch of 5-wide combo indices
  combosBatch: Int32Array

  // number of combos stored in combosBatch
  comboCount: number

  // locked main echo index, or -1 when not locked
  lockedMainIndex: number

  // local top-k size for this batch
  jobResultsLimit: number
}

// sum the encoded echo costs for one concrete 5-echo combo
// if any slot is invalid, force the cost above the max so the combo is rejected
function computeComboCost(costs: Uint8Array, comboIds: Int32Array): number {
  let totalCost = 0

  for (let index = 0; index < comboIds.length; index += 1) {
    const echoIndex = comboIds[index]
    if (echoIndex < 0) {
      return OPTIMIZER_MAX_COST + 1
    }
    totalCost += costs[echoIndex] | 0
  }

  return totalCost
}

// build the correct combinadic indexing view for this job
// when a later locked-main index is used, the index map must exclude that echo
function buildJobComboIndexing(
    payload: PackedTargetSkillExecutionPayload,
    lockedMainIndex: number,
): CombinadicIndexing {
  if (!payload.lockedMainRequested || lockedMainIndex < 0) {
    return {
      comboN: payload.comboN,
      comboK: payload.comboK,
      totalCombos: payload.comboTotalCombos,
      indexMap: payload.comboIndexMap,
      binom: payload.comboBinom,
      lockedIndex: -1,
    }
  }

  const firstLockedMainIndex = payload.lockedMainCandidateIndices[0] ?? -1

  // if this is the first locked candidate, the prepared index map already matches
  if (lockedMainIndex === firstLockedMainIndex) {
    return {
      comboN: payload.comboN,
      comboK: payload.comboK,
      totalCombos: payload.comboTotalCombos,
      indexMap: payload.comboIndexMap,
      binom: payload.comboBinom,
      lockedIndex: lockedMainIndex,
    }
  }

  // otherwise rebuild a view that excludes the chosen locked main echo
  const indexMap = new Int32Array(payload.costs.length - 1)
  let cursor = 0

  for (let index = 0; index < payload.costs.length; index += 1) {
    if (index === lockedMainIndex) {
      continue
    }
    indexMap[cursor] = index
    cursor += 1
  }

  return {
    comboN: payload.comboN,
    comboK: payload.comboK,
    totalCombos: payload.comboTotalCombos,
    indexMap,
    binom: payload.comboBinom,
    lockedIndex: lockedMainIndex,
  }
}

// run a contiguous combinadic search window by unranking the first combo
// then advancing positions in place for each next combo
export async function runTargetSearchJob(
    payload: PackedTargetSkillExecutionPayload,
    job: TargetSearchJobSpec,
    hooks: Pick<TargetRunHooks, 'isCancelled' | 'onProcessed'> = {},
): Promise<OptimizerBagResultRef[]> {
  const comboIndexing = buildJobComboIndexing(payload, job.lockedMainIndex)
  const remainingCombos = comboIndexing.totalCombos - job.comboStart
  const comboCount = Math.min(job.comboCount, Math.max(0, remainingCombos))

  if (comboCount <= 0) {
    return []
  }

  const collector = new OptimizerBagResultCollector(job.jobResultsLimit)
  const scratch = createCpuScratch()
  const comboPositions = scratch.comboPositions
  const comboIds = scratch.comboIds

  // seed the traversal at the first requested combinadic rank
  unrankCombinadicPositionsInto(job.comboStart, comboIndexing, comboPositions)

  for (let offset = 0; offset < comboCount; offset += 1) {
    if (hooks.isCancelled?.()) {
      return collector.sorted()
    }

    // materialize real echo ids from the current combinadic position tuple
    fillCombinadicEchoIdsFromPositions(comboIndexing, comboPositions, comboIds, comboIds.length)

    // only evaluate combos that respect the global echo cost ceiling
    const comboCost = computeComboCost(payload.costs, comboIds)
    if (comboCost <= OPTIMIZER_MAX_COST) {
      const evaluated = evaluateTargetCpuCombo({
        context: payload.context,
        stats: payload.stats,
        setConstLut: payload.setConstLut,
        mainEchoBuffs: payload.mainEchoBuffs,
        sets: payload.sets,
        kinds: payload.kinds,
        constraints: payload.constraints,
        comboIds,
        lockedMainIndex: job.lockedMainIndex,
        scratch,
      })

      if (evaluated) {
        collector.pushOrderedCombo(evaluated.damage, comboIds, evaluated.mainIndex)
      }

      hooks.onProcessed?.(payload.progressFactor)
    }

    // move to the next combinadic position unless this was the last iteration
    if (offset + 1 < comboCount) {
      const advanced = advanceCombinadicPositionsInPlace(
          comboPositions,
          comboIndexing.comboN,
          comboIndexing.comboK,
      )
      if (!advanced) {
        break
      }
    }
  }

  return collector.sorted()
}

// run a pre-expanded concrete batch of combos
// this is used by the higher-level cpu pipeline because batch generation is cheaper outside
export async function runTargetSearchBatch(
    payload: PackedTargetSkillExecutionPayload,
    job: TargetSearchBatchSpec,
    hooks: Pick<TargetRunHooks, 'isCancelled' | 'onProcessed'> = {},
): Promise<OptimizerBagResultRef[]> {
  const comboCount = job.comboCount
  if (comboCount <= 0) {
    return []
  }

  const collector = new OptimizerBagResultCollector(job.jobResultsLimit)
  const scratch = createCpuScratch()
  const comboIds = scratch.comboIds

  for (let comboIndex = 0; comboIndex < comboCount; comboIndex += 1) {
    if (hooks.isCancelled?.()) {
      return collector.sorted()
    }

    // each combo occupies 5 consecutive entries inside combosBatch
    const base = comboIndex * 5
    comboIds[0] = job.combosBatch[base]
    comboIds[1] = job.combosBatch[base + 1]
    comboIds[2] = job.combosBatch[base + 2]
    comboIds[3] = job.combosBatch[base + 3]
    comboIds[4] = job.combosBatch[base + 4]

    const evaluated = evaluateTargetCpuCombo({
      context: payload.context,
      stats: payload.stats,
      setConstLut: payload.setConstLut,
      mainEchoBuffs: payload.mainEchoBuffs,
      sets: payload.sets,
      kinds: payload.kinds,
      constraints: payload.constraints,
      comboIds,
      lockedMainIndex: job.lockedMainIndex,
      scratch,
    })

    if (evaluated) {
      collector.pushOrderedCombo(evaluated.damage, comboIds, evaluated.mainIndex)
    }
  }

  // batch mode reports work in one lump after the whole batch finishes
  hooks.onProcessed?.(comboCount * payload.progressFactor)
  return collector.sorted()
}

// top-level cpu search entry for one prepared payload across all allowed main candidates
export async function runTargetSearchForMainIndices(
    payload: PackedTargetSkillExecutionPayload,
    mainCandidateIndices: ReadonlyArray<number> | Int32Array,
    hooks: TargetRunHooks = {},
): Promise<OptimizerBagResultRef[]> {
  const lockedMainIndices = payload.lockedMainRequested
      ? mainCandidateIndices
      : [-1]

  // totalRows is used only for progress tracking and early empty-out checks
  const totalRows = countOptimizerCombinationsForMainIndices(
      payload.costs,
      payload.lockedMainRequested ? lockedMainIndices : payload.lockedMainCandidateIndices,
  )

  if (totalRows <= 0 || (payload.lockedMainRequested && lockedMainIndices.length === 0)) {
    return []
  }

  const collector = new OptimizerBagResultCollector(payload.resultsLimit)
  const progress = createOptimizerProgressTracker(totalRows, {
    onProgress: hooks.onProgress,
    onProcessed: hooks.onProcessed,
  })

  for (const lockedMainIndex of lockedMainIndices) {
    if (hooks.isCancelled?.()) {
      return collector.sorted()
    }

    // generate cpu batches of concrete 5-echo combinations
    for (const batch of generateTargetCpuComboBatches({
      costs: payload.costs,
      batchSize: ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU,
      lockedMainIndex,
    })) {
      const results = await runTargetSearchBatch(
          payload,
          {
            combosBatch: batch.combos,
            comboCount: batch.comboCount,
            lockedMainIndex,
            jobResultsLimit: payload.resultsLimit,
          },
          {
            isCancelled: hooks.isCancelled,
            onProcessed: progress.onProcessed,
          },
      )

      // merge this batch's local top-k into the global collector
      for (const result of results) {
        collector.push(result)
      }
    }
  }

  progress.emit(true)
  return collector.sorted()
}
