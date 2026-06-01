/*
  Author: Runor Ewhro
  Description: Packs a compiled optimizer target-skill context into a flat
               float array with a fixed stride so it can be stored,
               transferred, or consumed by lower-level execution code.
*/

import type { CompTargetSkill } from '@/engine/optimizer/types.ts'

// total float slots reserved for one packed compiled context
export const PACKED_CTX_LEN = 51

// field offsets inside the packed compiled-context array
export const CTX_ARCH = 0
export const CTX_CHAR_ID = 1
export const CTX_SEQUENCE = 2
export const CTX_LEVEL = 3
export const CTX_ENEMY_LVL = 4
export const CTX_ENEMY_RES = 5
export const CTX_ENEMY_CLASS = 6
export const CTX_BASE_ATK = 7
export const CTX_BASE_HP = 8
export const CTX_BASE_DEF = 9
export const CTX_FINAL_ATK = 10
export const CTX_FINAL_HP = 11
export const CTX_FINAL_DEF = 12
export const CTX_FINAL_ER = 13
export const CTX_CRIT_RATE = 14
export const CTX_CRIT_DMG = 15
export const CTX_HEAL_BONUS = 16
export const CTX_SHLD_BONUS = 17
export const CTX_DMG_BONUS = 18
export const CTX_AMPLIFY = 19
export const CTX_FLAT_DMG = 20
export const CTX_SPECIAL = 21
export const CTX_NEG_MULT = 22
export const CTX_TUNE_BREAK = 23
export const CTX_RES_SHRED = 24
export const CTX_DEF_IGNORE = 25
export const CTX_DEF_SHRED = 26
export const CTX_DMG_VULN = 27
export const CTX_SCLN_ATK = 28
export const CTX_SCLN_HP = 29
export const CTX_SCLN_DEF = 30
export const CTX_SCALE_ER = 31
export const CTX_HIT_SCL = 32
export const CTX_HIT_CNT = 33
export const CTX_MULT = 34
export const CTX_FLAT = 35
export const CTX_FXD_DMG = 36
export const CTX_SKILL_HEAL = 37
export const CTX_SKILL_SHLD = 38
export const CTX_TUNE_RES = 39
export const CTX_TUNE_CRIT = 40
export const CTX_TUNE_BOOST = 41
export const CTX_NEG_CRIT = 42
export const CTX_NEG_DMG = 43
export const CTX_COMBAT_SPEC = 44
export const CTX_COMBAT_AERO = 45
export const CTX_COMBAT_FUS = 46
export const CTX_COMBAT_ELEC = 47
export const CTX_COMBAT_ERES = 48
export const CTX_COMBAT_GLAC = 49
export const CTX_NEG_FIXED = 50

// write every field from the structured compiled context into a flat float array
export function packCompCtx(context: CompTargetSkill): Float32Array {
  const out = new Float32Array(PACKED_CTX_LEN)

  out[CTX_ARCH] = context.archetype
  out[CTX_CHAR_ID] = context.characterId
  out[CTX_SEQUENCE] = context.sequence
  out[CTX_LEVEL] = context.level
  out[CTX_ENEMY_LVL] = context.enemyLevel
  out[CTX_ENEMY_RES] = context.enemyBaseRes
  out[CTX_ENEMY_CLASS] = context.enemyClass

  out[CTX_BASE_ATK] = context.baseAtk
  out[CTX_BASE_HP] = context.baseHp
  out[CTX_BASE_DEF] = context.baseDef

  out[CTX_FINAL_ATK] = context.statFinAtk
  out[CTX_FINAL_HP] = context.statFinHp
  out[CTX_FINAL_DEF] = context.statFinDef
  out[CTX_FINAL_ER] = context.statFinEr

  out[CTX_CRIT_RATE] = context.statCritRate
  out[CTX_CRIT_DMG] = context.statCritDmg
  out[CTX_HEAL_BONUS] = context.statHealBosi
  out[CTX_SHLD_BONUS] = context.statShieldna
  out[CTX_DMG_BONUS] = context.statDmgBonus
  out[CTX_AMPLIFY] = context.statAmp
  out[CTX_FLAT_DMG] = context.statFlatDmg
  out[CTX_SPECIAL] = context.statSpec
  out[CTX_NEG_MULT] = context.negEfxMult
  out[CTX_TUNE_BREAK] = context.statTuneBrcq
  out[CTX_RES_SHRED] = context.statResShrd
  out[CTX_DEF_IGNORE] = context.statDefGnr
  out[CTX_DEF_SHRED] = context.statDefShrd
  out[CTX_DMG_VULN] = context.statDmgVuln

  out[CTX_SCLN_ATK] = context.scalingAtk
  out[CTX_SCLN_HP] = context.scalingHp
  out[CTX_SCLN_DEF] = context.scalingDef
  out[CTX_SCALE_ER] = context.scalingER

  out[CTX_HIT_SCL] = context.hitScale
  out[CTX_HIT_CNT] = context.hitCount
  out[CTX_MULT] = context.multiplier
  out[CTX_FLAT] = context.flat
  out[CTX_FXD_DMG] = context.fixedDmg

  out[CTX_SKILL_HEAL] = context.skillHealBonus
  out[CTX_SKILL_SHLD] = context.skillShield

  out[CTX_TUNE_RES] = context.tuneRptrScl
  out[CTX_TUNE_CRIT] = context.tuneRptrCrny
  out[CTX_TUNE_BOOST] = context.tuneCritDmg

  out[CTX_NEG_CRIT] = context.negEfxCritoo
  out[CTX_NEG_DMG] = context.negEfxCritsa

  out[CTX_COMBAT_SPEC] = context.combatSpectro
  out[CTX_COMBAT_AERO] = context.combatAero
  out[CTX_COMBAT_FUS] = context.combatFusion
  out[CTX_COMBAT_ELEC] = context.combatElectro
  out[CTX_COMBAT_ERES] = context.combatElecRage
  out[CTX_COMBAT_GLAC] = context.combatGlacio
  out[CTX_NEG_FIXED] = context.negEfxFxdMv

  return out
}
