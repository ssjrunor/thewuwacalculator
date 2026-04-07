/*
  Author: Runor Ewhro
  Description: Packs a compiled optimizer target-skill context into a flat
               float array with a fixed stride so it can be stored,
               transferred, or consumed by lower-level execution code.
*/

import type { CompiledTargetSkillContext } from '@/engine/optimizer/types.ts'

// total float slots reserved for one packed compiled context
export const PACKED_CONTEXT_STRIDE = 51

// field offsets inside the packed compiled-context array
export const CTX_ARCHETYPE = 0
export const CTX_CHARACTER_ID = 1
export const CTX_SEQUENCE = 2
export const CTX_LEVEL = 3
export const CTX_ENEMY_LEVEL = 4
export const CTX_ENEMY_BASE_RES = 5
export const CTX_ENEMY_CLASS = 6
export const CTX_BASE_ATK = 7
export const CTX_BASE_HP = 8
export const CTX_BASE_DEF = 9
export const CTX_STATIC_FINAL_ATK = 10
export const CTX_STATIC_FINAL_HP = 11
export const CTX_STATIC_FINAL_DEF = 12
export const CTX_STATIC_FINAL_ER = 13
export const CTX_STATIC_CRIT_RATE = 14
export const CTX_STATIC_CRIT_DMG = 15
export const CTX_STATIC_HEALING_BONUS = 16
export const CTX_STATIC_SHIELD_BONUS = 17
export const CTX_STATIC_DMG_BONUS = 18
export const CTX_STATIC_AMPLIFY = 19
export const CTX_STATIC_FLAT_DMG = 20
export const CTX_STATIC_SPECIAL = 21
export const CTX_NEGATIVE_EFFECT_MULTIPLIER = 22
export const CTX_STATIC_TUNE_BREAK_BOOST = 23
export const CTX_STATIC_RES_SHRED = 24
export const CTX_STATIC_DEF_IGNORE = 25
export const CTX_STATIC_DEF_SHRED = 26
export const CTX_STATIC_DMG_VULN = 27
export const CTX_SCALING_ATK = 28
export const CTX_SCALING_HP = 29
export const CTX_SCALING_DEF = 30
export const CTX_SCALING_ER = 31
export const CTX_HIT_SCALE = 32
export const CTX_HIT_COUNT = 33
export const CTX_MULTIPLIER = 34
export const CTX_FLAT = 35
export const CTX_FIXED_DMG = 36
export const CTX_SKILL_HEALING_BONUS = 37
export const CTX_SKILL_SHIELD_BONUS = 38
export const CTX_TUNE_RUPTURE_SCALE = 39
export const CTX_TUNE_RUPTURE_CRIT_RATE = 40
export const CTX_TUNE_RUPTURE_CRIT_DMG = 41
export const CTX_NEGATIVE_EFFECT_CRIT_RATE = 42
export const CTX_NEGATIVE_EFFECT_CRIT_DMG = 43
export const CTX_COMBAT_SPECTRO_FRAZZLE = 44
export const CTX_COMBAT_AERO_EROSION = 45
export const CTX_COMBAT_FUSION_BURST = 46
export const CTX_COMBAT_ELECTRO_FLARE = 47
export const CTX_COMBAT_ELECTRO_RAGE = 48
export const CTX_COMBAT_GLACIO_CHAFE = 49

// write every field from the structured compiled context into a flat float array
export function packCompiledContext(context: CompiledTargetSkillContext): Float32Array {
  const out = new Float32Array(PACKED_CONTEXT_STRIDE)

  out[CTX_ARCHETYPE] = context.archetype
  out[CTX_CHARACTER_ID] = context.characterId
  out[CTX_SEQUENCE] = context.sequence
  out[CTX_LEVEL] = context.level
  out[CTX_ENEMY_LEVEL] = context.enemyLevel
  out[CTX_ENEMY_BASE_RES] = context.enemyBaseRes
  out[CTX_ENEMY_CLASS] = context.enemyClass

  out[CTX_BASE_ATK] = context.baseAtk
  out[CTX_BASE_HP] = context.baseHp
  out[CTX_BASE_DEF] = context.baseDef

  out[CTX_STATIC_FINAL_ATK] = context.staticFinalAtk
  out[CTX_STATIC_FINAL_HP] = context.staticFinalHp
  out[CTX_STATIC_FINAL_DEF] = context.staticFinalDef
  out[CTX_STATIC_FINAL_ER] = context.staticFinalER

  out[CTX_STATIC_CRIT_RATE] = context.staticCritRate
  out[CTX_STATIC_CRIT_DMG] = context.staticCritDmg
  out[CTX_STATIC_HEALING_BONUS] = context.staticHealingBonus
  out[CTX_STATIC_SHIELD_BONUS] = context.staticShieldBonus
  out[CTX_STATIC_DMG_BONUS] = context.staticDmgBonus
  out[CTX_STATIC_AMPLIFY] = context.staticAmplify
  out[CTX_STATIC_FLAT_DMG] = context.staticFlatDmg
  out[CTX_STATIC_SPECIAL] = context.staticSpecial
  out[CTX_NEGATIVE_EFFECT_MULTIPLIER] = context.negativeEffectMultiplier
  out[CTX_STATIC_TUNE_BREAK_BOOST] = context.staticTuneBreakBoost
  out[CTX_STATIC_RES_SHRED] = context.staticResShred
  out[CTX_STATIC_DEF_IGNORE] = context.staticDefIgnore
  out[CTX_STATIC_DEF_SHRED] = context.staticDefShred
  out[CTX_STATIC_DMG_VULN] = context.staticDmgVuln

  out[CTX_SCALING_ATK] = context.scalingAtk
  out[CTX_SCALING_HP] = context.scalingHp
  out[CTX_SCALING_DEF] = context.scalingDef
  out[CTX_SCALING_ER] = context.scalingER

  out[CTX_HIT_SCALE] = context.hitScale
  out[CTX_HIT_COUNT] = context.hitCount
  out[CTX_MULTIPLIER] = context.multiplier
  out[CTX_FLAT] = context.flat
  out[CTX_FIXED_DMG] = context.fixedDmg

  out[CTX_SKILL_HEALING_BONUS] = context.skillHealingBonus
  out[CTX_SKILL_SHIELD_BONUS] = context.skillShieldBonus

  out[CTX_TUNE_RUPTURE_SCALE] = context.tuneRuptureScale
  out[CTX_TUNE_RUPTURE_CRIT_RATE] = context.tuneRuptureCritRate
  out[CTX_TUNE_RUPTURE_CRIT_DMG] = context.tuneRuptureCritDmg

  out[CTX_NEGATIVE_EFFECT_CRIT_RATE] = context.negativeEffectCritRate
  out[CTX_NEGATIVE_EFFECT_CRIT_DMG] = context.negativeEffectCritDmg

  out[CTX_COMBAT_SPECTRO_FRAZZLE] = context.combatSpectroFrazzle
  out[CTX_COMBAT_AERO_EROSION] = context.combatAeroErosion
  out[CTX_COMBAT_FUSION_BURST] = context.combatFusionBurst
  out[CTX_COMBAT_ELECTRO_FLARE] = context.combatElectroFlare
  out[CTX_COMBAT_ELECTRO_RAGE] = context.combatElectroRage
  out[CTX_COMBAT_GLACIO_CHAFE] = context.combatGlacioChafe

  return out
}
