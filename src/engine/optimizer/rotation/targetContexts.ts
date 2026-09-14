/*
  Author: Runor Ewhro
  Description: Implements the targetContexts logic for the rotation module.
*/

/*
  Shared owner-context resolution and numeric packing for any evaluator that
  scores a materialized rotation as weighted skill targets.
*/

import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { CombatGraph } from '@/domain/entities/combatGraph.ts'
import type { SkillDef } from '@/domain/entities/stats.ts'
import type { FinalStats } from '@/domain/entities/stats.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { DamageCombatState } from '@/engine/formulas/damage.ts'
import { findCombatPart } from '@/domain/state/combatGraph.ts'
import { CTX_FLOATS } from '@/engine/optimizer/config/constants.ts'
import { makeOptContext } from '@/engine/optimizer/context/compiled.ts'
import { packTargetCtx } from '@/engine/optimizer/context/pack.ts'
import { MV } from '@/engine/optimizer/config/constants.ts'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext.ts'

export type RotationCombatContext = ReturnType<typeof makeCombatEnv>

export interface RotationTargetContext {
  resonatorId: string
  skill: SkillDef
  weight?: number
  runtime?: ResRuntime
  finalStats?: FinalStats
  combat?: DamageCombatState
  nodeMultiplier?: number
}

export interface RotationContextShape {
  comboN: number
  comboK: number
  comboCount: number
  setRtMask: number
}

export interface PackedRotationTargetContexts<T extends RotationTargetContext> {
  targets: T[]
  contexts: Float32Array
  contextWeight: Float32Array
  displayContext: Float32Array | null
}

export function buildRotationCombatContexts(
    graph: CombatGraph,
    activeContext: RotationCombatContext,
    activeId: string,
    targets: readonly RotationTargetContext[],
    enemy: EnemyProfile,
): Record<string, RotationCombatContext> {
  const contexts: Record<string, RotationCombatContext> = { [activeId]: activeContext }

  for (const target of targets) {
    if (target.runtime && target.finalStats) {
      continue
    }
    if (contexts[target.resonatorId]) {
      continue
    }

    const slotId = findCombatPart(graph, target.resonatorId)
    if (!slotId) {
      continue
    }

    contexts[target.resonatorId] = makeCombatEnv({ graph, targetSlotId: slotId, enemy })
  }

  return contexts
}

export function packRotationTargetContexts<T extends RotationTargetContext>(options: {
  targets: readonly T[]
  combatByResonatorId: Record<string, RotationCombatContext>
  activeContext: RotationCombatContext
  enemy: EnemyProfile
  shape: RotationContextShape
  prepareSkill?: (target: T, ownerContext: RotationCombatContext) => SkillDef
}): PackedRotationTargetContexts<T> {
  const {
    targets: sourceTargets,
    combatByResonatorId,
    activeContext,
    enemy,
    shape,
    prepareSkill,
  } = options
  const targets: T[] = []
  const contexts = new Float32Array(sourceTargets.length * CTX_FLOATS)
  const contextWeight = new Float32Array(sourceTargets.length)
  let displayContext: Float32Array | null = null
  let lowestPositive = Number.POSITIVE_INFINITY
  let lowestCrit = Number.POSITIVE_INFINITY
  let lowestZero = Number.POSITIVE_INFINITY

  for (let index = 0; index < sourceTargets.length; index += 1) {
    const sourceTarget = sourceTargets[index]
    const ownerContext = combatByResonatorId[sourceTarget.resonatorId] ?? activeContext
    const skill = prepareSkill?.(sourceTarget, ownerContext) ?? sourceTarget.skill
    const target = skill === sourceTarget.skill
      ? sourceTarget
      : { ...sourceTarget, skill }
    const compiled = makeOptContext({
      resonatorId: target.resonatorId,
      runtime: target.runtime ?? ownerContext.runtime,
      skill,
      finalStats: target.finalStats ?? ownerContext.finalStats,
      enemy,
      combatState: target.combat ?? ownerContext.runtime.state.combat,
    })
    const packed = packTargetCtx({
      compiled,
      skill,
      runtime: ownerContext.runtime,
      comboN: shape.comboN,
      comboK: shape.comboK,
      comboCount: shape.comboCount,
      comboBaseIndex: 0,
      lockEchoIdx: -1,
      setRtMask: shape.setRtMask,
    })
    const weight = target.weight ?? 1
    packed[MV] = (packed[MV] ?? 0) * (target.nodeMultiplier ?? 1)

    targets.push(target as T)
    contexts.set(packed, index * CTX_FLOATS)
    contextWeight[index] = weight

    if (skill.archetype !== 'skillDamage') {
      continue
    }

    const critSum = compiled.statCritRate + compiled.statCritDmg
    const displayValue = Number.isFinite(weight) ? weight : 1
    if (
      displayValue > 0
      && (displayValue < lowestPositive || (displayValue === lowestPositive && critSum < lowestCrit))
    ) {
      lowestPositive = displayValue
      lowestCrit = critSum
      displayContext = new Float32Array(packed)
      continue
    }

    if (lowestPositive === Number.POSITIVE_INFINITY && displayValue === 0 && critSum < lowestZero) {
      lowestZero = critSum
      displayContext = new Float32Array(packed)
    }
  }

  return { targets, contexts, contextWeight, displayContext }
}
