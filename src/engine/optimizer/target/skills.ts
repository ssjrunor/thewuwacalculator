/*
  Author: Runor Ewhro
  Description: lists valid direct optimizer targets from a runtime and prepares
               a specific target skill only when it remains eligible for direct
               optimizer evaluation.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { CombatContext } from '@/engine/pipeline/types.ts'
import type { SkillDef } from '@/domain/entities/stats.ts'
import { listRtSkills } from '@/domain/services/runtimeSourceService.ts'
import { resolveSkill } from '@/engine/pipeline/resolveSkill.ts'
import { prepareSkill } from '@/engine/pipeline/prepareRuntimeSkill.ts'
import { isOptDmgSkll } from '@/engine/optimizer/rules/eligibility.ts'

// local helper that defines which prepared skills can be selected
// as direct optimizer targets
function isDrctTgt(skill: SkillDef): boolean {
  return isOptDmgSkll(skill)
}

// enumerate all runtime-visible skills, fully resolve each one against the
// current runtime state, then keep only those that qualify as optimizer targets
export function listOptTrgt(runtime: ResRuntime): SkillDef[] {
  return listRtSkills(runtime)
      .map((skill) => resolveSkill(runtime, skill))
      .filter(isDrctTgt)
}

// prepare one specific skill id inside a known combat context and return it
// only if the prepared skill still exists and is optimizer-eligible
export function prprOptTgt(
    runtime: ResRuntime,
    skillId: string,
    combat: CombatContext,
): SkillDef | null {
  const prepared = prepareSkill(runtime, skillId, combat)

  if (!prepared || !isDrctTgt(prepared)) {
    return null
  }

  return prepared
}
