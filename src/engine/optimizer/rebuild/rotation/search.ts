/*
  Author: Runor Ewhro
  Description: runs the cpu fallback path for rotation-mode optimizer search.
               it evaluates generated combo batches exactly across all rotation
               contexts, applies constraints using the display context, tracks
               progress, and returns the best bag result refs.
*/

import type {
  OptimizerBagResultRef,
  OptimizerProgress,
  PackedRotationExecutionPayload,
} from '@/engine/optimizer/types'
import { createCpuScratch } from '@/engine/optimizer/rebuild/cpu/scratch'
import { passesConstraints as passesCpuConstraints } from '@/engine/optimizer/rebuild/cpu/constraints'
import { countOptimizerCombinationsForMainIndices } from '@/engine/optimizer/rebuild/count'
import { OptimizerBagResultCollector } from '@/engine/optimizer/rebuild/results'
import { evaluateTargetCpuCombo } from '@/engine/optimizer/rebuild/target/cpu'
import { evalTarget } from '@/engine/optimizer/rebuild/target/evaluate'
import { generateTargetCpuComboBatches } from '@/engine/optimizer/rebuild/target/batches'

// throttle progress callbacks so cpu search does not spend too much time
// emitting ui updates
const PROGRESS_UPDATE_INTERVAL_MS = 80

// constraint array where every min > max, which the constraint checker
// interprets as "disabled" for all tracked stats
const DISABLED_CONSTRAINTS = new Float32Array([
  1, 0,
  1, 0,
  1, 0,
  1, 0,
  1, 0,
  1, 0,
  1, 0,
  1, 0,
])

interface RotationRunHooks {
  // optional cancellation signal
  isCancelled?: () => boolean

  // optional progress callback for the outer full search
  onProgress?: (progress: OptimizerProgress) => void

  // optional callback with processed row deltas
  onProcessed?: (processedDelta: number) => void
}

export interface RotationSearchBatchSpec {
  // flattened batch of combos, 5 indices per combo
  combosBatch: Int32Array

  // number of combos inside combosBatch
  comboCount: number

  // forced main echo index, or -1 when all 5 positions may be tested
  lockedMainIndex: number

  // local result limit for this batch collector
  jobResultsLimit: number
}

// build a standard optimizer progress object from current timing/state
function buildProgress(total: number, processed: number, startedAt: number): OptimizerProgress {
  const now = performance.now()
  const elapsedMs = now - startedAt
  const progress = total > 0 ? processed / total : 0
  const speed = elapsedMs > 0 ? (processed / elapsedMs) * 1000 : 0
  const remainingMs =
      speed > 0 && processed < total
          ? ((total - processed) / speed) * 1000
          : (processed >= total ? 0 : Infinity)

  return {
    progress,
    elapsedMs,
    remainingMs,
    processed,
    speed,
  }
}

