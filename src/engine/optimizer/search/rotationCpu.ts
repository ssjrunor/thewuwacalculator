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
import { MAIN_FIRST } from '@/engine/optimizer/config/constants.ts'
import {
  DISABLED_CONSTRAINTS,
  psssCstrs as psssCpuCstrs,
} from '@/engine/optimizer/constraints/statConstraints.ts'
import { countMainCombos } from '@/engine/optimizer/search/counting.ts'
import { mkOptPrgrTrc } from '@/engine/optimizer/search/progress.ts'
import { OptResultSet } from '@/engine/optimizer/results/collector.ts'
import {
  clrCmbSetStt,
  evalTgtCpuCmPrepped,
  mkCmbBaseStt,
} from '@/engine/optimizer/target/cpu.ts'
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

// the rotation context set used for one evaluation: the per-target contexts and
// weights plus the representative display context for constraint checks. weapon
// search swaps this view per candidate weapon; the base path uses the payload's.
interface RotCtxView {
  contexts: Float32Array
  contextStride: number
  contextCount: number
  contextWeight: Float32Array
  displayContext: Float32Array
}

// evaluate one combo exactly for rotation mode against a given context view by:
// 1. trying each valid main echo position
// 2. summing weighted damage across every rotation context
// 3. re-evaluating the best candidate through the display context for constraints
function evalRotCmbCore(
    payload: PckdRotXctnP,
    comboIds: Int32Array,
    lockedMainIndex: number,
    scratch: ReturnType<typeof makeCpuScratch>,
    view: RotCtxView,
): { damage: number; mainIndex: number } | null {
  let bestMainIndex = -1
  let bestDamage = 0

  // main echo selection:
  // MAIN_FIRST (theory) pins the main to combo slot 0; a non-negative locked
  // index uses only that echo; otherwise (inventory) every combo position is
  // tried as a potential main.
  const candMainNdcs = lockedMainIndex === MAIN_FIRST
      ? [comboIds[0]]
      : lockedMainIndex >= 0
          ? [lockedMainIndex]
          : Array.from(comboIds)

  for (const mainIndex of candMainNdcs) {
    let totalDamage = 0

    // exact rotation damage is the weighted sum across all contexts
    for (let contextIndex = 0; contextIndex < view.contextCount; contextIndex += 1) {
      const contextBase = contextIndex * view.contextStride
      const context = view.contexts.subarray(contextBase, contextBase + view.contextStride)

      // use the target cpu evaluator with disabled constraints here
      // constraints are checked later against the display context only.
      // the combo's echo-stat aggregate is built once by the caller
      // (runRotSrchBt) and reused across every context and weapon.
      const evaluated = evalTgtCpuCmPrepped({
        context,
        setConstLut: payload.setConstLut,
        mainEchoBuffs: payload.mainEchoBuffs,
        constraints: DISABLED_CONSTRAINTS,
        comboIds,
        lockMainIdx: mainIndex,
        scratch,
      })
      if (!evaluated) {
        continue
      }

      totalDamage += evaluated.damage * (view.contextWeight[contextIndex] ?? 1)
    }

    // skip invalid or non-improving candidates early
    if (totalDamage <= 0 || totalDamage <= bestDamage) {
      continue
    }

    // displayContext is used to compute the user-facing stat line and
    // constraint values for the final chosen main candidate
    const display = evalTarget({
      context: view.displayContext,
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

// base (single-weapon) rotation combo evaluation using the payload's contexts.
// caller must have already run mkCmbBaseStt for this combo (scratch holds the
// echo-stat aggregate, reused across contexts).
function evalRotCmbXc(
    payload: PckdRotXctnP,
    comboIds: Int32Array,
    lockedMainIndex: number,
    scratch: ReturnType<typeof makeCpuScratch>,
): { damage: number; mainIndex: number } | null {
  return evalRotCmbCore(payload, comboIds, lockedMainIndex, scratch, {
    contexts: payload.contexts,
    contextStride: payload.contextStride,
    contextCount: payload.contextCount,
    contextWeight: payload.contextWeight,
    displayContext: payload.displayContext,
  })
}

// weapon-search rotation combo evaluation: score the combo against every
// candidate weapon's full context set and keep the best, tagging its index.
// the per-target weights are weapon-independent, so payload.contextWeight is
// reused; only the contexts and display context change per weapon. caller must
// have already run mkCmbBaseStt for this combo. the echo aggregate is
// combo-only, so it is shared across all weapons and contexts here.
function evalRotCmbWeapons(
    payload: PckdRotXctnP,
    comboIds: Int32Array,
    lockedMainIndex: number,
    scratch: ReturnType<typeof makeCpuScratch>,
): { damage: number; mainIndex: number; weaponIndex: number } | null {
  const weaponCount = payload.weaponCount ?? 0
  const weaponContexts = payload.weaponContexts
  const weaponDisplay = payload.weaponDisplayContexts
  if (!weaponContexts || !weaponDisplay || weaponCount <= 0) {
    return null
  }

  const stride = payload.contextStride
  const count = payload.contextCount
  const perWeapon = count * stride

  let bestDamage = 0
  let bestMainIndex = -1
  let bestWeapon = -1

  for (let w = 0; w < weaponCount; w += 1) {
    const contexts = weaponContexts.subarray(w * perWeapon, (w + 1) * perWeapon)
    const displayContext = weaponDisplay.subarray(w * stride, (w + 1) * stride)

    const evaluated = evalRotCmbCore(payload, comboIds, lockedMainIndex, scratch, {
      contexts,
      contextStride: stride,
      contextCount: count,
      contextWeight: payload.contextWeight,
      displayContext,
    })

    if (evaluated && evaluated.damage > bestDamage) {
      bestDamage = evaluated.damage
      bestMainIndex = evaluated.mainIndex
      bestWeapon = w
    }
  }

  return bestWeapon >= 0
      ? { damage: bestDamage, mainIndex: bestMainIndex, weaponIndex: bestWeapon }
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

  // weapon search scores each combo against every candidate weapon's full
  // rotation context set and tags the winner; otherwise the single-weapon path.
  const weaponMode = (payload.weaponCount ?? 0) > 0 && !!payload.weaponContexts

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

    // aggregate the combo's echo stats + set counts once; the per-context and
    // per-weapon evaluations below all read this same aggregate.
    const tchdSetCnt = mkCmbBaseStt(scratch, payload.stats, payload.sets, payload.kinds, comboIds)

    if (weaponMode) {
      const evaluated = evalRotCmbWeapons(payload, comboIds, job.lockMainIdx, scratch)
      if (evaluated) {
        collector.pushRdrdCmb(evaluated.damage, comboIds, evaluated.mainIndex, evaluated.weaponIndex)
      }
    } else {
      const evaluated = evalRotCmbXc(payload, comboIds, job.lockMainIdx, scratch)
      if (evaluated) {
        collector.pushRdrdCmb(evaluated.damage, comboIds, evaluated.mainIndex)
      }
    }

    clrCmbSetStt(scratch, tchdSetCnt)
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
