/*
  Author: Runor Ewhro
  Description: builds the packed optimizer-facing combat context for a
               selected skill by converting final stat state, enemy data,
               and archetype-specific rules into numeric fields used by
               the optimizer backend.
*/

import type { EnemyProfile } from '@/domain/entities/appState.ts'
import { ATTR_ENEMY_RES, isNoEnemy } from '@/domain/entities/appState.ts'
import type {
  FinalStats,
  ModBuff,
  NegEffectKey,
  SkillArch,
  SkillDef,
  SkillTypeKey,
} from '@/domain/entities/stats.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { CompTargetSkill } from '@/engine/optimizer/types.ts'
import {
  ARCH_AERO,
  ARCH_DAMAGE,
  ARCH_ELECTRO,
  ARCH_FUSION,
  ARCH_GLACIO,
  ARCH_HACK,
  ARCH_HEAL,
  ARCH_SHIELD,
  ARCH_SPECTRO,
  ARCH_TUNE,
} from '@/engine/optimizer/config/constants.ts'
import { makeSkillDamage } from '@/engine/formulas/damage.ts'
import { isSkillImmune } from '@/engine/formulas/immunity.ts'
import { mergeSkillType, makeModBuff } from '@/engine/resolvers/buffPool.ts'
import { getNegEffectDef } from '@/domain/gameData/negativeEffects.ts'

// convert enemy resistance percent into the actual damage multiplier
function resistMult(enemyResPct: number): number {
  if (enemyResPct < 0) return 1 - enemyResPct / 200
  if (enemyResPct < 75) return 1 - enemyResPct / 100
  return 1 / (1 + 5 * (enemyResPct / 100))
}

// compute the defense multiplier after def ignore and def shred are applied
function defenseMult(
    charLvl: number,
    enemyLevel: number,
    defIgnore: number,
    defShred: number,
): number {
  const enemyDefense = ((8 * enemyLevel) + 792) * (1 - (defIgnore + defShred) / 100)
  return (800 + 8 * charLvl) / (800 + 8 * charLvl + Math.max(0, enemyDefense))
}

// resolve a usable hit scale/count pair for optimizer math
// this falls back to a single-hit representation when the skill has no hit list
function getSkillHits(
    skill: SkillDef,
    fallbackMult: number,
): { hitScale: number; hitCount: number } {
  if (skill.hits.length > 0) {
    return {
      hitScale: skill.hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0),
      hitCount: skill.hits.reduce((total, hit) => total + hit.count, 0),
    }
  }

  if (fallbackMult <= 0) {
    return { hitScale: 0, hitCount: 0 }
  }

  return {
    hitScale: fallbackMult,
    hitCount: 1,
  }
}

// normalize optional skill-local buffs into a complete mod-buff object
function makeSkillBuffs(skill: SkillDef): ModBuff {
  return {
    ...makeModBuff(),
    ...(skill.skillBuffs ?? {}),
  }
}

// map high-level skill archetypes into compact numeric ids used by the optimizer
export function mapSkillArch(archetype: SkillArch): number {
  switch (archetype) {
    case 'healing':
      return ARCH_HEAL
    case 'shield':
      return ARCH_SHIELD
    case 'tuneRupture':
      return ARCH_TUNE
    case 'hack':
      return ARCH_HACK
    case 'spectroFrazzle':
      return ARCH_SPECTRO
    case 'aeroErosion':
      return ARCH_AERO
    case 'electroFlare':
      return ARCH_ELECTRO
    case 'glacioChafe':
      return ARCH_GLACIO
    case 'fusionBurst':
      return ARCH_FUSION
    case 'skillDamage':
    default:
      return ARCH_DAMAGE
  }
}

// read the enemy's base resistance for the skill element
function getEnemyRes(
    enemy: EnemyProfile,
    element: SkillDef['element'],
): number {
  if (isNoEnemy(enemy)) {
    return 0
  }

  return enemy.res[ATTR_ENEMY_RES[element]]
}

