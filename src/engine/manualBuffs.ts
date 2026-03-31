/*
  Author: Runor Ewhro
  Description: Applies manual quick buffs and custom manual modifiers to
               unified buff pools and individual skill definitions.
*/

import type { ManualBuffs, ManualModifier } from '@/domain/entities/manualBuffs'
import type { SkillDefinition, UnifiedBuffPool } from '@/domain/entities/stats'
import { makeModBuff } from '@/engine/resolvers/buffPool'

// check whether a manual modifier should be applied
function isEnabled(modifier: ManualModifier): boolean {
  return modifier.enabled && Number.isFinite(modifier.value) && modifier.value !== 0
}

// apply manual quick buffs and non-skill manual modifiers to the shared buff pool
export function applyManualBuffsToPool(pool: UnifiedBuffPool, manualBuffs: ManualBuffs): void {
  const { quick, modifiers } = manualBuffs

  // apply quick stat buffs
  pool.atk.flat += quick.atk.flat
  pool.atk.percent += quick.atk.percent
  pool.hp.flat += quick.hp.flat
  pool.hp.percent += quick.hp.percent
  pool.def.flat += quick.def.flat
  pool.def.percent += quick.def.percent
  pool.critRate += quick.critRate
  pool.critDmg += quick.critDmg
  pool.energyRegen += quick.energyRegen
  pool.healingBonus += quick.healingBonus

  // apply scoped manual modifiers
  for (const modifier of modifiers) {
    if (!isEnabled(modifier)) {
      continue
    }

    switch (modifier.scope) {
      case 'baseStat':
        pool[modifier.stat][modifier.field] += modifier.value
        break

      case 'topStat':
        pool[modifier.stat] += modifier.value
        break

      case 'attribute':
        pool.attribute[modifier.attribute][modifier.mod] += modifier.value
        break

      case 'skillType':
        pool.skillType[modifier.skillType][modifier.mod] += modifier.value
        break

        // skill-scoped modifiers are handled separately per skill
      case 'skill':
        break

      default:
        break
    }
  }
}

// check whether a skill matches a manual skill modifier
function matchesSkillModifier(
    skill: SkillDefinition,
    modifier: Extract<ManualModifier, { scope: 'skill' }>,
): boolean {
  if (modifier.matchMode === 'skillId') {
    return Boolean(modifier.skillId) && skill.id === modifier.skillId
  }

  return Boolean(modifier.tab) && skill.tab === modifier.tab
}

// sum the effective multiplier across all hits in a skill
function sumHits(skill: Pick<SkillDefinition, 'hits'>): number {
  return skill.hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
}

// apply skill-scoped manual modifiers directly to a skill definition
export function applyManualSkillModifiers(skill: SkillDefinition, manualBuffs: ManualBuffs): SkillDefinition {
  let next = skill

  for (const modifier of manualBuffs.modifiers) {
    if (modifier.scope !== 'skill' || !isEnabled(modifier) || !matchesSkillModifier(next, modifier)) {
      continue
    }

    next = {
      ...next,

      // keep multiplier in sync with hit data when the skill uses explicit hits
      multiplier: next.hits.length > 0 ? sumHits(next) : next.multiplier,

      // merge manual modifier into the skill's custom skill buff bucket
      skillBuffs: {
        ...(next.skillBuffs ?? makeModBuff()),
        [modifier.mod]: (next.skillBuffs?.[modifier.mod] ?? 0) + modifier.value,
      },
    }
  }

  return next
}