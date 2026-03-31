/*
  Author: Runor Ewhro
  Description: prepares a fully compiled optimizer target context for one
               selected skill by resolving the resonator seed, building the
               runtime combat snapshot for that skill, and translating the
               result into the packed optimizer form used by the
               search pipeline.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { SkillDefinition } from '@/domain/entities/stats'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { buildPreparedRuntimeSkill, buildRuntimeSkillContext } from '@/engine/pipeline/prepareRuntimeSkill'
import type { CompiledTargetSkillContext } from '@/engine/optimizer/types'
import { selectOptimizerTargetSkill, type OptimizerTargetSkill } from '@/engine/optimizer/rebuild/target/selectedSkill'
import { buildCompiledOptimizerContext } from '@/engine/optimizer/rebuild/context/compiled'

export interface PreparedOptimizerTargetContext {
  // fully resolved skill definition that the optimizer is targeting
  skill: SkillDefinition

  // lightweight target descriptor used by optimizer encoding/search logic
  selectedSkill: OptimizerTargetSkill

  // combat snapshot produced for this exact runtime + enemy + skill context
  combat: ReturnType<typeof buildRuntimeSkillContext>['context']

  // numeric optimizer-ready context derived from the combat snapshot
  compiled: CompiledTargetSkillContext
}

interface TargetContextInput {
  // current active runtime whose selected skill is being optimized
  runtime: ResonatorRuntimeState

  // active resonator id
  resonatorId: string

  // exact skill id to prepare for optimization
  skillId: string

  // enemy profile used for stat and damage resolution
  enemy: EnemyProfile

  // participant lookup used for cross-runtime effects/targeting
  runtimesById: Record<string, ResonatorRuntimeState>

  // optional per-owner selected target mapping
  selectedTargetsByOwnerKey?: Record<string, string | null>
}

export function compileOptimizerTargetContext(input: TargetContextInput): PreparedOptimizerTargetContext {
  // resolve the seed first because all skill/runtime preparation depends on it
  const seed = getResonatorSeedById(input.resonatorId)
  if (!seed) {
    throw new Error(`Missing resonator seed for optimizer id ${input.resonatorId}`)
  }

  // build the exact prepared runtime skill snapshot for this selected skill
  const prepared = buildPreparedRuntimeSkill({
    runtime: input.runtime,
    seed,
    enemy: input.enemy,
    runtimesById: input.runtimesById,
    selectedTargetsByOwnerKey: input.selectedTargetsByOwnerKey,
    skillId: input.skillId,
  })

  // fail loudly if that skill is not currently available in this runtime state
  if (!prepared) {
    throw new Error(`Optimizer target skill ${input.skillId} is not available for runtime ${input.resonatorId}`)
  }

  const { context: combat, skill } = prepared

  // convert the resolved combat snapshot into the flattened compiled context
  // that cpu/gpu optimizer evaluation code expects
  const compiled: CompiledTargetSkillContext = buildCompiledOptimizerContext({
    resonatorId: input.resonatorId,
    runtime: input.runtime,
    skill,
    finalStats: combat.finalStats,
    enemy: input.enemy,
    combatState: input.runtime.state.combat,
  })

  return {
    skill,
    selectedSkill: selectOptimizerTargetSkill(skill),
    combat,
    compiled,
  }
}