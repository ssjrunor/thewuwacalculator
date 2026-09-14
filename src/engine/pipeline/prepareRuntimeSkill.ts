/*
  Author: Runor Ewhro
  Description: builds a runtime combat context and prepares runtime skills by
               resolving base skill data and then applying combat-dependent
               skill effects for a specific active runtime.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime, ResSeed } from '@/domain/entities/runtime'
import type { SkillDef } from '@/domain/entities/stats'
import type { CombatContext } from '@/engine/pipeline/types'
import { makeCombatGraph } from '@/domain/state/combatGraph'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import { listRtSkills } from '@/domain/services/runtimeSourceService'
import { evalRuntimeSkillCondition, resolveSkill } from '@/engine/pipeline/resolveSkill'
import { evaluateNumericSkillCondition, prepareNumericSkill } from '@/engine/effects/numericTeam.ts'

interface RtSkllCtxNpt {
  // active runtime whose skills are being prepared
  runtime: ResRuntime

  // resonator seed used to build the transient combat graph
  seed: ResSeed

  // enemy profile used for stat and damage context resolution
  enemy: EnemyProfile

  // optional additional participant runtimes keyed by resonator id
  runtimesById?: Record<string, ResRuntime>

  // optional selected-target mapping for the active resonator
  selectedTargets?: Record<string, string | null>
}

interface RtSkllCtxRsl {
  // fully resolved combat context for the active runtime
  context: CombatContext
}

export interface PrepRtSkllRs extends RtSkllCtxRsl {
  // prepared skill after runtime resolution and skill-data effects
  skill: SkillDef
}

// build a transient combat graph around the active runtime and return the
// resolved combat context for the active slot
export function makeSkillCtx({
                                           runtime,
                                           seed,
                                           enemy,
                                           runtimesById = {},
                                           selectedTargets = {},
                                         }: RtSkllCtxNpt): RtSkllCtxRsl {
  const graph = makeCombatGraph({
    actRt: runtime,
    activeSeed: seed,
    partRts: runtimesById,
    targetsByRes: {
      [runtime.id]: selectedTargets,
    },
  })

  return {
    context: makeCombatEnv({
      graph,
      targetSlotId: 'active',
      enemy,
    }),
  }
}

// resolve a skill against the runtime first, then apply skill-specific
// data effects using the already-built combat context
export function prprRtSkll(
    runtime: ResRuntime,
    skill: SkillDef,
    context: CombatContext,
): SkillDef {
  const resolved = resolveSkill(runtime, skill, (condition) =>
    evaluateNumericSkillCondition(context.numericTeam, context.numericLane, condition)
      ?? evalRuntimeSkillCondition(runtime, condition))
  return prepareNumericSkill(context.numericTeam, context.numericLane, resolved)
}

// locate one runtime skill by id, prepare it, and hide it from callers if
// the prepared result is explicitly marked invisible
export function prepareSkill(
    runtime: ResRuntime,
    skillId: string,
    context: CombatContext,
): SkillDef | null {
  const skill = listRtSkills(runtime).find((entry) => entry.id === skillId)
  if (!skill) {
    return null
  }

  const prepared = prprRtSkll(runtime, skill, context)
  return prepared.visible === false ? null : prepared
}

// convenience helper that builds the combat context and prepares one skill id
// in a single call
export function prepSkill(
    params: RtSkllCtxNpt & { skillId: string },
): PrepRtSkllRs | null {
  const { runtime, skillId } = params
  const { context } = makeSkillCtx(params)
  const skill = prepareSkill(runtime, skillId, context)

  if (!skill) {
    return null
  }

  return {
    context,
    skill,
  }
}
