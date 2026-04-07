/*
  Author: Runor Ewhro
  Description: Computes final skill results for direct damage, support,
               tune rupture, and negative-effect archetypes by combining
               final stats, enemy data, and skill metadata.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import { ATTRIBUTE_TO_ENEMY_RES_INDEX, isUnsetEnemyProfile } from '@/domain/entities/appState'
import type {
  AttributeKey,
  DamageResult,
  FinalStats,
  ModBuff,
  NegativeEffectKey,
  SkillDefinition,
  SkillTypeKey,
} from '@/domain/entities/stats'
import { getNegativeEffectDefaultMax } from '@/domain/gameData/negativeEffects'
import { getNegativeEffectBase } from '@/engine/formulas/negativeEffects'
import { getTuneRuptureLevelScale } from '@/engine/formulas/tuneRupture'
import { aggregateSkillTypeBuffs, makeModBuff } from '@/engine/resolvers/buffPool'

export interface DirectSkillDamageContext {
  baseAtk: number
  baseHp: number
  baseDef: number
  finalAtk: number
  finalHp: number
  finalDef: number
  finalER: number
  critRate: number
  critDmg: number
  dmgBonus: number
  amplify: number
  special: number
  resMult: number
  defenseMultiplier: number
  dmgVulnMultiplier: number
  damageBonusMultiplier: number
  amplifyMultiplier: number
  specialMultiplier: number
  scalingAtk: number
  scalingHp: number
  scalingDef: number
  scalingER: number
  multiplier: number
  hitScale: number
  hitCount: number
  flatDmg: number
  fixedDmg: number
}

// convert an enemy resistance percentage into the game damage multiplier
function resistanceMultiplier(enemyResPercent: number): number {
  if (enemyResPercent < 0) return 1 - enemyResPercent / 200
  if (enemyResPercent < 75) return 1 - enemyResPercent / 100
  return 1 / (1 + 5 * (enemyResPercent / 100))
}

// resolve the enemy resistance bucket for the skill's element
function resolveEnemyResistance(enemy: EnemyProfile, element: SkillDefinition['element']): number {
  if (isUnsetEnemyProfile(enemy)) {
    return 0
  }

  return enemy.res[ATTRIBUTE_TO_ENEMY_RES_INDEX[element]]
}

// normalize optional per-skill buffs into a complete modifier object
function buildSkillBuffs(skill: SkillDefinition): ModBuff {
  return {
    ...makeModBuff(),
    ...(skill.skillBuffs ?? {}),
  }
}

// compute the raw stat-scaled base amount for a skill before multipliers
function computeBaseAbility(finalStats: FinalStats, skill: SkillDefinition): number {
  return (
      finalStats.atk.final * skill.scaling.atk +
      finalStats.hp.final * skill.scaling.hp +
      finalStats.def.final * skill.scaling.def +
      finalStats.energyRegen * skill.scaling.energyRegen
  )
}

// compute all shared damage terms used by direct damage formulas
function computeSharedDamageContext(
    finalStats: FinalStats,
    skill: SkillDefinition,
    enemy: EnemyProfile,
    level: number,
) {
  // aggregate generic and skill-specific buff buckets
  const skillTypeAll = finalStats.skillType.all
  const skillTypeBuff = aggregateSkillTypeBuffs(finalStats.skillType, skill.skillType)
  const attributeAll = finalStats.attribute.all
  const attributeElement = finalStats.attribute[skill.element]
  const skillBuffs = buildSkillBuffs(skill)

  // special-case unset enemies and hard immunity
  const ignoresEnemy = isUnsetEnemyProfile(enemy)
  const baseRes = ignoresEnemy ? 0 : resolveEnemyResistance(enemy, skill.element)
  const zeroed = !ignoresEnemy && baseRes === 100

  // final enemy resistance after all shred sources
  const enemyResValue = ignoresEnemy
      ? 0
      : baseRes
      - attributeAll.resShred
      - attributeElement.resShred
      - skillTypeAll.resShred
      - skillTypeBuff.resShred
      - skillBuffs.resShred

  const resMult = zeroed ? 0 : (ignoresEnemy ? 1 : resistanceMultiplier(enemyResValue))

  // total defense ignore and shred applied to enemy defense
  const totalDefIgnore =
      finalStats.defIgnore +
      attributeAll.defIgnore +
      attributeElement.defIgnore +
      skillTypeAll.defIgnore +
      skillTypeBuff.defIgnore +
      skillBuffs.defIgnore

  const totalDefShred =
      finalStats.defShred +
      attributeAll.defShred +
      attributeElement.defShred +
      skillTypeAll.defShred +
      skillTypeBuff.defShred +
      skillBuffs.defShred

  const enemyDefense = ignoresEnemy
      ? 0
      : ((8 * enemy.level) + 792) * (1 - (totalDefIgnore + totalDefShred) / 100)

  const defenseMultiplier = ignoresEnemy
      ? 1
      : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))

  // total outgoing bonus layers
  const damageBonusPercent =
      finalStats.dmgBonus +
      attributeAll.dmgBonus +
      attributeElement.dmgBonus +
      skillTypeAll.dmgBonus +
      skillTypeBuff.dmgBonus +
      skillBuffs.dmgBonus

  const amplifyPercent =
      finalStats.amplify +
      attributeAll.amplify +
      attributeElement.amplify +
      skillTypeAll.amplify +
      skillTypeBuff.amplify +
      skillBuffs.amplify

  const dmgVulnPercent =
      attributeAll.dmgVuln +
      attributeElement.dmgVuln +
      skillTypeAll.dmgVuln +
      skillTypeBuff.dmgVuln +
      skillBuffs.dmgVuln +
      finalStats.dmgVuln

  const damageBonusMultiplier = 1 + damageBonusPercent / 100
  const amplifyMultiplier = 1 + amplifyPercent / 100
  const dmgVulnMultiplier = 1 + dmgVulnPercent / 100
  const specialMultiplier = 1 + finalStats.special / 100

  // crit values are stored as percents in final stats, so convert to ratios
  const critRate =
      (finalStats.critRate
          + attributeAll.critRate
          + attributeElement.critRate
          + skillTypeAll.critRate
          + skillTypeBuff.critRate
          + skillBuffs.critRate) / 100

  const critDmg =
      (finalStats.critDmg
          + attributeAll.critDmg
          + attributeElement.critDmg
          + skillTypeAll.critDmg
          + skillTypeBuff.critDmg
          + skillBuffs.critDmg) / 100

  void level

  return {
    zeroed,
    skillTypeAll,
    skillTypeBuff,
    attributeAll,
    attributeElement,
    skillBuffs,
    resMult,
    defenseMultiplier,
    damageBonusMultiplier,
    amplifyMultiplier,
    dmgVulnMultiplier,
    specialMultiplier,
    critRate,
    critDmg,
  }
}

// build a zeroed result while preserving the skill hit structure
function makeZeroResult(skill: SkillDefinition): DamageResult {
  return {
    normal: 0,
    crit: 0,
    avg: 0,
    subHits: skill.hits.map((hit) => ({
      ...hit,
      normal: 0,
      crit: 0,
      avg: 0,
    })),
  }
}

// resolve the effective hit list for a skill
// if the skill has no explicit hit breakdown, synthesize one from fallback multiplier
function resolveDamageHits(skill: SkillDefinition, fallbackMultiplier = 0): SkillDefinition['hits'] {
  if (skill.hits.length > 0) {
    return skill.hits
  }

  if (fallbackMultiplier <= 0) {
    return []
  }

  return [{ count: 1, multiplier: fallbackMultiplier }]
}

// sum total hit scaling, taking hit count into account
function sumHitScale(hits: SkillDefinition['hits']): number {
  return hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
}

// count the total number of hits
function countHits(hits: SkillDefinition['hits']): number {
  return hits.reduce((total, hit) => total + hit.count, 0)
}

// expose a detailed direct-damage calculation context for debugging or inspection
export function buildDirectSkillDamageContext(
    finalStats: FinalStats,
    skill: SkillDefinition,
    enemy: EnemyProfile,
    level: number,
): DirectSkillDamageContext {
  const shared = computeSharedDamageContext(finalStats, skill, enemy, level)
  const hits = resolveDamageHits(skill, skill.multiplier)

  return {
    baseAtk: finalStats.atk.base,
    baseHp: finalStats.hp.base,
    baseDef: finalStats.def.base,
    finalAtk: finalStats.atk.final,
    finalHp: finalStats.hp.final,
    finalDef: finalStats.def.final,
    finalER: finalStats.energyRegen,
    critRate: shared.critRate * 100,
    critDmg: shared.critDmg * 100,
    dmgBonus: (shared.damageBonusMultiplier - 1) * 100,
    amplify: (shared.amplifyMultiplier - 1) * 100,
    special: (shared.specialMultiplier - 1) * 100,
    resMult: shared.resMult,
    defenseMultiplier: shared.defenseMultiplier,
    dmgVulnMultiplier: shared.dmgVulnMultiplier,
    damageBonusMultiplier: shared.damageBonusMultiplier,
    amplifyMultiplier: shared.amplifyMultiplier,
    specialMultiplier: shared.specialMultiplier,
    scalingAtk: skill.scaling.atk,
    scalingHp: skill.scaling.hp,
    scalingDef: skill.scaling.def,
    scalingER: skill.scaling.energyRegen,
    multiplier: skill.multiplier,
    hitScale: hits.length > 0 ? sumHitScale(hits) : skill.multiplier,
    hitCount: hits.length > 0 ? countHits(hits) : 1,
    flatDmg: finalStats.flatDmg + skill.flat,
    fixedDmg: skill.fixedDmg ?? 0,
  }
}

// compute standard direct damage skills
function computeDirectDamage(
    finalStats: FinalStats,
    skill: SkillDefinition,
    enemy: EnemyProfile,
    level: number,
): DamageResult {
  // fixed damage bypasses the normal scaling formula
  if ((skill.fixedDmg ?? 0) > 0) {
    const value = Math.max(1, Math.floor(skill.fixedDmg ?? 0))
    const hits = resolveDamageHits(skill, 1)
    const totalHitScale = sumHitScale(hits)

    const subHits = hits.map((hit) => {
      const normal = totalHitScale > 0 ? (value * hit.multiplier) / totalHitScale : value
      return {
        ...hit,
        normal,
        crit: normal,
        avg: normal,
      }
    })

    return {
      normal: subHits.reduce((total, hit) => total + hit.normal * hit.count, 0),
      crit: subHits.reduce((total, hit) => total + hit.crit * hit.count, 0),
      avg: subHits.reduce((total, hit) => total + hit.avg * hit.count, 0),
      subHits,
    }
  }

  const direct = buildDirectSkillDamageContext(finalStats, skill, enemy, level)
  const shared = computeSharedDamageContext(finalStats, skill, enemy, level)

  // full elemental immunity produces zero damage
  if (shared.zeroed) {
    return makeZeroResult(skill)
  }

  const baseAbility = computeBaseAbility(finalStats, skill)

  // final multiplier stack applied to every hit
  const damageMultiplier =
      direct.resMult *
      direct.defenseMultiplier *
      direct.dmgVulnMultiplier *
      direct.damageBonusMultiplier *
      direct.amplifyMultiplier *
      direct.specialMultiplier

  const subHits = skill.hits.map((hit) => {
    const normal = (baseAbility * hit.multiplier + direct.flatDmg) * damageMultiplier
    const crit = normal * (direct.critDmg / 100)
    const critRate = direct.critRate / 100
    const avg = critRate >= 1 ? crit : crit * critRate + normal * (1 - critRate)

    return {
      ...hit,
      normal,
      crit,
      avg,
    }
  })

  return {
    normal: subHits.reduce((total, hit) => total + hit.normal * hit.count, 0),
    crit: subHits.reduce((total, hit) => total + hit.crit * hit.count, 0),
    avg: subHits.reduce((total, hit) => total + hit.avg * hit.count, 0),
    subHits,
  }
}

// compute healing and shielding style support effects
function computeSupport(finalStats: FinalStats, skill: SkillDefinition): DamageResult {
  const baseEffect = computeBaseAbility(finalStats, skill)

  const bonusPercent = skill.archetype === 'healing'
      ? finalStats.healingBonus + (skill.skillHealingBonus ?? 0)
      : finalStats.shieldBonus + (skill.skillShieldBonus ?? 0)

  const total = ((baseEffect * skill.multiplier) + skill.flat) * (1 + bonusPercent / 100)
  const value = Math.max(1, Math.floor(total))

  return {
    normal: 0,
    crit: 0,
    avg: value,
    subHits: [],
  }
}

// compute tune rupture damage using its special formula path
function computeTuneRupture(
    finalStats: FinalStats,
    skill: SkillDefinition,
    enemy: EnemyProfile,
    level: number,
): DamageResult {
  const element = skill.element
  const baseRes = resolveEnemyResistance(enemy, element)

  // hard immunity check
  if (baseRes === 100) {
    return makeZeroResult(skill)
  }

  const attributeAll = finalStats.attribute.all
  const attributeElement = finalStats.attribute[element]
  const skillTypeAll = finalStats.skillType.all
  const skillTypeBuff = aggregateSkillTypeBuffs(finalStats.skillType, skill.skillType)
  const skillBuffs = buildSkillBuffs(skill)

  // shred and ignore values that feed the tune rupture formula
  const resShred =
      attributeAll.resShred +
      attributeElement.resShred +
      skillTypeAll.resShred +
      skillTypeBuff.resShred +
      skillBuffs.resShred

  const defIgnore =
      finalStats.defIgnore +
      attributeAll.defIgnore +
      attributeElement.defIgnore +
      skillTypeAll.defIgnore +
      skillTypeBuff.defIgnore +
      skillBuffs.defIgnore

  const defShred =
      finalStats.defShred +
      attributeAll.defShred +
      attributeElement.defShred +
      skillTypeAll.defShred +
      skillTypeBuff.defShred +
      skillBuffs.defShred

  const dmgVuln =
      finalStats.dmgVuln +
      attributeAll.dmgVuln +
      attributeElement.dmgVuln +
      skillTypeAll.dmgVuln +
      skillTypeBuff.dmgVuln +
      skillBuffs.dmgVuln

  const enemyResValue = baseRes - resShred
  const resMult = resistanceMultiplier(enemyResValue)

  const enemyDefense = ((8 * enemy.level) + 792) * (1 - (defIgnore + defShred) / 100)

  const defenseMultiplier = (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))

  // class multiplier depends on enemy class
  let classMultiplier = 1
  if (enemy.class === 3 || enemy.class === 4) classMultiplier = 14
  else if (enemy.class === 2) classMultiplier = 3

  const tuneSkillType = finalStats.skillType.tuneRupture

  const bonusMultiplier =
      (1 + finalStats.amplify / 100) *
      (1 + tuneSkillType.dmgBonus / 100) *
      (1 + finalStats.tuneBreakBoost / 100)

  const hits = resolveDamageHits(skill, skill.tuneRuptureScale ?? 16)
  const tuneRuptureLevelScale = getTuneRuptureLevelScale(level)

  const perHitMultiplier =
      resMult *
      defenseMultiplier *
      (1 + dmgVuln / 100) *
      classMultiplier *
      bonusMultiplier

  const critMultiplier = skill.tuneRuptureCritDmg ?? 1
  const critRate = skill.tuneRuptureCritRate ?? 0

  const subHits = hits.map((hit) => {
    const normal = hit.multiplier * tuneRuptureLevelScale * perHitMultiplier
    const crit = normal * critMultiplier
    const avg = critRate >= 1 ? crit : (crit * critRate) + (normal * (1 - critRate))

    return {
      ...hit,
      normal,
      crit,
      avg,
    }
  })

  return {
    normal: subHits.reduce((total, hit) => total + hit.normal * hit.count, 0),
    crit: subHits.reduce((total, hit) => total + hit.crit * hit.count, 0),
    avg: subHits.reduce((total, hit) => total + hit.avg * hit.count, 0),
    subHits,
  }
}

// compute negative-effect archetype damage such as frazzle, erosion, burst and flare
function computeNegativeEffectDamage(
    skill: SkillDefinition,
    finalStats: FinalStats,
    enemy: EnemyProfile,
    level: number,
    stacks: number,
    archetype: Extract<SkillDefinition['archetype'], 'spectroFrazzle' | 'aeroErosion' | 'fusionBurst' | 'glacioChafe' | 'electroFlare'>,
    additionalStacks = 0,
): DamageResult {
  // no stacks means no damage instance
  if (stacks <= 0 && additionalStacks <= 0) {
    return makeZeroResult(skill)
  }

  const archetypeToElementMap: {
    spectroFrazzle: AttributeKey;
    aeroErosion: AttributeKey;
    glacioChafe: AttributeKey;
    electroFlare: AttributeKey;
    fusionBurst: AttributeKey
  } = {
    spectroFrazzle: 'spectro',
    aeroErosion: 'aero',
    glacioChafe: 'glacio',
    electroFlare: 'electro',
    fusionBurst: 'fusion',
  }

  const element = archetypeToElementMap[archetype]

  const baseRes = isUnsetEnemyProfile(enemy) ? 0 : resolveEnemyResistance(enemy, element)

  // hard immunity check
  if (baseRes === 100) {
    return makeZeroResult(skill)
  }

  const attributeAll = finalStats.attribute.all
  const attributeElement = finalStats.attribute[element]
  const effectTypes: SkillTypeKey[] = skill.skillType
  const aggregatedEffectType = aggregateSkillTypeBuffs(finalStats.skillType, effectTypes)
  const negativeEffectBuff = finalStats.negativeEffect[archetype as NegativeEffectKey]

  const resShred =
      attributeAll.resShred +
      attributeElement.resShred +
      aggregatedEffectType.resShred

  const defIgnore =
      finalStats.defIgnore +
      attributeAll.defIgnore +
      attributeElement.defIgnore +
      aggregatedEffectType.defIgnore

  const defShred =
      finalStats.defShred +
      attributeAll.defShred +
      attributeElement.defShred +
      aggregatedEffectType.defShred

  const dmgVuln =
      finalStats.dmgVuln +
      attributeAll.dmgVuln +
      attributeElement.dmgVuln +
      aggregatedEffectType.dmgVuln

  const enemyResValue = isUnsetEnemyProfile(enemy) ? 0 : baseRes - resShred
  const resMult = isUnsetEnemyProfile(enemy) ? 1 : resistanceMultiplier(enemyResValue)

  const enemyDefense = isUnsetEnemyProfile(enemy)
      ? 0
      : ((8 * enemy.level) + 792) * (1 - (defIgnore + defShred) / 100)

  const defenseMultiplier = isUnsetEnemyProfile(enemy)
      ? 1
      : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))

  // base per-stack damage is provided by the negative-effect formula helper
  const perStackBase =
      getNegativeEffectBase(archetype, level, stacks) +
      (archetype === 'electroFlare' ? getNegativeEffectBase(archetype, level, additionalStacks) : 0)

  const hits = resolveDamageHits(skill, 1)
  const totalHitScale = sumHitScale(hits)

  const bonusMultiplier =
      (1 + finalStats.amplify / 100) *
      (1 + aggregatedEffectType.amplify / 100) *
      (1 + aggregatedEffectType.dmgBonus / 100) *
      (1 + finalStats.special / 100)

  const damage = Math.floor(
      (
          perStackBase *
          (1 + negativeEffectBuff.multiplier)
      ) *
      totalHitScale *
      bonusMultiplier *
      resMult *
      defenseMultiplier *
      (1 + dmgVuln / 100),
  )

  const critRate = (skill.negativeEffectCritRate ?? 0) + (negativeEffectBuff.critRate / 100)
  const critMultiplier = (skill.negativeEffectCritDmg ?? 1) + (negativeEffectBuff.critDmg / 100)

  const subHits = hits.map((hit) => {
    const normal = totalHitScale > 0 ? (damage * hit.multiplier) / totalHitScale : 0
    const crit = normal * critMultiplier
    const avg = critRate >= 1 ? crit : (crit * critRate) + (normal * (1 - critRate))

    return {
      ...hit,
      normal,
      crit,
      avg,
    }
  })

  return {
    normal: subHits.reduce((total, hit) => total + hit.normal * hit.count, 0),
    crit: subHits.reduce((total, hit) => total + hit.crit * hit.count, 0),
    avg: subHits.reduce((total, hit) => total + hit.avg * hit.count, 0),
    subHits,
  }
}

// route a skill to the correct computation path based on archetype
export function computeSkillDamage(
    finalStats: FinalStats,
    skill: SkillDefinition,
    enemy: EnemyProfile,
    level: number,
    combatState?: {
      spectroFrazzle?: number
      aeroErosion?: number
      fusionBurst?: number
      glacioChafe?: number
      electroFlare?: number
      electroRage?: number
    },
): DamageResult {
  switch (skill.archetype) {
    case 'healing':
    case 'shield':
      return computeSupport(finalStats, skill)

    case 'tuneRupture':
      return computeTuneRupture(finalStats, skill, enemy, level)

    case 'spectroFrazzle':
      return computeNegativeEffectDamage(
          skill,
          finalStats,
          enemy,
          level,
          combatState?.spectroFrazzle ?? 0,
          'spectroFrazzle',
      )

    case 'aeroErosion':
      return computeNegativeEffectDamage(
          skill,
          finalStats,
          enemy,
          level,
          combatState?.aeroErosion ?? 0,
          'aeroErosion',
      )

    case 'fusionBurst':
      return computeNegativeEffectDamage(
          skill,
          finalStats,
          enemy,
          level,
          combatState?.fusionBurst ?? 0,
          'fusionBurst',
      )

    case 'glacioChafe':
      return computeNegativeEffectDamage(
          skill,
          finalStats,
          enemy,
          level,
          combatState?.glacioChafe ?? 0,
          'glacioChafe',
      )

    case 'electroFlare':
      return computeNegativeEffectDamage(
          skill,
          finalStats,
          enemy,
          level,
          combatState?.electroFlare ?? 0,
          'electroFlare',
          (combatState?.electroFlare ?? 0) > getNegativeEffectDefaultMax('electroFlare')
            ? (combatState?.electroRage ?? 0)
            : 0,
      )

    case 'skillDamage':
    default:
      return computeDirectDamage(finalStats, skill, enemy, level)
  }
}
