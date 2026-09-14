/*
  Author: Runor Ewhro
  Description: Resolves one skill against one stat snapshot into the terms the
               damage formula multiplies together. Both the calculation and the
               breakdown the results pane prints read from here, so a figure the
               app shows is the figure it used.
*/

import { ATTR_ENEMY_RES, isNoEnemy } from '@/domain/entities/appState.ts'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { FinalStats, ModBuff, SkillDef } from '@/domain/entities/stats.ts'
import { makeModBuff, mergeSkillType } from '@/engine/resolvers/buffPool.ts'

// convert an enemy resistance percentage into the game damage multiplier
export function resistMult(enemyResPct: number): number {
  // resistance uses the game's three-piece curve: negative resistance has reduced penalty, normal resistance is
  // linear, and very high resistance compresses through the asymptotic branch.
  if (enemyResPct < 0) return 1 - enemyResPct / 200
  if (enemyResPct < 75) return 1 - enemyResPct / 100
  return 1 / (1 + 5 * (enemyResPct / 100))
}

// defense shred and defense ignore reduce enemy defense as separate factors
export function defenseReduction(defIgnore: number, defShred: number): number {
  return (1 - defShred / 100) * (1 - defIgnore / 100)
}

// resolve the enemy resistance bucket for the skill's element
export function getEnemyRes(enemy: EnemyProfile, element: SkillDef['element']): number {
  if (isNoEnemy(enemy)) {
    return 0
  }

  return enemy.res[ATTR_ENEMY_RES[element]]
}

// normalize optional per-skill buffs into a complete modifier object
export function makeSkillBuffs(skill: SkillDef): ModBuff {
  return {
    ...makeModBuff(),
    ...(skill.skillBuffs ?? {}),
  }
}

export function enemyDefenseBase(enemy: EnemyProfile): number {
  return (8 * enemy.level) + 792
}

export function calcBasePower(finalStats: FinalStats, skill: SkillDef): number {
  return (
    finalStats.atk.final * skill.scaling.atk +
    finalStats.hp.final * skill.scaling.hp +
    finalStats.def.final * skill.scaling.def +
    finalStats.energyRegen * skill.scaling.energyRegen
  )
}

export function sumHitScale(hits: SkillDef['hits']): number {
  return hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
}

// resolve the effective hit list for a skill
// if the skill has no explicit hit breakdown, synthesize one from fallback multiplier
export function resolveHits(skill: SkillDef, fallbackMult = 0): SkillDef['hits'] {
  // generated skills should provide explicit hit rows; the fallback keeps legacy single-multiplier skills explainable.
  if (skill.hits.length > 0) {
    return skill.hits
  }

  if (fallbackMult <= 0) {
    return []
  }

  return [{ count: 1, multiplier: fallbackMult }]
}

/**
 * The buff buckets a skill is resolved against: generic, per attribute, per
 * skill type, and the skill's own.
 */
export interface DamagePools {
  skillTypeAll: ModBuff
  skillTypeBuff: ModBuff
  attributeAll: ModBuff
  attrElement: ModBuff
  skillBuffs: ModBuff
}

export function gatherPools(finalStats: FinalStats, skill: SkillDef): DamagePools {
  return {
    skillTypeAll: finalStats.skillType.all,
    skillTypeBuff: mergeSkillType(finalStats.skillType, skill.skillType),
    attributeAll: finalStats.attribute.all,
    attrElement: finalStats.attribute[skill.element],
    skillBuffs: makeSkillBuffs(skill),
  }
}

/**
 * Every scope that contributes one modifier, summed. The sheet's figure is
 * only the first of six; the rest arrive from the attribute, skill type and
 * skill buffs in force.
 */
export function layerModifier(pools: DamagePools, read: (pool: ModBuff) => number): number {
  return read(pools.attributeAll)
    + read(pools.attrElement)
    + read(pools.skillTypeAll)
    + read(pools.skillTypeBuff)
    + read(pools.skillBuffs)
}

export interface DamageFactors extends DamagePools {
  /** enemy base resistance is 100, which is immunity before any shred */
  zeroed: boolean
  ignoresEnemy: boolean
  baseRes: number
  resShred: number
  enemyResVl: number
  resMult: number
  totalDefIgnore: number
  totalDefShred: number
  enemyDefBase: number
  enemyDefense: number
  defMult: number
  dmgBonusPrcn: number
  dmgBonusMult: number
  ampPrcn: number
  ampMult: number
  dmgVulnPct: number
  dmgVulnMult: number
  finalDmgPct: number
  finalDmgMult: number
  critRatePrcn: number
  critRate: number
  critDmgPrcn: number
  critDmg: number
}

/**
 * Resolve one skill against one stat snapshot. Percentages are kept beside the
 * multipliers they produce, because explaining a number needs both.
 */
export function resolveDamageFactors(
  finalStats: FinalStats,
  skill: SkillDef,
  enemy: EnemyProfile,
  level: number,
): DamageFactors {
  const pools = gatherPools(finalStats, skill)
  const ignoresEnemy = isNoEnemy(enemy)
  const baseRes = ignoresEnemy ? 0 : getEnemyRes(enemy, skill.element)
  const zeroed = !ignoresEnemy && baseRes === 100

  // shred can come from general, element-specific, skill-type, and skill-local buffs; sum it before applying the
  // resistance curve so one effective enemy resistance can be stated.
  const resShred = layerModifier(pools, (pool) => pool.resShred)
  const enemyResVl = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = zeroed ? 0 : (ignoresEnemy ? 1 : resistMult(enemyResVl))

  const totalDefIgnore = finalStats.defIgnore + layerModifier(pools, (pool) => pool.defIgnore)
  const totalDefShred = finalStats.defShred + layerModifier(pools, (pool) => pool.defShred)

  const enemyDefBase = ignoresEnemy ? 0 : enemyDefenseBase(enemy)
  const enemyDefense = ignoresEnemy
    ? 0
    : enemyDefBase * defenseReduction(totalDefIgnore, totalDefShred)
  const defMult = ignoresEnemy
    ? 1
    : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))

  // additive percent buckets are accumulated first and converted to multipliers only after all matching scopes have
  // contributed.
  const dmgBonusPrcn = finalStats.dmgBonus + layerModifier(pools, (pool) => pool.dmgBonus)
  const ampPrcn = finalStats.amplify + layerModifier(pools, (pool) => pool.amplify)
  const dmgVulnPct = finalStats.dmgVuln + layerModifier(pools, (pool) => pool.dmgVuln)
  const finalDmgPct = finalStats.finalDmg
  const critRatePrcn = finalStats.critRate + layerModifier(pools, (pool) => pool.critRate)
  const critDmgPrcn = finalStats.critDmg + layerModifier(pools, (pool) => pool.critDmg)

  return {
    ...pools,
    zeroed,
    ignoresEnemy,
    baseRes,
    resShred,
    enemyResVl,
    resMult,
    totalDefIgnore,
    totalDefShred,
    // the immune shortcut still states what the enemy's defence would have been
    enemyDefBase: ignoresEnemy ? 0 : enemyDefenseBase(enemy),
    enemyDefense,
    defMult,
    dmgBonusPrcn,
    dmgBonusMult: 1 + dmgBonusPrcn / 100,
    ampPrcn,
    ampMult: 1 + ampPrcn / 100,
    dmgVulnPct,
    dmgVulnMult: 1 + dmgVulnPct / 100,
    finalDmgPct,
    finalDmgMult: 1 + finalDmgPct / 100,
    critRatePrcn,
    critRate: critRatePrcn / 100,
    critDmgPrcn,
    critDmg: critDmgPrcn / 100,
  }
}