// build the special multiplier buckets used by level-scaled special damage skills
function makeLevelScale(options: {
  finalStats: FinalStats
  skill: SkillDef
  enemy: EnemyProfile
  level: number
  kind: 'tuneRupture' | 'hack'
}) {
  const { finalStats, skill, enemy, level, kind } = options
  const ignoresEnemy = isNoEnemy(enemy)
  const element = skill.element
  const baseRes = ignoresEnemy ? 0 : getEnemyRes(enemy, element)
  const attributeAll = finalStats.attribute.all
  const attrElement = finalStats.attribute[element]
  const skillTypeAll = finalStats.skillType.all
  const skillTypeBuff = mergeSkillType(finalStats.skillType, skill.skillType)
  const skillBuffs = makeSkillBuffs(skill)

  const resShred =
      attributeAll.resShred +
      attrElement.resShred +
      skillTypeAll.resShred +
      skillTypeBuff.resShred +
      skillBuffs.resShred

  const defIgnore =
      finalStats.defIgnore +
      attributeAll.defIgnore +
      attrElement.defIgnore +
      skillTypeAll.defIgnore +
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

  const enemyResVl = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = (!ignoresEnemy && baseRes === 100)
      ? 0
      : (ignoresEnemy ? 1 : resistMult(enemyResVl))

  const defMult = ignoresEnemy
      ? 1
      : defenseMult(level, enemy.level, defIgnore, defShred)

  return {
    resMult,
    defMult,
    dmgVuln,
    dmgBonus: finalStats.skillType[kind].dmgBonus,
    amplify: finalStats.amplify,
    tuneBreakBoost: finalStats.tbb,
    critRate: (skill.tuneRuptureCritRate ?? 0) * 100,
    critDmg: (skill.tuneRuptureCritDmg ?? 1) * 100,
  }
}

// build the special multiplier buckets used by negative-effect archetypes
function makeNegBase(options: {
  finalStats: FinalStats
  skill: SkillDef
  enemy: EnemyProfile
  level: number
  archetype: Extract<SkillDef['archetype'], 'spectroFrazzle' | 'aeroErosion' | 'fusionBurst' | 'glacioChafe' | 'electroFlare'>
}) {
  const { finalStats, skill, enemy, level, archetype } = options
  const ignoresEnemy = isNoEnemy(enemy)

  const element = archetype === 'spectroFrazzle'
      ? 'spectro'
      : archetype === 'aeroErosion'
          ? 'aero'
          : archetype === 'fusionBurst'
              ? 'fusion'
              : archetype === 'glacioChafe'
                  ? 'glacio'
              : 'electro'

  const baseRes = ignoresEnemy ? 0 : getEnemyRes(enemy, element)
  const attributeAll = finalStats.attribute.all
  const attrElement = finalStats.attribute[element]
  const ggrgFfctType = mergeSkillType(finalStats.skillType, skill.skillType as SkillTypeKey[])
  const negFfctBuff = finalStats.negativeEffect[archetype as NegEffectKey]

  const resShred =
      attributeAll.resShred +
      attrElement.resShred +
      ggrgFfctType.resShred

  const defIgnore =
      finalStats.defIgnore +
      attributeAll.defIgnore +
      attrElement.defIgnore +
      ggrgFfctType.defIgnore

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

  const enemyResVl = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = (!ignoresEnemy && baseRes === 100)
      ? 0
      : (ignoresEnemy ? 1 : resistMult(enemyResVl))

  const defMult = ignoresEnemy
      ? 1
      : defenseMult(level, enemy.level, defIgnore, defShred)

  const amplifyMult =
      (1 + finalStats.amplify / 100) *
      (1 + ggrgFfctType.amplify / 100)

  return {
    resMult,
    defMult,
    dmgVuln,
    dmgBonus: ggrgFfctType.dmgBonus,
    amplify: (amplifyMult - 1) * 100,
    special: finalStats.special,
    multiplier: negFfctBuff.multiplier,
    critRate: ((skill.negativeEffectCritRate ?? 0) * 100) + negFfctBuff.critRate,
    critDmg: ((skill.negativeEffectCritDmg ?? 1) * 100) + negFfctBuff.critDmg,
  }
}

