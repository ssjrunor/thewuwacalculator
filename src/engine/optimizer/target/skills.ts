/*
  Author: Runor Ewhro
  Description: lists valid direct optimizer targets from a runtime and prepares
               a specific target skill only when it remains eligible for direct
               optimizer evaluation.
*/

import type { ResonatorRuntimeState } from '@/domain/entities/runtime.ts'
import type { CombatContext } from '@/engine/pipeline/types.ts'
import type { SkillDefinition } from '@/domain/entities/stats.ts'
import { listRuntimeSkills } from '@/domain/services/runtimeSourceService.ts'
import { resolveSkill } from '@/engine/pipeline/resolveSkill.ts'
import { prepareRuntimeSkillById } from '@/engine/pipeline/prepareRuntimeSkill.ts'
import { isOptimizerDamageSkill } from '@/engine/optimizer/rules/eligibility.ts'

// local helper that defines which prepared skills can be selected
// as direct optimizer targets
function isDirectTarget(skill: SkillDefinition): boolean {
  return isOptimizerDamageSkill(skill)
}

// enumerate all runtime-visible skills, fully resolve each one against the
// current runtime state, then keep only those that qualify as optimizer targets
export function listOptimizerTargets(runtime: ResonatorRuntimeState): SkillDefinition[] {
  return listRuntimeSkills(runtime)
      .map((skill) => resolveSkill(runtime, skill))
      .filter(isDirectTarget)
}

// prepare one specific skill id inside a known combat context and return it
// only if the prepared skill still exists and is optimizer-eligible
export function prepareOptimizerTarget(
    runtime: ResonatorRuntimeState,
    skillId: string,
    combat: CombatContext,
): SkillDefinition | null {
  const prepared = prepareRuntimeSkillById(runtime, skillId, combat)

  if (!prepared || !isDirectTarget(prepared)) {
    return null
  }

  return prepared
}