// evaluate one combo exactly for rotation mode by:
// 1. trying each valid main echo position
// 2. summing weighted damage across every rotation context
// 3. re-evaluating the best candidate through the display context for constraints
function evaluateRotationComboExact(
    payload: PackedRotationExecutionPayload,
    comboIds: Int32Array,
    lockedMainIndex: number,
    scratch: ReturnType<typeof createCpuScratch>,
): { damage: number; mainIndex: number } | null {
  let bestMainIndex = -1
  let bestDamage = 0

  // if the main echo is locked, only test that one index
  // otherwise test all 5 combo positions as potential mains
  const candidateMainIndices = lockedMainIndex >= 0
      ? [lockedMainIndex]
      : Array.from(comboIds)

  for (const mainIndex of candidateMainIndices) {
    let totalDamage = 0

    // exact rotation damage is the weighted sum across all contexts
    for (let contextIndex = 0; contextIndex < payload.contextCount; contextIndex += 1) {
      const contextBase = contextIndex * payload.contextStride
      const context = payload.contexts.subarray(contextBase, contextBase + payload.contextStride)

      // use the target cpu evaluator with disabled constraints here
      // constraints are checked later against the display context only
      const evaluated = evaluateTargetCpuCombo({
        context,
        stats: payload.stats,
        setConstLut: payload.setConstLut,
        mainEchoBuffs: payload.mainEchoBuffs,
        sets: payload.sets,
        kinds: payload.kinds,
        constraints: DISABLED_CONSTRAINTS,
        comboIds,
        lockedMainIndex: mainIndex,
        scratch,
      })
      if (!evaluated) {
        continue
      }

      totalDamage += evaluated.damage * (payload.contextWeights[contextIndex] ?? 1)
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
    if (!passesCpuConstraints(
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
export async function runRotationSearchBatch(
    payload: PackedRotationExecutionPayload,
    job: RotationSearchBatchSpec,
    hooks: Pick<RotationRunHooks, 'isCancelled' | 'onProcessed'> = {},
): Promise<OptimizerBagResultRef[]> {
  if (payload.contextCount <= 0 || job.comboCount <= 0) {
    return []
  }

  const collector = new OptimizerBagResultCollector(job.jobResultsLimit)
  const scratch = createCpuScratch()

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

    const evaluated = evaluateRotationComboExact(
        payload,
        comboIds,
        job.lockedMainIndex,
        scratch,
    )

    if (evaluated) {
      collector.pushOrderedCombo(evaluated.damage, comboIds, evaluated.mainIndex)
    }
  }

  // report processed rows scaled by payload.progressFactor to stay aligned
  // with how the optimizer counts effective search work
  hooks.onProcessed?.(job.comboCount * payload.progressFactor)
  return collector.sorted()
}

// outer cpu rotation search loop
// iterates over locked-main candidates, generates combo batches, evaluates them,
// merges local batch results, and emits throttled progress updates
export async function runRotationSearchForMainIndices(
    payload: PackedRotationExecutionPayload,
    mainCandidateIndices: ReadonlyArray<number> | Int32Array,
    hooks: RotationRunHooks = {},
): Promise<OptimizerBagResultRef[]> {
  if (payload.contextCount <= 0) {
    return []
  }

  // when main is locked, iterate those candidate indices
  // otherwise use -1 to mean "unlocked main handling"
  const lockedMainIndices = payload.lockedMainRequested
      ? mainCandidateIndices
      : [-1]

  const totalRows = countOptimizerCombinationsForMainIndices(
      payload.costs,
      payload.lockedMainRequested ? lockedMainIndices : payload.lockedMainCandidateIndices,
  )

  if (totalRows <= 0 || (payload.lockedMainRequested && lockedMainIndices.length === 0)) {
    return []
  }

  const collector = new OptimizerBagResultCollector(payload.resultsLimit)
  const startedAt = performance.now()
  let processed = 0
  let lastProgressAt = startedAt

  // emit throttled progress updates unless force=true
  const emitProgress = (force = false) => {
    if (!hooks.onProgress) {
      return
    }

    const now = performance.now()
    if (!force && now - lastProgressAt < PROGRESS_UPDATE_INTERVAL_MS) {
      return
    }

    lastProgressAt = now
    hooks.onProgress(buildProgress(totalRows, processed, startedAt))
  }

  // central processed-row handler shared by inner batch runs
  const onProcessed = (processedDelta: number) => {
    processed += processedDelta
    hooks.onProcessed?.(processedDelta)
    emitProgress()
  }

  for (const lockedMainIndex of lockedMainIndices) {
    for (const batch of generateTargetCpuComboBatches({
      costs: payload.costs,
      batchSize: 75_000,
      lockedMainIndex,
    })) {
      const results = await runRotationSearchBatch(
          payload,
          {
            combosBatch: batch.combos,
            comboCount: batch.comboCount,
            lockedMainIndex,
            jobResultsLimit: payload.resultsLimit,
          },
          {
            isCancelled: hooks.isCancelled,
            onProcessed,
          },
      )

      // merge batch-local top results into the global collector
      for (const result of results) {
        collector.push(result)
      }

      if (hooks.isCancelled?.()) {
        emitProgress(true)
        return collector.sorted()
      }
    }
  }

  emitProgress(true)
  return collector.sorted()
}