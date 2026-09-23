/*
  Author: Runor Ewhro
  Description: materializes raw optimizer rows back into user-facing result
               entries and optional recomputed stat snapshots for display.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { matThryRsltCh } from './theoryEchoes.ts'
export { matThryEcho, matThryRsltCh } from './theoryEchoes.ts'
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
} from '@/engine/optimizer/types.ts'
import { evalTarget } from '@/engine/optimizer/target/evaluate.ts'
import { composeOneWeaponContext } from '@/engine/optimizer/target/cpu.ts'
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
  contextOverride?: Float32Array,
): OptResultStats | null {
  const comboIds = fillOptBagRs(new Int32Array(5), result)
  const mainIndex = comboIds[0] ?? -1
  if (mainIndex < 0) {
    return null
  }

  return evalTarget({
    context: contextOverride ?? execution.context,
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

// the display context to use for one rotation result row. weapon search recorded
// the chosen weapon per build, so its own display context (not the equipped
// weapon's) is used so the stat columns match the result's damage.
function rotWeaponDisplay(
  execution: PckdRotXctnP,
  result: OptBagResult,
): Float32Array | undefined {
  const weaponIdx = 'weapon' in result ? (result.weapon ?? -1) : -1
  const display = execution.weaponDisplayContexts
  const stride = execution.contextStride
  if (weaponIdx >= 0 && display && (execution.weaponCount ?? 0) > weaponIdx) {
    return display.subarray(weaponIdx * stride, (weaponIdx + 1) * stride)
  }
  return undefined
}

// recompute the display-context stat summary for one rotation-mode result row.
// displayOverride lets weapon search supply the chosen weapon's display context.
function evalRotRsltS(
  execution: PckdRotXctnP,
  result: OptBagResult,
  displayOverride?: Float32Array,
): OptResultStats | null {
  const comboIds = fillOptBagRs(new Int32Array(5), result)
  const mainIndex = comboIds[0] ?? -1
  if (mainIndex < 0) {
    return null
  }

  return evalTarget({
    context: displayOverride ?? execution.displayContext,
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

// compute the stat line for one raw theory result without expanding echoes.
export function evalThryRsltS(
    payload: ThryPay,
    result: OptRawResult,
): OptResultStats | null {
  if ('ids' in result) {
    return result.stats
  }

  const execution = getThryXct(payload)
  if (execution.mode === 'rotation') {
    return evalRotRsltS(execution, result, rotWeaponDisplay(execution, result))
  }

  // weapon search: recompute stats against the weapon the search chose for this
  // build, not the equipped one, so the stat columns match the result's damage.
  const weaponIdx = 'weapon' in result ? (result.weapon ?? -1) : -1
  const overlays = execution.weaponOverlays
  const weaponCtx = weaponIdx >= 0 && overlays && (execution.weaponCount ?? 0) > weaponIdx
      ? composeOneWeaponContext(execution.context, overlays, weaponIdx)
      : undefined
  return evalOptBagRs(execution, result, weaponCtx)
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

    // map the best-weapon index (bag results only) back to its catalog id.
    const weaponIdx = 'ids' in result ? -1 : (result.weapon ?? -1)
    const weaponId = weaponIdx >= 0
        ? (payload.weaponIds?.[weaponIdx] ?? null)
        : null

    finalized.push({
      damage: result.damage,
      uids: echoes.map((echo) => echo.uid),
      echoes,
      stats: 'ids' in result
          ? result.stats
          : (execution.mode === 'rotation'
            ? evalRotRsltS(execution, result, rotWeaponDisplay(execution, result))
            : evalOptBagRs(execution, result)),
      weaponId,
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
