/*
  Author: Runor Ewhro
  Description: runs the cpu target-search pipeline for optimizer batches or
               main-index subsets by evaluating valid echo combinations,
               collecting top results, and emitting optional progress updates.
*/

import type {
  OptBagResult,
  PackedSkill,
  OptPrgr,
} from '@/engine/optimizer/types.ts'
import { CPU_JOB_SIZE } from '@/engine/optimizer/config/constants.ts'
import { MAIN_FIRST } from '@/engine/optimizer/config/constants.ts'
import { makeCpuScratch } from '@/engine/optimizer/cpu/scratch.ts'
import { countMainCombos } from '@/engine/optimizer/search/counting.ts'
import { mkOptPrgrTrc } from '@/engine/optimizer/search/progress.ts'
import { OptResultSet } from '@/engine/optimizer/results/collector.ts'
import { mkJobCmbNdxn } from '@/engine/optimizer/combos/jobIndex.ts'
import {
  dvncCmbnPstn,
  fillCmbnEcho,
  nrnkCmbnPstn,
} from '@/engine/optimizer/combos/combinadic.ts'
import { evalTgtCpuCm, composeWeaponContexts, evalTgtCpuCmWeapons } from '@/engine/optimizer/target/cpu.ts'
import { gnrtTgtCpuCm } from '@/engine/optimizer/target/batches.ts'

// absolute combo cost ceiling for a valid echo loadout
const OPT_MAX_COST = 12

export interface TgtSrchJobSp {
  // starting combinadic rank inside the active job window
  comboStart: number

  // number of combinations to scan from comboStart
  comboCount: number

  // locked main echo index, or -1 when any combo member may be the main echo
  lockMainIdx: number

  // how many best results this job should keep locally
  jobResultLimit: number
}

interface TgtRunHks {
  // cancellation signal checked between batches/iterations
  isCancelled?: () => boolean

  // optional progress callback for ui reporting
  onProgress?: (progress: OptPrgr) => void

  // optional raw processed-row callback
  onProcessed?: (prcsDlt: number) => void
}

export interface TgtSrchBtchS {
  // explicit pre-generated batch of 5-wide combo indices
  combosBatch: Int32Array

  // number of combos stored in combosBatch
  comboCount: number

  // locked main echo index, or -1 when not locked
  lockMainIdx: number

  // local top-k size for this batch
  jobResultLimit: number
}

// sum the encoded echo costs for one concrete 5-echo combo
// if any slot is invalid, force the cost above the max so the combo is rejected
function cmptCmbCost(costs: Uint8Array, comboIds: Int32Array): number {
  let totalCost = 0

  for (let index = 0; index < comboIds.length; index += 1) {
    const echoIndex = comboIds[index]
    if (echoIndex < 0) {
      return OPT_MAX_COST + 1
    }
    totalCost += costs[echoIndex] | 0
  }

  return totalCost
}


