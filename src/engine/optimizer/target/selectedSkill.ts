/*
  Author: Runor Ewhro
  Description: defines the minimal skill shape the optimizer needs when
               matching main-echo bonuses and packed damage contexts, and
               extracts that shape from a full skill definition.
*/

import type { AttributeKey, SkillArch, SkillDef, SkillTypeKey } from '@/domain/entities/stats.ts'

// reduced skill model used by optimizer systems that do not need the full runtime skill object
export interface OptTargetSkill {
  // stable skill id used for exact effect matching
  id: string

  // source tab/category the skill belongs to
  tab: string

  // elemental attribute used for elemental bonus matching
  element: AttributeKey

  // all skill-type tags attached to the skill
  skillType: SkillTypeKey[]

  // high-level damage/support archetype used by packed evaluators
  archetype: SkillArch
}

// project a full skill definition down to the compact optimizer-facing shape
export function selOptTgtSkl(skill: SkillDef): OptTargetSkill {
  return {
    id: skill.id,
    tab: skill.tab,
    element: skill.element,
    skillType: skill.skillType,
    archetype: skill.archetype,
  }
}