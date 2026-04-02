/*
  author: Runor Ewhro
  description: builds the packed optimizer-facing combat context for a
               selected skill by converting final stat state, enemy data,
               and archetype-specific rules into numeric fields used by
               the optimizer backend.
*/

import type { EnemyProfile } from '@/domain/entities/appState.ts'
import { ATTRIBUTE_TO_ENEMY_RES_INDEX, isUnsetEnemyProfile } from '@/domain/entities/appState.ts'
import type {
  FinalStats,
  ModBuff,
  SkillArchetype,
  SkillDefinition,
  SkillTypeKey,
} from '@/domain/entities/stats.ts'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime.ts'
import type { CompiledTargetSkillContext } from '@/engine/optimizer/types.ts'
import {
  OPTIMIZER_ARCHETYPE_AERO_EROSION,
  OPTIMIZER_ARCHETYPE_DAMAGE,
  OPTIMIZER_ARCHETYPE_FUSION_BURST,
  OPTIMIZER_ARCHETYPE_HEALING,
  OPTIMIZER_ARCHETYPE_SHIELD,
  OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE,
  OPTIMIZER_ARCHETYPE_TUNE_RUPTURE,
} from '@/engine/optimizer/config/constants.ts'
import { buildDirectSkillDamageContext } from '@/engine/formulas/damage.ts'
import { aggregateSkillTypeBuffs, makeModBuff } from '@/engine/resolvers/buffPool.ts'

// convert enemy resistance percent into the actual damage multiplier
function resistanceMultiplier(enemyResPercent: number): number {
  if (enemyResPercent < 0) return 1 - enemyResPercent / 200
  if (enemyResPercent < 75) return 1 - enemyResPercent / 100
  return 1 / (1 + 5 * (enemyResPercent / 100))
}

// compute the defense multiplier after def ignore and def shred are applied
function defenseMultiplier(
    characterLevel: number,
    enemyLevel: number,
    defIgnore: number,
    defShred: number,
): number {
  const enemyDefense = ((8 * enemyLevel) + 792) * (1 - (defIgnore + defShred) / 100)
  return (800 + 8 * characterLevel) / (800 + 8 * characterLevel + Math.max(0, enemyDefense))
}

// resolve a usable hit scale/count pair for optimizer math
// this falls back to a single-hit representation when the skill has no hit list
function resolveSkillHitScale(
    skill: SkillDefinition,
    fallbackMultiplier: number,
): { hitScale: number; hitCount: number } {
  if (skill.hits.length > 0) {
    return {
      hitScale: skill.hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0),
      hitCount: skill.hits.reduce((total, hit) => total + hit.count, 0),
    }
  }

  if (fallbackMultiplier <= 0) {
    return { hitScale: 0, hitCount: 0 }
  }

  return {
    hitScale: fallbackMultiplier,
    hitCount: 1,
  }
}

// normalize optional skill-local buffs into a complete mod-buff object
function buildSkillBuffs(skill: SkillDefinition): ModBuff {
  return {
    ...makeModBuff(),
    ...(skill.skillBuffs ?? {}),
  }
}

// map high-level skill archetypes into compact numeric ids used by the optimizer
export function mapSkillArchetype(archetype: SkillArchetype): number {
  switch (archetype) {
    case 'healing':
      return OPTIMIZER_ARCHETYPE_HEALING
    case 'shield':
      return OPTIMIZER_ARCHETYPE_SHIELD
    case 'tuneRupture':
      return OPTIMIZER_ARCHETYPE_TUNE_RUPTURE
    case 'spectroFrazzle':
      return OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE
    case 'aeroErosion':
      return OPTIMIZER_ARCHETYPE_AERO_EROSION
    case 'fusionBurst':
      return OPTIMIZER_ARCHETYPE_FUSION_BURST
    case 'skillDamage':
    default:
      return OPTIMIZER_ARCHETYPE_DAMAGE
  }
}

// read the enemy's base resistance for the skill element
function resolveEnemyResistance(
    enemy: EnemyProfile,
    element: SkillDefinition['element'],
): number {
  if (isUnsetEnemyProfile(enemy)) {
    return 0
  }

  return enemy.res[ATTRIBUTE_TO_ENEMY_RES_INDEX[element]]
}

