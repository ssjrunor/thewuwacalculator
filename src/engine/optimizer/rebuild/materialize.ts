import type { EchoInstance } from '@/domain/entities/runtime'
import type {
  OptimizerBagResultRef,
  OptimizerResultEntry,
  OptimizerResultStats,
  PackedRotationExecutionPayload,
  PackedTargetSkillExecutionPayload,
  PreparedOptimizerPayload,
} from '@/engine/optimizer/types'
import { evalTarget } from '@/engine/optimizer/rebuild/target/evaluate'
import { fillOptimizerBagResultComboIds } from '@/engine/optimizer/rebuild/results'
import { createPackedTargetSkillExecution } from '@/engine/optimizer/rebuild/target/execution'
import { createPackedRotationExecution } from '@/engine/optimizer/rebuild/rotation/execution'

function buildSequentialComboIds(count: number): Int32Array {
  const comboIds = new Int32Array(count)
  for (let index = 0; index < count; index += 1) {
    comboIds[index] = index
  }
  return comboIds
}

function evaluateOptimizerBagResultStatsWithExecution(
  execution: PackedTargetSkillExecutionPayload,
  result: OptimizerBagResultRef,
): OptimizerResultStats | null {
  const comboIds = fillOptimizerBagResultComboIds(new Int32Array(5), result)
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

function evaluateRotationResultStatsWithExecution(
  execution: PackedRotationExecutionPayload,
  result: OptimizerBagResultRef,
): OptimizerResultStats | null {
  const comboIds = fillOptimizerBagResultComboIds(new Int32Array(5), result)
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

export function resolveOptimizerResultEchoes(
  bagEchoes: readonly EchoInstance[],
  result: OptimizerBagResultRef,
): Array<EchoInstance | null> {
  return [
    bagEchoes[result.i0] ?? null,
    bagEchoes[result.i1] ?? null,
    bagEchoes[result.i2] ?? null,
    bagEchoes[result.i3] ?? null,
    bagEchoes[result.i4] ?? null,
  ]
}

export function evaluateOptimizerBagResultStats(
  payload: PreparedOptimizerPayload,
  result: OptimizerBagResultRef,
): OptimizerResultStats | null {
  return payload.mode === 'rotation'
    ? evaluateRotationResultStatsWithExecution(
        createPackedRotationExecution(payload),
        result,
      )
    : evaluateOptimizerBagResultStatsWithExecution(
        createPackedTargetSkillExecution(payload),
        result,
      )
}

export function materializeOptimizerResults(
  bagEchoes: readonly EchoInstance[],
  results: readonly OptimizerBagResultRef[],
  options: {
    payload?: PreparedOptimizerPayload | null
    limit?: number
  } = {},
): OptimizerResultEntry[] {
  const finalized: OptimizerResultEntry[] = []
  const maxItems = Math.max(1, Math.floor((options.limit ?? results.length) || 1))
  const execution = options.payload
    ? (options.payload.mode === 'rotation'
      ? createPackedRotationExecution(options.payload)
      : createPackedTargetSkillExecution(options.payload))
    : null

  for (const result of results) {
    const echoes = resolveOptimizerResultEchoes(bagEchoes, result)
    if (echoes.some((echo) => !echo?.uid)) {
      continue
    }

    finalized.push({
      damage: result.damage,
      uids: echoes.map((echo) => echo?.uid ?? ''),
      stats: execution
        ? (execution.mode === 'rotation'
          ? evaluateRotationResultStatsWithExecution(execution, result)
          : evaluateOptimizerBagResultStatsWithExecution(execution, result))
        : null,
    })

    if (finalized.length >= maxItems) {
      break
    }
  }

  return finalized
}

export function materializeOptimizerResultsFromUids(
  uidByIndex: readonly string[],
  results: readonly OptimizerBagResultRef[],
  options: {
    payload?: PreparedOptimizerPayload | null
    limit?: number
  } = {},
): OptimizerResultEntry[] {
  const finalized: OptimizerResultEntry[] = []
  const maxItems = Math.max(1, Math.floor((options.limit ?? results.length) || 1))
  const execution = options.payload
    ? (options.payload.mode === 'rotation'
      ? createPackedRotationExecution(options.payload)
      : createPackedTargetSkillExecution(options.payload))
    : null

  for (const result of results) {
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
          ? evaluateRotationResultStatsWithExecution(execution, result)
          : evaluateOptimizerBagResultStatsWithExecution(execution, result))
        : null,
    })

    if (finalized.length >= maxItems) {
      break
    }
  }

  return finalized
}

export function evaluatePreparedOptimizerBaseline(
  payload: PreparedOptimizerPayload,
  mainIndex: number,
): { damage: number; stats: OptimizerResultStats | null } | null {
  const comboIds = buildSequentialComboIds(payload.costs.length)
  if (comboIds.length === 0 || mainIndex < 0 || mainIndex >= comboIds.length) {
    return null
  }

  if (payload.mode === 'rotation') {
    const execution = createPackedRotationExecution(payload)
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
      damage += (evaluated?.damage ?? 0) * (execution.contextWeights[index] ?? 1)
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

  const execution = createPackedTargetSkillExecution(payload)
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
