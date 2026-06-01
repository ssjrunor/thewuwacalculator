/*
  Author: Runor Ewhro
  Description: Shared damage-immunity check used by the damage formulas and the
               optimizer's compiled context to zero out attacks an enemy is immune to.
*/

import type { ImmunitySet, NegEffectKey, SkillDef } from '@/domain/entities/stats'

// a skill is immune when the enemy is immune to all damage, the skill's element, any of its
// skill types, or (for negative-effect skills) its archetype. healing/shield skills never target
// the enemy, so callers should skip them.
export function isSkillImmune(immunities: ImmunitySet | undefined, skill: SkillDef): boolean {
  if (!immunities) {
    return false
  }

  if (immunities.all) {
    return true
  }

  if (immunities.elements.includes(skill.element)) {
    return true
  }

  if (skill.skillType.some((type) => immunities.skillTypes.includes(type))) {
    return true
  }

  return immunities.negativeEffects.includes(skill.archetype as NegEffectKey)
}