// build the special multiplier buckets used by tune rupture skills
function buildTuneRuptureBuckets(options: {
  finalStats: FinalStats
  skill: SkillDefinition
  enemy: EnemyProfile
  level: number
}) {
  const { finalStats, skill, enemy, level } = options
  const ignoresEnemy = isUnsetEnemyProfile(enemy)
  const element = skill.element
  const baseRes = ignoresEnemy ? 0 : resolveEnemyResistance(enemy, element)
  const attributeAll = finalStats.attribute.all
  const attributeElement = finalStats.attribute[element]
  const skillTypeAll = finalStats.skillType.all
  const skillTypeBuff = aggregateSkillTypeBuffs(finalStats.skillType, skill.skillType)
  const skillBuffs = buildSkillBuffs(skill)

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

  const enemyResValue = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = (!ignoresEnemy && baseRes === 100)
      ? 0
      : (ignoresEnemy ? 1 : resistanceMultiplier(enemyResValue))

  const defMult = ignoresEnemy
      ? 1
      : defenseMultiplier(level, enemy.level, defIgnore, defShred)

  return {
    resMult,
    defMult,
    dmgVuln,
    dmgBonus: finalStats.skillType.tuneRupture.dmgBonus,
    amplify: finalStats.amplify,
    tuneBreakBoost: finalStats.tuneBreakBoost,
    critRate: (skill.tuneRuptureCritRate ?? 0) * 100,
    critDmg: (skill.tuneRuptureCritDmg ?? 1) * 100,
  }
}

// build the special multiplier buckets used by negative-effect archetypes
function buildNegativeEffectBuckets(options: {
  finalStats: FinalStats
  skill: SkillDefinition
  enemy: EnemyProfile
  level: number
  archetype: Extract<SkillDefinition['archetype'], 'spectroFrazzle' | 'aeroErosion' | 'fusionBurst'>
}) {
  const { finalStats, skill, enemy, level, archetype } = options
  const ignoresEnemy = isUnsetEnemyProfile(enemy)

  const element = archetype === 'spectroFrazzle'
      ? 'spectro'
      : archetype === 'aeroErosion'
          ? 'aero'
          : 'fusion'

  const baseRes = ignoresEnemy ? 0 : resolveEnemyResistance(enemy, element)
  const attributeAll = finalStats.attribute.all
  const attributeElement = finalStats.attribute[element]
  const effectSkillType = finalStats.skillType[archetype]
  const aggregatedEffectType = aggregateSkillTypeBuffs(finalStats.skillType, [archetype] as SkillTypeKey[])

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

  const enemyResValue = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = (!ignoresEnemy && baseRes === 100)
      ? 0
      : (ignoresEnemy ? 1 : resistanceMultiplier(enemyResValue))

  const defMult = ignoresEnemy
      ? 1
      : defenseMultiplier(level, enemy.level, defIgnore, defShred)

  const amplifyMultiplier =
      (1 + finalStats.amplify / 100) *
      (1 + effectSkillType.amplify / 100)

  return {
    resMult,
    defMult,
    dmgVuln,
    dmgBonus: effectSkillType.dmgBonus,
    amplify: (amplifyMultiplier - 1) * 100,
    special: finalStats.special,
    critRate: (skill.negativeEffectCritRate ?? 0) * 100,
    critDmg: (skill.negativeEffectCritDmg ?? 1) * 100,
  }
}

