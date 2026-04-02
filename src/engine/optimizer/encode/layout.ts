/*
  Author: Runor Ewhro
  Description: centralizes vector-layout constants used by optimizer
               encoding and evaluation so all modules share the same
               packed stat, set-lut, and main-echo row structure.
*/

import {
  OPTIMIZER_MAIN_ECHO_BUFFS_PER_ECHO,
  OPTIMIZER_SET_SLOTS,
  OPTIMIZER_STATS_PER_ECHO,
  OPTIMIZER_VEC_AMPLIFY,
  OPTIMIZER_VEC_ATK_FLAT,
  OPTIMIZER_VEC_ATK_PERCENT,
  OPTIMIZER_VEC_CRIT_DMG,
  OPTIMIZER_VEC_CRIT_RATE,
  OPTIMIZER_VEC_DEF_FLAT,
  OPTIMIZER_VEC_DEF_IGNORE,
  OPTIMIZER_VEC_DEF_PERCENT,
  OPTIMIZER_VEC_DEF_SHRED,
  OPTIMIZER_VEC_DMG_BONUS,
  OPTIMIZER_VEC_DMG_VULN,
  OPTIMIZER_VEC_ENERGY_REGEN,
  OPTIMIZER_VEC_FLAT_DMG,
  OPTIMIZER_VEC_FUSION_BURST_MULTIPLIER,
  OPTIMIZER_VEC_HEALING_BONUS,
  OPTIMIZER_VEC_HP_FLAT,
  OPTIMIZER_VEC_HP_PERCENT,
  OPTIMIZER_VEC_RES_SHRED,
  OPTIMIZER_VEC_SHIELD_BONUS,
  OPTIMIZER_VEC_SPECIAL,
  OPTIMIZER_VEC_TUNE_BREAK_BOOST,
} from '@/engine/optimizer/config/constants.ts'

// number of packed stat slots per encoded echo vector
export const VECTOR_STRIDE = OPTIMIZER_STATS_PER_ECHO

// number of packed slots per main-echo bonus row
export const MAIN_ECHO_ROW_STRIDE = OPTIMIZER_MAIN_ECHO_BUFFS_PER_ECHO

// max number of supported set ids in packed optimizer data
export const SET_SLOT_COUNT = OPTIMIZER_SET_SLOTS

// number of piece-count buckets per set row family
// typically: 0-piece, 2-piece, 3-piece, 5-piece style buckets
export const SET_BUCKET_COUNT = 4

// total float capacity of the flattened set lookup table
export const SET_LUT_SIZE = SET_SLOT_COUNT * SET_BUCKET_COUNT * VECTOR_STRIDE

// re-export vector field offsets so encoding/evaluation code can import
// them from one shared layout module instead of the raw constants file
export const VEC_ATK_PERCENT = OPTIMIZER_VEC_ATK_PERCENT
export const VEC_ATK_FLAT = OPTIMIZER_VEC_ATK_FLAT
export const VEC_HP_PERCENT = OPTIMIZER_VEC_HP_PERCENT
export const VEC_HP_FLAT = OPTIMIZER_VEC_HP_FLAT
export const VEC_DEF_PERCENT = OPTIMIZER_VEC_DEF_PERCENT
export const VEC_DEF_FLAT = OPTIMIZER_VEC_DEF_FLAT
export const VEC_CRIT_RATE = OPTIMIZER_VEC_CRIT_RATE
export const VEC_CRIT_DMG = OPTIMIZER_VEC_CRIT_DMG
export const VEC_ENERGY_REGEN = OPTIMIZER_VEC_ENERGY_REGEN
export const VEC_HEALING_BONUS = OPTIMIZER_VEC_HEALING_BONUS
export const VEC_SHIELD_BONUS = OPTIMIZER_VEC_SHIELD_BONUS
export const VEC_DMG_BONUS = OPTIMIZER_VEC_DMG_BONUS
export const VEC_AMPLIFY = OPTIMIZER_VEC_AMPLIFY
export const VEC_FLAT_DMG = OPTIMIZER_VEC_FLAT_DMG
export const VEC_SPECIAL = OPTIMIZER_VEC_SPECIAL
export const VEC_FUSION_BURST_MULTIPLIER = OPTIMIZER_VEC_FUSION_BURST_MULTIPLIER
export const VEC_TUNE_BREAK_BOOST = OPTIMIZER_VEC_TUNE_BREAK_BOOST
export const VEC_RES_SHRED = OPTIMIZER_VEC_RES_SHRED
export const VEC_DEF_IGNORE = OPTIMIZER_VEC_DEF_IGNORE
export const VEC_DEF_SHRED = OPTIMIZER_VEC_DEF_SHRED
export const VEC_DMG_VULN = OPTIMIZER_VEC_DMG_VULN
