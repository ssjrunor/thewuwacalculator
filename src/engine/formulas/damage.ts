/*
  Author: Runor Ewhro
  Description: Computes final skill results for direct damage, support,
               tune rupture, and negative-effect archetypes by combining
               final stats, enemy data, and skill metadata.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import { ATTR_ENEMY_RES, isNoEnemy } from '@/domain/entities/appState'
import type {
  DamageResult,
  FinalStats,
  ModBuff,
  NegEffectKey,
  SkillDef,
  SkillTypeKey,
} from '@/domain/entities/stats'
import { getNegEffectDef, NEG_EFFECT_ELEM } from '@/domain/gameData/negativeEffects'
import { getNegBase } from '@/engine/formulas/negativeEffects'
import { getTuneLevel } from '@/engine/formulas/tuneRupture'
import { isSkillImmune } from '@/engine/formulas/immunity'
import { mergeSkillType, makeModBuff } from '@/engine/resolvers/buffPool'

export interface DirectSkillCtx {
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
  defMult: number
  dmgVulnMult: number
  dmgBonusMult: number
  ampMult: number
  specMult: number
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

export interface CalcSkillDamageOptions {
  includeSubHits?: boolean
}

interface HitSummary {
  hitScale: number
  hitCount: number
}

// convert an enemy resistance percentage into the game damage multiplier
function resistMult(enemyResPct: number): number {
  if (enemyResPct < 0) return 1 - enemyResPct / 200
  if (enemyResPct < 75) return 1 - enemyResPct / 100
  return 1 / (1 + 5 * (enemyResPct / 100))
}

// defense shred and defense ignore reduce enemy defense as separate factors
function defenseReduction(defIgnore: number, defShred: number): number {
  return (1 - defShred / 100) * (1 - defIgnore / 100)
}

// resolve the enemy resistance bucket for the skill's element
function getEnemyRes(enemy: EnemyProfile, element: SkillDef['element']): number {
  if (isNoEnemy(enemy)) {
    return 0
  }

  return enemy.res[ATTR_ENEMY_RES[element]]
}

// normalize optional per-skill buffs into a complete modifier object
function makeSkillBuffs(skill: SkillDef): ModBuff {
  return {
    ...makeModBuff(),
    ...(skill.skillBuffs ?? {}),
  }
}

// compute the raw stat-scaled base amount for a skill before multipliers
function calcBasePower(finalStats: FinalStats, skill: SkillDef): number {
  return (
      finalStats.atk.final * skill.scaling.atk +
      finalStats.hp.final * skill.scaling.hp +
      finalStats.def.final * skill.scaling.def +
      finalStats.energyRegen * skill.scaling.energyRegen
  )
}

// compute all shared damage terms used by direct damage formulas
function calcDamageCtx(
    finalStats: FinalStats,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
) {
  // aggregate generic and skill-specific buff buckets
  const skillTypeAll = finalStats.skillType.all
  const skillTypeBuff = mergeSkillType(finalStats.skillType, skill.skillType)
  const attributeAll = finalStats.attribute.all
  const attrElement = finalStats.attribute[skill.element]
  const skillBuffs = makeSkillBuffs(skill)

  // special-case unset enemies and hard immunity
  const ignoresEnemy = isNoEnemy(enemy)
  const baseRes = ignoresEnemy ? 0 : getEnemyRes(enemy, skill.element)
  const zeroed = !ignoresEnemy && baseRes === 100

  // final enemy resistance after all shred sources
  const enemyResVl = ignoresEnemy
      ? 0
      : baseRes
      - attributeAll.resShred
      - attrElement.resShred
      - skillTypeAll.resShred
      - skillTypeBuff.resShred
      - skillBuffs.resShred

  const resMult = zeroed ? 0 : (ignoresEnemy ? 1 : resistMult(enemyResVl))

  // total defense ignore and shred applied to enemy defense
  const totalDefIgnore =
      finalStats.defIgnore +
      attributeAll.defIgnore +
      attrElement.defIgnore +
      skillTypeAll.defIgnore +
      skillTypeBuff.defIgnore +
      skillBuffs.defIgnore

  const totalDefShred =
      finalStats.defShred +
      attributeAll.defShred +
      attrElement.defShred +
      skillTypeAll.defShred +
      skillTypeBuff.defShred +
      skillBuffs.defShred

  const enemyDefense = ignoresEnemy
      ? 0
      : ((8 * enemy.level) + 792) * defenseReduction(totalDefIgnore, totalDefShred)

  const defenseMult = ignoresEnemy
      ? 1
      : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))

  // total outgoing bonus layers
  const damageBonusPct =
      finalStats.dmgBonus +
      attributeAll.dmgBonus +
      attrElement.dmgBonus +
      skillTypeAll.dmgBonus +
      skillTypeBuff.dmgBonus +
      skillBuffs.dmgBonus

  const amplifyPct =
      finalStats.amplify +
      attributeAll.amplify +
      attrElement.amplify +
      skillTypeAll.amplify +
      skillTypeBuff.amplify +
      skillBuffs.amplify

  const dmgVulnPct =
      attributeAll.dmgVuln +
      attrElement.dmgVuln +
      skillTypeAll.dmgVuln +
      skillTypeBuff.dmgVuln +
      skillBuffs.dmgVuln +
      finalStats.dmgVuln

  const dmgBnsMltp = 1 + damageBonusPct / 100
  const amplifyMult = 1 + amplifyPct / 100
  const dmgVulnMltp = 1 + dmgVulnPct / 100
  const specialMult = 1 + finalStats.special / 100

  // crit values are stored as percents in final stats, so convert to ratios
  const critRate =
      (finalStats.critRate
          + attributeAll.critRate
          + attrElement.critRate
          + skillTypeAll.critRate
          + skillTypeBuff.critRate
          + skillBuffs.critRate) / 100

  const critDmg =
      (finalStats.critDmg
          + attributeAll.critDmg
          + attrElement.critDmg
          + skillTypeAll.critDmg
          + skillTypeBuff.critDmg
          + skillBuffs.critDmg) / 100

  void level

  return {
    zeroed,
    skillTypeAll,
    skillTypeBuff: skillTypeBuff,
    attributeAll,
    attributeElement: attrElement,
    skillBuffs,
    resMult,
    defenseMultiplier: defenseMult,
    damageBonusMultiplier: dmgBnsMltp,
    amplifyMultiplier: amplifyMult,
    dmgVulnMultiplier: dmgVulnMltp,
    specialMultiplier: specialMult,
    critRate,
    critDmg,
  }
}

// build a zeroed result while preserving the skill hit structure
function shldInclSubHits(options?: CalcSkillDamageOptions): boolean {
  return options?.includeSubHits !== false
}

function makeZeroResult(skill: SkillDef, options?: CalcSkillDamageOptions): DamageResult {
  return {
    normal: 0,
    crit: 0,
    avg: 0,
    subHits: shldInclSubHits(options)
      ? skill.hits.map((hit) => ({
        ...hit,
        normal: 0,
        crit: 0,
        avg: 0,
      }))
      : [],
  }
}

// resolve the effective hit list for a skill
// if the skill has no explicit hit breakdown, synthesize one from fallback multiplier
function resolveHits(skill: SkillDef, fallbackMult = 0): SkillDef['hits'] {
  if (skill.hits.length > 0) {
    return skill.hits
  }

  if (fallbackMult <= 0) {
    return []
  }

  return [{ count: 1, multiplier: fallbackMult }]
}

// sum total hit scaling, taking hit count into account
function sumHitScale(hits: SkillDef['hits']): number {
  return hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
}

function summarizeHits(hits: SkillDef['hits']): HitSummary {
  let hitScale = 0
  let hitCount = 0

  for (const hit of hits) {
    hitScale += hit.multiplier * hit.count
    hitCount += hit.count
  }

  return {
    hitScale,
    hitCount,
  }
}

function makeDmgResult(
    hits: SkillDef['hits'],
    buildValues: (hit: SkillDef['hits'][number]) => {
      normal: number
      crit: number
      avg: number
    },
    options?: CalcSkillDamageOptions,
): DamageResult {
  const subHits: DamageResult['subHits'] = []
  const includeSubHits = shldInclSubHits(options)
  let normal = 0
  let crit = 0
  let avg = 0

  for (const hit of hits) {
    const values = buildValues(hit)
    if (includeSubHits) {
      subHits.push({
        ...hit,
        normal: values.normal,
        crit: values.crit,
        avg: values.avg,
      })
    }

    normal += values.normal * hit.count
    crit += values.crit * hit.count
    avg += values.avg * hit.count
  }

  return {
    normal,
    crit,
    avg,
    subHits,
  }
}

function makeDirectSkill(
    finalStats: FinalStats,
    skill: SkillDef,
    shared: ReturnType<typeof calcDamageCtx>,
): DirectSkillCtx {
  const hits = resolveHits(skill, skill.multiplier)
  const hitSummary = summarizeHits(hits)

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
    defMult: shared.defenseMultiplier,
    dmgVulnMult: shared.dmgVulnMultiplier,
    dmgBonusMult: shared.damageBonusMultiplier,
    ampMult: shared.amplifyMultiplier,
    specMult: shared.specialMultiplier,
    scalingAtk: skill.scaling.atk,
    scalingHp: skill.scaling.hp,
    scalingDef: skill.scaling.def,
    scalingER: skill.scaling.energyRegen,
    multiplier: skill.multiplier,
    hitScale: hits.length > 0 ? hitSummary.hitScale : skill.multiplier,
    hitCount: hits.length > 0 ? hitSummary.hitCount : 1,
    flatDmg: finalStats.flatDmg + skill.flat,
    fixedDmg: skill.fixedDmg ?? 0,
  }
}

// expose a detailed direct-damage calculation context for debugging or inspection
export function makeSkillDamage(
    finalStats: FinalStats,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
): DirectSkillCtx {
  const shared = calcDamageCtx(finalStats, skill, enemy, level)
  return makeDirectSkill(finalStats, skill, shared)
}

// compute standard direct damage skills
function calcDirectDmg(
    finalStats: FinalStats,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
    options?: CalcSkillDamageOptions,
): DamageResult {
  // fixed damage bypasses the normal scaling formula
  if ((skill.fixedDmg ?? 0) > 0) {
    const value = Math.max(1, Math.floor(skill.fixedDmg ?? 0))
    const hits = resolveHits(skill, 1)
    const ttlHitScl = sumHitScale(hits)

    return makeDmgResult(hits, (hit) => {
      const normal = ttlHitScl > 0 ? (value * hit.multiplier) / ttlHitScl : value
      return {
        normal,
        crit: normal,
        avg: normal,
      }
    }, options)
  }

  const shared = calcDamageCtx(finalStats, skill, enemy, level)
  const direct = makeDirectSkill(finalStats, skill, shared)

  // full elemental immunity produces zero damage
  if (shared.zeroed) {
    return makeZeroResult(skill, options)
  }

  const baseAbility = calcBasePower(finalStats, skill)

  // final multiplier stack applied to every hit
  const dmgMltp =
      direct.resMult *
      direct.defMult *
      direct.dmgVulnMult *
      direct.dmgBonusMult *
      direct.ampMult *
      direct.specMult

  return makeDmgResult(skill.hits, (hit) => {
    const normal = (baseAbility * hit.multiplier + direct.flatDmg) * dmgMltp
    const crit = normal * (direct.critDmg / 100)
    const critRate = direct.critRate / 100
    const avg = critRate >= 1 ? crit : crit * critRate + normal * (1 - critRate)

    return {
      normal,
      crit,
      avg,
    }
  }, options)
}

// compute healing and shielding style support effects
function calcSupport(finalStats: FinalStats, skill: SkillDef): DamageResult {
  const baseEffect = calcBasePower(finalStats, skill)

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

// compute tune rupture and hack damage using their level-scaled formula path
function calcLevelDamage(
    finalStats: FinalStats,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
    kind: 'tuneRupture' | 'hack',
    options?: CalcSkillDamageOptions,
): DamageResult {
  const element = skill.element
  const baseRes = getEnemyRes(enemy, element)

  // hard immunity check
  if (baseRes === 100) {
    return makeZeroResult(skill, options)
  }

  const attributeAll = finalStats.attribute.all
  const attrElement = finalStats.attribute[element]
  const skillTypeAll = finalStats.skillType.all
  const skillTypeBuff = mergeSkillType(finalStats.skillType, skill.skillType)
  const skillBuffs = makeSkillBuffs(skill)

  // shred and ignore values that feed the tune rupture formula
  const resShred =
      attributeAll.resShred +
      attrElement.resShred +
      skillTypeAll.resShred +
      skillTypeBuff.resShred +
      skillBuffs.resShred

  const defIgnore =
      skillTypeBuff.defIgnore +
      skillBuffs.defIgnore

  const defShred =
      finalStats.defShred +
      attributeAll.defShred +
      attrElement.defShred +
      skillTypeAll.defShred +
      skillTypeBuff.defShred +
      skillBuffs.defShred

  const dmgVuln =
      finalStats.dmgVuln +
      attributeAll.dmgVuln +
      attrElement.dmgVuln +
      skillTypeAll.dmgVuln +
      skillTypeBuff.dmgVuln +
      skillBuffs.dmgVuln

  const enemyResVl = baseRes - resShred
  const resMult = resistMult(enemyResVl)

  const enemyDefense = ((8 * enemy.level) + 792) * defenseReduction(defIgnore, defShred)

  const defenseMult = (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))

  // class multiplier depends on enemy class
  let classMult = 1
  if (enemy.class === 3 || enemy.class === 4) classMult = 14
  else if (enemy.class === 2) classMult = 3

  const formulaSkillType = finalStats.skillType[kind]

  const bnsMltp =
      (1 + finalStats.amplify / 100) *
      (1 + formulaSkillType.dmgBonus / 100) *
      (1 + finalStats.tbb / 100)

  const hits = resolveHits(skill, skill.tuneRuptureScale ?? 16)
  const lvlScale = getTuneLevel(level)

  const perHitMltp =
      resMult *
      defenseMult *
      (1 + dmgVuln / 100) *
      classMult *
      bnsMltp

  const critMltp = kind === 'tuneRupture' ? (skill.tuneRuptureCritDmg ?? 1) : 1
  const critRate = kind === 'tuneRupture' ? (skill.tuneRuptureCritRate ?? 0) : 0

  return makeDmgResult(hits, (hit) => {
    const normal = hit.multiplier * lvlScale * perHitMltp
    const crit = normal * critMltp
    const avg = critRate >= 1 ? crit : (crit * critRate) + (normal * (1 - critRate))

    return {
      normal,
      crit,
      avg,
    }
  }, options)
}

// compute negative-effect archetype damage such as frazzle, erosion, burst and flare
function calcNegEffect(
    skill: SkillDef,
    finalStats: FinalStats,
    enemy: EnemyProfile,
    level: number,
    stacks: number,
    archetype: Extract<SkillDef['archetype'], 'spectroFrazzle' | 'aeroErosion' | 'fusionBurst' | 'glacioChafe' | 'electroFlare'>,
    ddtnStck = 0,
    options?: CalcSkillDamageOptions,
): DamageResult {
  const stackCount = skill.stackMode === 'fixedMax'
      ? skill.stackMax ?? getNegEffectDef(archetype)
      : stacks
  // no stacks means no damage instance
  if (stackCount <= 0 && ddtnStck <= 0) {
    return makeZeroResult(skill, options)
  }

  const element = NEG_EFFECT_ELEM[archetype]

  const baseRes = isNoEnemy(enemy) ? 0 : getEnemyRes(enemy, element)

  // hard immunity check
  if (baseRes === 100) {
    return makeZeroResult(skill, options)
  }

  const attributeAll = finalStats.attribute.all
  const attrElement = finalStats.attribute[element]
  const effectTypes: SkillTypeKey[] = skill.skillType
  const ggrgFfctType = mergeSkillType(finalStats.skillType, effectTypes)
  const negFfctBuff = finalStats.negativeEffect[archetype as NegEffectKey]
  const skillBuffs = makeSkillBuffs(skill)

  const resShred =
      attributeAll.resShred +
      attrElement.resShred +
      ggrgFfctType.resShred

  const defIgnore =
      ggrgFfctType.defIgnore +
      skillBuffs.defIgnore

  const defShred =
      finalStats.defShred +
      attributeAll.defShred +
      attrElement.defShred +
      ggrgFfctType.defShred

  const dmgVuln =
      finalStats.dmgVuln +
      attributeAll.dmgVuln +
      attrElement.dmgVuln +
      ggrgFfctType.dmgVuln

  const enemyResVl = isNoEnemy(enemy) ? 0 : baseRes - resShred
  const resMult = isNoEnemy(enemy) ? 1 : resistMult(enemyResVl)

  const enemyDefense = isNoEnemy(enemy)
      ? 0
      : ((8 * enemy.level) + 792) * defenseReduction(defIgnore, defShred)

  const defenseMult = isNoEnemy(enemy)
      ? 1
      : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))

  // base per-stack damage is provided by the negative-effect formula helper
  const perStackBase =
      getNegBase(archetype, level, stackCount, { fixedMv: skill.fixedMv }) +
      (archetype === 'electroFlare' ? getNegBase(archetype, level, ddtnStck, { fixedMv: skill.fixedMv }) : 0)

  const hits = resolveHits(skill, 1)
  const ttlHitScl = sumHitScale(hits)

  const bnsMltp =
      (1 + finalStats.amplify / 100) *
      (1 + ggrgFfctType.amplify / 100) *
      (1 + ggrgFfctType.dmgBonus / 100) *
      (1 + finalStats.special / 100)

  const damage = Math.floor(
    perStackBase *
    ttlHitScl *
    bnsMltp *
    resMult *
    defenseMult * (1 + negFfctBuff.multiplier) *
    (1 + dmgVuln / 100),
  )

  const critRate = (skill.negativeEffectCritRate ?? 0) + (negFfctBuff.critRate / 100)
  const critMltp = (skill.negativeEffectCritDmg ?? 1) + (negFfctBuff.critDmg / 100)

  return makeDmgResult(hits, (hit) => {
    const normal = ttlHitScl > 0 ? (damage * hit.multiplier) / ttlHitScl : 0
    const crit = normal * critMltp
    const avg = critRate >= 1 ? crit : (crit * critRate) + (normal * (1 - critRate))

    return {
      normal,
      crit,
      avg,
    }
  }, options)
}

// route a skill to the correct computation path based on archetype
export function calcSkillDamage(
    finalStats: FinalStats,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
    combatState?: {
      spectroFrazzle?: number
      spctFrzz?: number
      aeroErosion?: number
      fusionBurst?: number
      glacioChafe?: number
      electroFlare?: number
      electroRage?: number
    },
    options?: CalcSkillDamageOptions,
): DamageResult {
  // healing/shield never target the enemy; every other archetype is zeroed when the enemy is immune
  if (
      skill.archetype !== 'healing'
      && skill.archetype !== 'shield'
      && isSkillImmune(finalStats.immunities, skill)
  ) {
    return makeZeroResult(skill, options)
  }

  switch (skill.archetype) {
    case 'healing':
    case 'shield':
      return calcSupport(finalStats, skill)

    case 'tuneRupture':
      return calcLevelDamage(finalStats, skill, enemy, level, 'tuneRupture', options)

    case 'hack':
      return calcLevelDamage(finalStats, skill, enemy, level, 'hack', options)

    case 'spectroFrazzle':
      return calcNegEffect(
          skill,
          finalStats,
          enemy,
          level,
          combatState?.spectroFrazzle ?? combatState?.spctFrzz ?? 0,
          'spectroFrazzle',
          0,
          options,
      )

    case 'aeroErosion':
      return calcNegEffect(
          skill,
          finalStats,
          enemy,
          level,
          combatState?.aeroErosion ?? 0,
          'aeroErosion',
          0,
          options,
      )

    case 'fusionBurst':
      return calcNegEffect(
          skill,
          finalStats,
          enemy,
          level,
          combatState?.fusionBurst ?? 0,
          'fusionBurst',
          0,
          options,
      )

    case 'glacioChafe':
      return calcNegEffect(
          skill,
          finalStats,
          enemy,
          level,
          combatState?.glacioChafe ?? 0,
          'glacioChafe',
          0,
          options,
      )

    case 'electroFlare':
      return calcNegEffect(
          skill,
          finalStats,
          enemy,
          level,
          combatState?.electroFlare ?? 0,
          'electroFlare',
          (combatState?.electroFlare ?? 0) > getNegEffectDef('electroFlare')
            ? (combatState?.electroRage ?? 0)
            : 0,
          options,
      )

    case 'skillDamage':
    default:
      return calcDirectDmg(finalStats, skill, enemy, level, options)
  }
}
