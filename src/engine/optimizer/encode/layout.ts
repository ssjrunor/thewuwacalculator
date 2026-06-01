/*
  Author: Runor Ewhro
  Description: centralizes vector-layout constants used by optimizer
               encoding and evaluation so all modules share the same
               packed stat, set-lut, and main-echo row structure.
*/

import {
  MAIN_BUFF_LEN,
  SET_SLOT_COUNT as MAX_SET_SLOTS,
  STAT_STRIDE,
  STAT_AMPLIFY,
  STAT_ATK_FLAT,
  STAT_ATK_PCT,
  STAT_CRIT_DMG,
  STAT_CRIT_RATE,
  STAT_DEF_FLAT,
  STAT_DEF_IGNORE,
  STAT_DEF_PCT,
  STAT_DEF_SHRED,
  STAT_DMG_BONUS,
  STAT_DMG_VULN,
  STAT_ENERGY,
  STAT_FLAT_DMG,
  STAT_FUSION_RES,
  STAT_HEAL_BON,
  STAT_HP_FLAT,
  STAT_HP_PCT,
  STAT_RES_SHRED,
  STAT_SHIELD_BON,
  STAT_SPECIAL,
  STAT_TUNE_BREAK,
} from '@/engine/optimizer/config/constants.ts'

// number of packed stat slots per encoded echo vector
export const VECTOR_STRIDE = STAT_STRIDE

// number of packed slots per main-echo bonus row
export const MAIN_BUFF_ROWS = MAIN_BUFF_LEN

// max number of supported set ids in packed optimizer data
export const SET_SLOT_COUNT = MAX_SET_SLOTS

// number of piece-count buckets per set row family
// typically: 0-piece, 1-piece, 2-piece, 3-piece, 5-piece style buckets
export const SET_BKT_CNT = 5

// total float capacity of the flattened set lookup table
export const SET_LUT_SIZE = SET_SLOT_COUNT * SET_BKT_CNT * VECTOR_STRIDE

// re-export vector field offsets so encoding/evaluation code can import
// them from one shared layout module instead of the raw constants file
export const VEC_ATK_PCT = STAT_ATK_PCT
export const VEC_ATK_FLAT = STAT_ATK_FLAT
export const VEC_HP_PRCN = STAT_HP_PCT
export const VEC_HP_FLAT = STAT_HP_FLAT
export const VEC_DEF_PRCN = STAT_DEF_PCT
export const VEC_DEF_FLAT = STAT_DEF_FLAT
export const VEC_CRIT_RATE = STAT_CRIT_RATE
export const VEC_CRIT_DMG = STAT_CRIT_DMG
export const VEC_ENERGY = STAT_ENERGY
export const VEC_HEAL_BONUS = STAT_HEAL_BON
export const VEC_SHIELD_BON = STAT_SHIELD_BON
export const VEC_DMG_BONUS = STAT_DMG_BONUS
export const VEC_AMPLIFY = STAT_AMPLIFY
export const VEC_FLAT_DMG = STAT_FLAT_DMG
export const VEC_SPECIAL = STAT_SPECIAL
export const VEC_FUSION_RES = STAT_FUSION_RES
export const VEC_TUNE_BREAK = STAT_TUNE_BREAK
export const VEC_RES_SHRED = STAT_RES_SHRED
export const VEC_DEF_IGNORE = STAT_DEF_IGNORE
export const VEC_DEF_SHRED = STAT_DEF_SHRED
export const VEC_DMG_VULN = STAT_DMG_VULN