// build the final compiled context consumed by packed optimizer evaluation
export function makeOptContext(options: {
  resonatorId: string
  runtime: ResRuntime
  skill: SkillDef
  finalStats: FinalStats
  enemy: EnemyProfile
  combatState?: {
    spectroFrazzle?: number
    spctFrzz?: number
    aeroErosion?: number
    fusionBurst?: number
    glacioChafe?: number
    electroFlare?: number
    electroRage?: number
  }
}): CompTargetSkill {
  const { resonatorId, runtime, skill, finalStats, enemy, combatState } = options

  // start from the standard direct-damage context so common values are shared
  const direct = makeSkillDamage(
      finalStats,
      skill,
      enemy,
      runtime.base.level,
  )

  const enemyBaseRes = getEnemyRes(enemy, skill.element)

  // different archetypes need different hit-scale fallback logic
  const hitInfo = skill.archetype === 'tuneRupture' || skill.archetype === 'hack'
      ? getSkillHits(skill, skill.tuneRuptureScale ?? 16)
      : skill.archetype === 'spectroFrazzle'
          || skill.archetype === 'aeroErosion'
          || skill.archetype === 'fusionBurst'
          || skill.archetype === 'glacioChafe'
          || skill.archetype === 'electroFlare'
          ? getSkillHits(skill, 1)
          : { hitScale: direct.hitScale, hitCount: direct.hitCount }

  // initialize with the standard direct-damage values
  let resMult = direct.resMult
  let defMult = direct.defMult
  let sttcCritRate = direct.critRate
  let sttcCritDmg = direct.critDmg
  let sttcDmgBns = direct.dmgBonus
  let sttcMplf = direct.amplify
  let sttcSpec = direct.special
  let sttcTuneBrkB = finalStats.tbb
  let sttcDmgVuln = (direct.dmgVulnMult - 1) * 100
  let negFfctMltp = 0
  let negFfctFxdMv = 0
  let negFfctCritR = skill.negativeEffectCritRate ?? 0
  let negFfctCritD = skill.negativeEffectCritDmg ?? 1

  // override the shared defaults for archetypes with custom damage rules
  switch (skill.archetype) {
    case 'tuneRupture': {
      const buckets = makeLevelScale({
        finalStats,
        skill,
        enemy,
        level: runtime.base.level,
        kind: 'tuneRupture',
      })

      resMult = buckets.resMult
      defMult = buckets.defMult
      sttcCritRate = buckets.critRate
      sttcCritDmg = buckets.critDmg
      sttcDmgBns = buckets.dmgBonus
      sttcMplf = buckets.amplify
      sttcSpec = 0
      sttcTuneBrkB = buckets.tuneBreakBoost
      sttcDmgVuln = buckets.dmgVuln
      break
    }

    case 'hack': {
      const buckets = makeLevelScale({
        finalStats,
        skill,
        enemy,
        level: runtime.base.level,
        kind: 'hack',
      })

      resMult = buckets.resMult
      defMult = buckets.defMult
      sttcCritRate = buckets.critRate
      sttcCritDmg = buckets.critDmg
      sttcDmgBns = buckets.dmgBonus
      sttcMplf = buckets.amplify
      sttcSpec = 0
      sttcTuneBrkB = buckets.tuneBreakBoost
      sttcDmgVuln = buckets.dmgVuln
      break
    }

    case 'spectroFrazzle':
    case 'aeroErosion':
    case 'fusionBurst':
    case 'glacioChafe':
    case 'electroFlare': {
      const buckets = makeNegBase({
        finalStats,
        skill,
        enemy,
        level: runtime.base.level,
        archetype: skill.archetype,
      })

      resMult = buckets.resMult
      defMult = buckets.defMult
      sttcCritRate = buckets.critRate
      sttcCritDmg = buckets.critDmg
      sttcDmgBns = buckets.dmgBonus
      sttcMplf = buckets.amplify
      sttcSpec = buckets.special
      sttcDmgVuln = buckets.dmgVuln
      negFfctMltp = buckets.multiplier
      negFfctFxdMv = skill.fixedMv ?? 0
      negFfctCritR = buckets.critRate / 100
      negFfctCritD = buckets.critDmg / 100
      break
    }

    default:
      break
  }

  // immunity zeroes the result via resMult, mirroring the elemental RES=100 shortcut.
  // healing/shield ignore enemy multipliers, so leave them untouched.
  if (
      skill.archetype !== 'healing'
      && skill.archetype !== 'shield'
      && isSkillImmune(finalStats.immunities, skill)
  ) {
    resMult = 0
  }

  return {
    archetype: mapSkillArch(skill.archetype),
    characterId: Number.parseInt(resonatorId, 10),
    sequence: runtime.base.sequence,
    level: runtime.base.level,
    enemyLevel: enemy.level,
    enemyBaseRes,
    enemyClass: enemy.class,

    baseAtk: direct.baseAtk,
    baseHp: direct.baseHp,
    baseDef: direct.baseDef,

    statFinAtk: direct.finalAtk,
    statFinHp: direct.finalHp,
    statFinDef: direct.finalDef,
    statFinEr: direct.finalER,

    statCritRate: sttcCritRate,
    statCritDmg: sttcCritDmg,
    statHealBosi: finalStats.healingBonus,
    statShieldna: finalStats.shieldBonus,
    statDmgBonus: sttcDmgBns,
    statAmp: sttcMplf,
    statFlatDmg: finalStats.flatDmg,
    statSpec: sttcSpec,

    resMult,
    defMult,
    dmgReduction: 1 + (sttcDmgVuln / 100),

    statTuneBrcq: sttcTuneBrkB,
    statResShrd: 0,
    statDefGnr: 0,
    statDefShrd: 0,
    statDmgVuln: sttcDmgVuln,

    scalingAtk: direct.scalingAtk,
    scalingHp: direct.scalingHp,
    scalingDef: direct.scalingDef,
    scalingER: direct.scalingER,

    hitScale: hitInfo.hitScale,
    hitCount: hitInfo.hitCount,
    multiplier: direct.multiplier,

    flat: skill.flat,
    fixedDmg: direct.fixedDmg,

    skillHealBonus: skill.skillHealingBonus ?? 0,
    skillShield: skill.skillShieldBonus ?? 0,

    tuneRptrScl: skill.tuneRuptureScale ?? 0,
    tuneRptrCrny: skill.tuneRuptureCritRate ?? 0,
    tuneCritDmg: skill.tuneRuptureCritDmg ?? 1,

    negEfxMult: negFfctMltp,
    negEfxFxdMv: negFfctFxdMv,
    negEfxCritoo: negFfctCritR,
    negEfxCritsa: negFfctCritD,

    combatSpectro: skill.stackMode === 'fixedMax' && skill.archetype === 'spectroFrazzle'
      ? skill.stackMax ?? getNegEffectDef('spectroFrazzle')
      : combatState?.spectroFrazzle ?? combatState?.spctFrzz ?? 0,
    combatAero: skill.stackMode === 'fixedMax' && skill.archetype === 'aeroErosion'
      ? skill.stackMax ?? getNegEffectDef('aeroErosion')
      : combatState?.aeroErosion ?? 0,
    combatFusion: skill.stackMode === 'fixedMax' && skill.archetype === 'fusionBurst'
      ? skill.stackMax ?? getNegEffectDef('fusionBurst')
      : combatState?.fusionBurst ?? 0,
    combatGlacio: skill.stackMode === 'fixedMax' && skill.archetype === 'glacioChafe'
      ? skill.stackMax ?? getNegEffectDef('glacioChafe')
      : combatState?.glacioChafe ?? 0,
    combatElectro: skill.stackMode === 'fixedMax' && skill.archetype === 'electroFlare'
      ? skill.stackMax ?? getNegEffectDef('electroFlare')
      : combatState?.electroFlare ?? 0,
    combatElecRage: combatState?.electroRage ?? 0,
  }
}
