/*
  Author: Runor Ewhro
  Description: materializes raw optimizer rows back into user-facing result
               entries and optional recomputed stat snapshots for display.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import type {
  OptFinalResult,
  OptBagResult,
  OptRawResult,
  OptResultEntry,
  OptResultStats,
  PckdRotXctnP,
  PackedSkill,
  PrepRotRun,
  PrepTargetSkill,
  PrepTheoryRot,
  PrepTheoryTarget,
  PrepOptPay,
  TheoryResult,
  TheoryResultRow,
} from '@/engine/optimizer/types.ts'
import { evalTarget } from '@/engine/optimizer/target/evaluate.ts'
import { fillOptBagRs } from '@/engine/optimizer/results/collector.ts'
import { packRotation } from '@/engine/optimizer/payloads/rotationPayload.ts'
import { packTargetSkill } from '@/engine/optimizer/payloads/targetPayload.ts'

type ThryPay = PrepTheoryTarget | PrepTheoryRot
type ThryXct = PackedSkill | PckdRotXctnP

const thryXctCch = new WeakMap<ThryPay, ThryXct>()

function mkSqntCmbIds(count: number): Int32Array {
  const comboIds = new Int32Array(count)
  for (let index = 0; index < count; index += 1) {
    comboIds[index] = index
  }
  return comboIds
}

function mkThryTgtXct(payload: PrepTheoryTarget): PackedSkill {
  return {
    ...packTargetSkill(payload as unknown as PrepTargetSkill),
    stats: payload.stats,
    setConstLut: payload.setConstLut,
    mainEchoBuffs: payload.mainEchoBuffs,
    costs: payload.costs,
    sets: payload.sets,
    kinds: payload.kinds,
    lockMainReq: true,
    lockMainCands: payload.lockMainCands,
  }
}

function mkThryRotXct(payload: PrepTheoryRot): PckdRotXctnP {
  return {
    ...payload,
    mode: 'rotation',
  }
}

// theory result rows are often resolved lazily from the ui, so keep the packed
// execution wrapper cached by payload instead of rebuilding it per visible row.
function getThryXct(payload: ThryPay): ThryXct {
  const cached = thryXctCch.get(payload)
  if (cached) {
    return cached
  }

  const execution = payload.mode === 'theoryRotation'
      ? mkThryRotXct(payload)
      : mkThryTgtXct(payload)
  thryXctCch.set(payload, execution)
  return execution
}

// recompute the detailed stat summary for one target-mode result row
function evalOptBagRs(
  execution: PackedSkill,
  result: OptBagResult,
): OptResultStats | null {
  const comboIds = fillOptBagRs(new Int32Array(5), result)
  const mainIndex = comboIds[0] ?? -1
  if (mainIndex < 0) {
    return null
  }

  return evalTarget({
    context: execution.context,
    stats: execution.stats,
    setConstLut: execution.setConstLut,
    mainEchoBuffs: execution.mainEchoBuffs,
    sets: execution.sets,
    kinds: execution.kinds,
    constraints: execution.constraints,
    comboIds,
    mainIndex,
  })?.stats ?? null
}

// recompute the display-context stat summary for one rotation-mode result row
function evalRotRsltS(
  execution: PckdRotXctnP,
  result: OptBagResult,
): OptResultStats | null {
  const comboIds = fillOptBagRs(new Int32Array(5), result)
  const mainIndex = comboIds[0] ?? -1
  if (mainIndex < 0) {
    return null
  }

  return evalTarget({
    context: execution.displayContext,
    stats: execution.stats,
    setConstLut: execution.setConstLut,
    mainEchoBuffs: execution.mainEchoBuffs,
    sets: execution.sets,
    kinds: execution.kinds,
    constraints: execution.constraints,
    comboIds,
    mainIndex,
  })?.stats ?? null
}

// resolve the concrete echo instances referenced by one optimizer result row
export function resOptRsltCh(
  bagEchoes: readonly EchoInstance[],
  result: OptBagResult,
): Array<EchoInstance | null> {
  return [
    bagEchoes[result.i0] ?? null,
    bagEchoes[result.i1] ?? null,
    bagEchoes[result.i2] ?? null,
    bagEchoes[result.i3] ?? null,
    bagEchoes[result.i4] ?? null,
  ]
}

export function evalOptBagcz(
  payload: PrepOptPay,
  result: OptBagResult,
): OptResultStats | null {
  if (payload.mode === 'theoryTarget' || payload.mode === 'theoryRotation') {
    return null
  }

  return payload.mode === 'rotation'
    ? evalRotRsltS(
        packRotation(payload),
        result,
      )
    : evalOptBagRs(
        packTargetSkill(payload),
        result,
      )
}

// materialize the final optimizer result list and cap it to the requested limit
export function matOptRslts(
  bagEchoes: readonly EchoInstance[],
  results: readonly OptBagResult[],
  options: {
    payload?: PrepTargetSkill | PrepRotRun | null
    limit?: number
  } = {},
): OptResultEntry[] {
  const finalized: OptResultEntry[] = []
  const maxItems = Math.max(1, Math.floor((options.limit ?? results.length) || 1))
  const execution = options.payload
    ? (options.payload.mode === 'rotation'
      ? packRotation(options.payload)
      : packTargetSkill(options.payload))
    : null

  for (const result of results) {
    const echoes = resOptRsltCh(bagEchoes, result)
    if (echoes.some((echo) => !echo?.uid)) {
      continue
    }

    finalized.push({
      damage: result.damage,
      uids: echoes.map((echo) => echo?.uid ?? ''),
      stats: execution
        ? (execution.mode === 'rotation'
          ? evalRotRsltS(execution, result)
          : evalOptBagRs(execution, result))
        : null,
    })

    if (finalized.length >= maxItems) {
      break
    }
  }

  return finalized
}

export function matOptRsltsF(
  uidByIndex: readonly string[],
  results: readonly OptRawResult[],
  options: {
    payload?: PrepOptPay | null
    limit?: number
  } = {},
): OptFinalResult[] {
  if (
    options.payload?.mode === 'theoryTarget' ||
    options.payload?.mode === 'theoryRotation'
  ) {
    return matThryRslts(
        options.payload,
        results,
        options.limit,
    )
  }

  const finalized: OptResultEntry[] = []
  const maxItems = Math.max(1, Math.floor((options.limit ?? results.length) || 1))
  const execution = options.payload
    ? (options.payload.mode === 'rotation'
      ? packRotation(options.payload)
      : packTargetSkill(options.payload))
    : null

  for (const result of results) {
    if ('ids' in result) {
      continue
    }

    const uids = [
      uidByIndex[result.i0] ?? '',
      uidByIndex[result.i1] ?? '',
      uidByIndex[result.i2] ?? '',
      uidByIndex[result.i3] ?? '',
      uidByIndex[result.i4] ?? '',
    ]

    if (uids.some((uid) => !uid)) {
      continue
    }

    finalized.push({
      damage: result.damage,
      uids,
      stats: execution
        ? (execution.mode === 'rotation'
          ? evalRotRsltS(execution, result)
          : evalOptBagRs(execution, result))
        : null,
    })

    if (finalized.length >= maxItems) {
      break
    }
  }

  return finalized
}

// materialize one compact theory row into generated echo instances
// catalog id, chosen set, and primary main stat are row data; substats stay slot-locked.
export function matThryEcho(
    payload: ThryPay,
    result: TheoryResultRow,
): EchoInstance[] | null {
  const size = payload.profs.length
  if (
      result.ids.length !== size ||
      result.sets.length !== size ||
      result.mains.length !== size ||
      result.main < 0 ||
      result.main >= size
  ) {
    return null
  }

  if (new Set(result.ids).size !== result.ids.length) {
    return null
  }

  const catById = new Map(payload.cats.map((cat) => [cat.id, cat] as const))
  const echoes: EchoInstance[] = []

  for (let index = 0; index < size; index += 1) {
    const id = result.ids[index]
    const cat = catById.get(id)
    const setId = result.sets[index]
    const mainKey = result.mains[index]
    const prof = payload.profs[index]
    if (!id || !cat || !prof || setId == null || !mainKey || !cat.sets.includes(setId)) {
      return null
    }

    const primaryValue = ECHO_MAIN_STATS[cat.cost]?.[mainKey]
    const secondary = ECHO_SIDE_STATS[cat.cost]
    if (primaryValue == null || !secondary) {
      return null
    }

    echoes.push({
      uid: `theory:${prof.uid}:${id}:${setId}:${mainKey}:${index}`,
      id,
      set: setId,
      mainEcho: index === result.main,
      mainStats: {
        primary: {
          key: mainKey,
          value: primaryValue,
        },
        secondary: {
          key: secondary.key,
          value: secondary.value,
        },
      },
      substats: { ...prof.substats },
    })
  }

  return echoes
}

function matThryBagEcho(
    payload: ThryPay,
    result: OptBagResult,
): EchoInstance[] | null {
  const rowIds = fillOptBagRs(new Int32Array(5), result)
  const out: EchoInstance[] = new Array(payload.profs.length)
  const used = new Set<string>()
  const mainSlot = payload.theoryRows[result.i0]?.slot ?? -1

  for (let index = 0; index < rowIds.length; index += 1) {
    const row = payload.theoryRows[rowIds[index] ?? -1]
    if (!row) {
      return null
    }

    let id = row.id
    if (!id) {
      for (const candId of row.ids) {
        if (!used.has(candId)) {
          id = candId
          break
        }
      }
    }

    const prof = payload.profs[row.slot]
    const primaryValue = ECHO_MAIN_STATS[row.cost]?.[row.main]
    const secondary = ECHO_SIDE_STATS[row.cost]
    if (!id || !prof || primaryValue == null || !secondary || used.has(id)) {
      return null
    }

    used.add(id)
    out[row.slot] = {
      uid: `theory:${prof.uid}:${id}:${row.set}:${row.main}:${row.slot}`,
      id,
      set: row.set,
      mainEcho: row.slot === mainSlot,
      mainStats: {
        primary: {
          key: row.main,
          value: primaryValue,
        },
        secondary: {
          key: secondary.key,
          value: secondary.value,
        },
      },
      substats: { ...prof.substats },
    }
  }

  return out.every(Boolean) ? out : null
}

// resolve one theory result only when a caller actually needs the full loadout.
export function matThryRsltCh(
    payload: ThryPay,
    result: OptRawResult,
): EchoInstance[] | null {
  return 'ids' in result
      ? matThryEcho(payload, result)
      : matThryBagEcho(payload, result)
}

// compute the stat line for one raw theory result without expanding echoes.
export function evalThryRsltS(
    payload: ThryPay,
    result: OptRawResult,
): OptResultStats | null {
  if ('ids' in result) {
    return result.stats
  }

  const execution = getThryXct(payload)
  return execution.mode === 'rotation'
      ? evalRotRsltS(execution, result)
      : evalOptBagRs(execution, result)
}

// materialize compact theory rows only after ranking has already happened
// this keeps the future search loop free of full echo object allocation.
export function matThryRslts(
    payload: ThryPay,
    results: readonly OptRawResult[],
    limit?: number,
): TheoryResult[] {
  const finalized: TheoryResult[] = []
  const maxItems = Math.max(1, Math.floor((limit ?? results.length) || 1))
  const execution = getThryXct(payload)

  for (const result of results) {
    const echoes = matThryRsltCh(payload, result)
    if (!echoes) {
      continue
    }

    finalized.push({
      damage: result.damage,
      uids: echoes.map((echo) => echo.uid),
      echoes,
      stats: 'ids' in result
          ? result.stats
          : (execution.mode === 'rotation'
            ? evalRotRsltS(execution, result)
            : evalOptBagRs(execution, result)),
    })

    if (finalized.length >= maxItems) {
      break
    }
  }

  return finalized
}

export function evalPrepOptB(
  payload: PrepOptPay,
  mainIndex: number,
): { damage: number; stats: OptResultStats | null } | null {
  if (payload.mode === 'theoryTarget' || payload.mode === 'theoryRotation') {
    return null
  }

  const comboIds = mkSqntCmbIds(payload.costs.length)
  if (comboIds.length === 0 || mainIndex < 0 || mainIndex >= comboIds.length) {
    return null
  }

  if (payload.mode === 'rotation') {
    const execution = packRotation(payload)
    if (execution.contextCount <= 0) {
      return {
        damage: 0,
        stats: null,
      }
    }

    let damage = 0
    for (let index = 0; index < execution.contextCount; index += 1) {
      const base = index * execution.contextStride
      const evaluated = evalTarget({
        context: execution.contexts.subarray(base, base + execution.contextStride),
        stats: execution.stats,
        setConstLut: execution.setConstLut,
        mainEchoBuffs: execution.mainEchoBuffs,
        sets: execution.sets,
        kinds: execution.kinds,
        comboIds,
        mainIndex,
      })
      damage += (evaluated?.damage ?? 0) * (execution.contextWeight[index] ?? 1)
    }

    return {
      damage,
      stats: evalTarget({
        context: execution.displayContext,
        stats: execution.stats,
        setConstLut: execution.setConstLut,
        mainEchoBuffs: execution.mainEchoBuffs,
        sets: execution.sets,
        kinds: execution.kinds,
        comboIds,
        mainIndex,
      })?.stats ?? null,
    }
  }

  const execution = packTargetSkill(payload)
  const evaluated = evalTarget({
    context: execution.context,
    stats: execution.stats,
    setConstLut: execution.setConstLut,
    mainEchoBuffs: execution.mainEchoBuffs,
    sets: execution.sets,
    kinds: execution.kinds,
    comboIds,
    mainIndex,
  })

  return evaluated
    ? {
        damage: evaluated.damage,
        stats: evaluated.stats,
      }
    : null
}