// build the final compiled context consumed by packed optimizer evaluation
export function buildCompiledOptimizerContext(options: {
  resonatorId: string
  runtime: ResonatorRuntimeState
  skill: SkillDefinition
  finalStats: FinalStats
  enemy: EnemyProfile
  combatState?: {
    spectroFrazzle?: number
    aeroErosion?: number
    fusionBurst?: number
  }
}): CompiledTargetSkillContext {
  const { resonatorId, runtime, skill, finalStats, enemy, combatState } = options

  // start from the standard direct-damage context so common values are shared
  const direct = buildDirectSkillDamageContext(
      finalStats,
      skill,
      enemy,
      runtime.base.level,
  )

  const enemyBaseRes = resolveEnemyResistance(enemy, skill.element)

  // different archetypes need different hit-scale fallback logic
  const hitInfo = skill.archetype === 'tuneRupture'
      ? resolveSkillHitScale(skill, skill.tuneRuptureScale ?? 16)
      : skill.archetype === 'spectroFrazzle' || skill.archetype === 'aeroErosion' || skill.archetype === 'fusionBurst'
          ? resolveSkillHitScale(skill, 1)
          : { hitScale: direct.hitScale, hitCount: direct.hitCount }

  // initialize with the standard direct-damage values
  let resMult = direct.resMult
  let defMult = direct.defenseMultiplier
  let staticCritRate = direct.critRate
  let staticCritDmg = direct.critDmg
  let staticDmgBonus = direct.dmgBonus
  let staticAmplify = direct.amplify
  let staticSpecial = direct.special
  const staticFusionBurstMultiplier = finalStats.fusionBurstMultiplier
  let staticTuneBreakBoost = finalStats.tuneBreakBoost
  let staticDmgVuln = (direct.dmgVulnMultiplier - 1) * 100

  // override the shared defaults for archetypes with custom damage rules
  switch (skill.archetype) {
    case 'tuneRupture': {
      const buckets = buildTuneRuptureBuckets({
        finalStats,
        skill,
        enemy,
        level: runtime.base.level,
      })

      resMult = buckets.resMult
      defMult = buckets.defMult
      staticCritRate = buckets.critRate
      staticCritDmg = buckets.critDmg
      staticDmgBonus = buckets.dmgBonus
      staticAmplify = buckets.amplify
      staticSpecial = 0
      staticTuneBreakBoost = buckets.tuneBreakBoost
      staticDmgVuln = buckets.dmgVuln
      break
    }

    case 'spectroFrazzle':
    case 'aeroErosion':
    case 'fusionBurst': {
      const buckets = buildNegativeEffectBuckets({
        finalStats,
        skill,
        enemy,
        level: runtime.base.level,
        archetype: skill.archetype,
      })

      resMult = buckets.resMult
      defMult = buckets.defMult
      staticCritRate = buckets.critRate
      staticCritDmg = buckets.critDmg
      staticDmgBonus = buckets.dmgBonus
      staticAmplify = buckets.amplify
      staticSpecial = buckets.special
      staticDmgVuln = buckets.dmgVuln
      break
    }

    default:
      break
  }

  return {
    archetype: mapSkillArchetype(skill.archetype),
    characterId: Number.parseInt(resonatorId, 10),
    sequence: runtime.base.sequence,
    level: runtime.base.level,
    enemyLevel: enemy.level,
    enemyBaseRes,
    enemyClass: enemy.class,

    baseAtk: direct.baseAtk,
    baseHp: direct.baseHp,
    baseDef: direct.baseDef,

    staticFinalAtk: direct.finalAtk,
    staticFinalHp: direct.finalHp,
    staticFinalDef: direct.finalDef,
    staticFinalER: direct.finalER,

    staticCritRate,
    staticCritDmg,
    staticHealingBonus: finalStats.healingBonus,
    staticShieldBonus: finalStats.shieldBonus,
    staticDmgBonus,
    staticAmplify,
    staticFlatDmg: finalStats.flatDmg,
    staticSpecial,

    resMult,
    defMult,
    dmgReduction: 1 + (staticDmgVuln / 100),

    staticFusionBurstMultiplier,
    staticTuneBreakBoost,
    staticResShred: 0,
    staticDefIgnore: 0,
    staticDefShred: 0,
    staticDmgVuln,

    scalingAtk: direct.scalingAtk,
    scalingHp: direct.scalingHp,
    scalingDef: direct.scalingDef,
    scalingER: direct.scalingER,

    hitScale: hitInfo.hitScale,
    hitCount: hitInfo.hitCount,
    multiplier: direct.multiplier,

    flat: skill.flat,
    fixedDmg: direct.fixedDmg,

    skillHealingBonus: skill.skillHealingBonus ?? 0,
    skillShieldBonus: skill.skillShieldBonus ?? 0,

    tuneRuptureScale: skill.tuneRuptureScale ?? 0,
    tuneRuptureCritRate: skill.tuneRuptureCritRate ?? 0,
    tuneRuptureCritDmg: skill.tuneRuptureCritDmg ?? 1,

    negativeEffectCritRate: skill.negativeEffectCritRate ?? 0,
    negativeEffectCritDmg: skill.negativeEffectCritDmg ?? 1,

    combatSpectroFrazzle: combatState?.spectroFrazzle ?? 0,
    combatAeroErosion: combatState?.aeroErosion ?? 0,
    combatFusionBurst: combatState?.fusionBurst ?? 0,
  }
}