// run a contiguous combinadic search window by unranking the first combo
// then advancing positions in place for each next combo
export async function runTgtSrchJo(
    payload: PackedSkill,
    job: TgtSrchJobSp,
    hooks: Pick<TgtRunHks, 'isCancelled' | 'onProcessed'> = {},
): Promise<OptBagResult[]> {
  const comboIndex = mkJobCmbNdxn(payload, job.lockMainIdx)
  const rmnnCmbs = comboIndex.totalCombos - job.comboStart
  const comboCount = Math.min(job.comboCount, Math.max(0, rmnnCmbs))

  if (comboCount <= 0) {
    return []
  }

  const collector = new OptResultSet(job.jobResultLimit, payload.lowMmryMode)
  const scratch = makeCpuScratch()
  const cmbPstn = scratch.cmbPstn
  const comboIds = scratch.comboIds

  // seed the traversal at the first requested combinadic rank
  nrnkCmbnPstn(job.comboStart, comboIndex, cmbPstn)

  for (let offset = 0; offset < comboCount; offset += 1) {
    if (hooks.isCancelled?.()) {
      return collector.sorted()
    }

    // materialize real echo ids from the current combinadic position tuple
    fillCmbnEcho(comboIndex, cmbPstn, comboIds, comboIds.length)

    // only evaluate combos that respect the global echo cost ceiling
    const comboCost = cmptCmbCost(payload.costs, comboIds)
    if (comboCost <= OPT_MAX_COST) {
      const evaluated = evalTgtCpuCm({
        context: payload.context,
        stats: payload.stats,
        setConstLut: payload.setConstLut,
        mainEchoBuffs: payload.mainEchoBuffs,
        sets: payload.sets,
        kinds: payload.kinds,
        constraints: payload.constraints,
        comboIds,
        lockMainIdx: job.lockMainIdx,
        scratch,
      })

      if (evaluated) {
        collector.pushRdrdCmb(evaluated.damage, comboIds, evaluated.mainIndex)
      }

      hooks.onProcessed?.(payload.progFact)
    }

    // move to the next combinadic position unless this was the last iteration
    if (offset + 1 < comboCount) {
      const advanced = dvncCmbnPstn(
          cmbPstn,
          comboIndex.comboN,
          comboIndex.comboK,
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
export async function runTgtSrchBt(
    payload: PackedSkill,
    job: TgtSrchBtchS,
    hooks: Pick<TgtRunHks, 'isCancelled' | 'onProcessed'> = {},
): Promise<OptBagResult[]> {
  const comboCount = job.comboCount
  if (comboCount <= 0) {
    return []
  }

  const collector = new OptResultSet(job.jobResultLimit, payload.lowMmryMode)
  const scratch = makeCpuScratch()
  const comboIds = scratch.comboIds
  const mainFirst = job.lockMainIdx === MAIN_FIRST

  // weapon search: precompose the per-weapon contexts once (base ⊕ overlay), then
  // each combo is scored against all of them and tagged with the best weapon.
  const weaponCount = payload.weaponCount ?? 0
  const weaponContexts = payload.weaponOverlays && weaponCount > 0
      ? composeWeaponContexts(payload.context, payload.weaponOverlays, weaponCount)
      : null

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

    if (weaponContexts) {
      const evaluated = evalTgtCpuCmWeapons({
        weaponContexts,
        stats: payload.stats,
        setConstLut: payload.setConstLut,
        mainEchoBuffs: payload.mainEchoBuffs,
        sets: payload.sets,
        kinds: payload.kinds,
        constraints: payload.constraints,
        comboIds,
        lockMainIdx: job.lockMainIdx,
        scratch,
      })

      if (evaluated) {
        if (mainFirst) {
          collector.pushMainFrst(evaluated.damage, comboIds, evaluated.weaponIndex)
        } else {
          collector.pushRdrdCmb(evaluated.damage, comboIds, evaluated.mainIndex, evaluated.weaponIndex)
        }
      }
      continue
    }

    const evaluated = evalTgtCpuCm({
      context: payload.context,
      stats: payload.stats,
      setConstLut: payload.setConstLut,
      mainEchoBuffs: payload.mainEchoBuffs,
      sets: payload.sets,
      kinds: payload.kinds,
      constraints: payload.constraints,
      comboIds,
      lockMainIdx: job.lockMainIdx,
      scratch,
    })

    if (evaluated) {
      if (mainFirst) {
        collector.pushMainFrst(evaluated.damage, comboIds)
      } else {
        collector.pushRdrdCmb(evaluated.damage, comboIds, evaluated.mainIndex)
      }
    }
  }

  // batch mode reports work in one lump after the whole batch finishes
  hooks.onProcessed?.(comboCount * payload.progFact)
  return collector.sorted()
}

// top-level cpu search entry for one prepared payload across all allowed main candidates
export async function runTgtSrchFo(
    payload: PackedSkill,
    mainIndices: ReadonlyArray<number> | Int32Array,
    hooks: TgtRunHks = {},
): Promise<OptBagResult[]> {
  const lckdMainNdcs = payload.lockMainReq
      ? mainIndices
      : [-1]

  // totalRows is used only for progress tracking and early empty-out checks
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
    if (hooks.isCancelled?.()) {
      return collector.sorted()
    }

    // generate cpu batches of concrete 5-echo combinations
    for (const batch of gnrtTgtCpuCm({
      costs: payload.costs,
      batchSize: CPU_JOB_SIZE,
      lockMainIdx: lockedMainIndex,
    })) {
      const results = await runTgtSrchBt(
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

      // merge this batch's local top-k into the global collector
      for (const result of results) {
        collector.push(result)
      }
    }
  }

  progress.emit(true)
  return collector.sorted()
}
