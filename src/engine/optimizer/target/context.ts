/*
  Author: Runor Ewhro
  Description: prepares a fully compiled optimizer target context for one
               selected skill by resolving the resonator seed, building the
               runtime combat snapshot for that skill, and translating the
               result into the packed optimizer form used by the
               search pipeline.
*/

import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { ResRuntime, ResSeed } from '@/domain/entities/runtime.ts'
import type { SkillDef } from '@/domain/entities/stats.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { prepSkill, makeSkillCtx } from '@/engine/pipeline/prepareRuntimeSkill.ts'
import type { CompTargetSkill } from '@/engine/optimizer/types.ts'
import { selOptTgtSkl, type OptTargetSkill } from '@/engine/optimizer/target/selectedSkill.ts'
import { makeOptContext } from '@/engine/optimizer/context/compiled.ts'

export interface PrepOptTgtCt {
  // fully resolved skill definition that the optimizer is targeting
  skill: SkillDef

  // lightweight target descriptor used by optimizer encoding/search logic
  selectedSkill: OptTargetSkill

  // combat snapshot produced for this exact runtime + enemy + skill context
  combat: ReturnType<typeof makeSkillCtx>['context']

  // numeric optimizer-ready context derived from the combat snapshot
  compiled: CompTargetSkill
}

interface TgtCtxNpt {
  // current active runtime whose selected skill is being optimized
  runtime: ResRuntime

  // active resonator id
  resonatorId: string

  // optional already-resolved seed from the main thread/runtime owner
  resSeed?: ResSeed

  // exact skill id to prepare for optimization
  skillId: string

  // enemy profile used for stat and damage resolution
  enemy: EnemyProfile

  // participant lookup used for cross-runtime effects/targeting
  runtimesById: Record<string, ResRuntime>

  // optional per-owner selected target mapping
  selectedTargets?: Record<string, string | null>
}

export function compOptTgtCt(input: TgtCtxNpt): PrepOptTgtCt {
  // resolve the seed first because all skill/runtime preparation depends on it
  const seed = input.resSeed ?? getResSeedBy(input.resonatorId)
  if (!seed) {
    throw new Error(`Missing resonator seed for optimizer id ${input.resonatorId}`)
  }

  // build the exact prepared runtime skill snapshot for this selected skill
  const prepared = prepSkill({
    runtime: input.runtime,
    seed,
    enemy: input.enemy,
    runtimesById: input.runtimesById,
    selectedTargets: input.selectedTargets,
    skillId: input.skillId,
  })

  // fail loudly if that skill is not currently available in this runtime state
  if (!prepared) {
    throw new Error(`Optimizer target skill ${input.skillId} is not available for runtime ${input.resonatorId}`)
  }

  const { context: combat, skill } = prepared

  // convert the resolved combat snapshot into the flattened compiled context
  // that cpu/gpu optimizer evaluation code expects
  const compiled: CompTargetSkill = makeOptContext({
    resonatorId: input.resonatorId,
    runtime: input.runtime,
    skill,
    finalStats: combat.finalStats,
    enemy: input.enemy,
    combatState: input.runtime.state.combat,
  })

  return {
    skill,
    selectedSkill: selOptTgtSkl(skill),
    combat,
    compiled,
  }
}
