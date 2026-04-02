/*
  Author: Runor Ewhro
  Description: evaluates encoded optimizer combos on the cpu for both
               target-skill and rotation modes, including set effects,
               main-echo permutations, packed-context damage evaluation,
               stat extraction, and constraint filtering.
*/

import type { OptimizerResultStats } from '@/engine/optimizer/types.ts'
import { getNegativeEffectBase } from '@/engine/formulas/negativeEffects.ts'
import { getTuneRuptureLevelScale } from '@/engine/formulas/tuneRupture.ts'
import { createCpuScratch, type CpuScratch } from '@/engine/optimizer/cpu/scratch.ts'
import { applySetEffectsEncoded } from '@/engine/optimizer/cpu/setEffects.ts'
import { passesConstraints } from '@/engine/optimizer/constraints/statConstraints.ts'
import {
  OPTIMIZER_ARCHETYPE_AERO_EROSION,
  OPTIMIZER_ARCHETYPE_DAMAGE,
  OPTIMIZER_ARCHETYPE_FUSION_BURST,
  OPTIMIZER_ARCHETYPE_HEALING,
  OPTIMIZER_ARCHETYPE_SHIELD,
  OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE,
  OPTIMIZER_ARCHETYPE_TUNE_RUPTURE,
  OPTIMIZER_ECHOS_PER_COMBO,
  OPTIMIZER_MAIN_ECHO_BUFFS_PER_ECHO,
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
import {
  PACKED_CONTEXT_STRIDE as OPTIMIZER_PACKED_CONTEXT_STRIDE,
  CTX_ARCHETYPE as OPT_CTX_ARCHETYPE,
  CTX_BASE_ATK as OPT_CTX_BASE_ATK,
  CTX_BASE_DEF as OPT_CTX_BASE_DEF,
  CTX_BASE_HP as OPT_CTX_BASE_HP,
  CTX_COMBAT_AERO_EROSION as OPT_CTX_COMBAT_AERO_EROSION,
  CTX_COMBAT_FUSION_BURST as OPT_CTX_COMBAT_FUSION_BURST,
  CTX_COMBAT_SPECTRO_FRAZZLE as OPT_CTX_COMBAT_SPECTRO_FRAZZLE,
  CTX_ENEMY_BASE_RES as OPT_CTX_ENEMY_BASE_RES,
  CTX_ENEMY_CLASS as OPT_CTX_ENEMY_CLASS,
  CTX_ENEMY_LEVEL as OPT_CTX_ENEMY_LEVEL,
  CTX_FIXED_DMG as OPT_CTX_FIXED_DMG,
  CTX_FLAT as OPT_CTX_FLAT,
  CTX_HIT_COUNT as OPT_CTX_HIT_COUNT,
  CTX_HIT_SCALE as OPT_CTX_HIT_SCALE,
  CTX_LEVEL as OPT_CTX_LEVEL,
  CTX_MULTIPLIER as OPT_CTX_MULTIPLIER,
  CTX_NEGATIVE_EFFECT_CRIT_DMG as OPT_CTX_NEGATIVE_EFFECT_CRIT_DMG,
  CTX_NEGATIVE_EFFECT_CRIT_RATE as OPT_CTX_NEGATIVE_EFFECT_CRIT_RATE,
  CTX_SCALING_ATK as OPT_CTX_SCALING_ATK,
  CTX_SCALING_DEF as OPT_CTX_SCALING_DEF,
  CTX_SCALING_ER as OPT_CTX_SCALING_ER,
  CTX_SCALING_HP as OPT_CTX_SCALING_HP,
  CTX_SKILL_HEALING_BONUS as OPT_CTX_SKILL_HEALING_BONUS,
  CTX_SKILL_SHIELD_BONUS as OPT_CTX_SKILL_SHIELD_BONUS,
  CTX_STATIC_AMPLIFY as OPT_CTX_STATIC_AMPLIFY,
  CTX_STATIC_CRIT_DMG as OPT_CTX_STATIC_CRIT_DMG,
  CTX_STATIC_CRIT_RATE as OPT_CTX_STATIC_CRIT_RATE,
  CTX_STATIC_DEF_IGNORE as OPT_CTX_STATIC_DEF_IGNORE,
  CTX_STATIC_DEF_SHRED as OPT_CTX_STATIC_DEF_SHRED,
  CTX_STATIC_DMG_BONUS as OPT_CTX_STATIC_DMG_BONUS,
  CTX_STATIC_DMG_VULN as OPT_CTX_STATIC_DMG_VULN,
  CTX_STATIC_FINAL_ATK as OPT_CTX_STATIC_FINAL_ATK,
  CTX_STATIC_FINAL_DEF as OPT_CTX_STATIC_FINAL_DEF,
  CTX_STATIC_FINAL_ER as OPT_CTX_STATIC_FINAL_ER,
  CTX_STATIC_FINAL_HP as OPT_CTX_STATIC_FINAL_HP,
  CTX_STATIC_FLAT_DMG as OPT_CTX_STATIC_FLAT_DMG,
  CTX_STATIC_FUSION_BURST_MULTIPLIER as OPT_CTX_STATIC_FUSION_BURST_MULTIPLIER,
  CTX_STATIC_HEALING_BONUS as OPT_CTX_STATIC_HEALING_BONUS,
  CTX_STATIC_RES_SHRED as OPT_CTX_STATIC_RES_SHRED,
  CTX_STATIC_SHIELD_BONUS as OPT_CTX_STATIC_SHIELD_BONUS,
  CTX_STATIC_SPECIAL as OPT_CTX_STATIC_SPECIAL,
  CTX_STATIC_TUNE_BREAK_BOOST as OPT_CTX_STATIC_TUNE_BREAK_BOOST,
  CTX_TUNE_RUPTURE_CRIT_DMG as OPT_CTX_TUNE_RUPTURE_CRIT_DMG,
  CTX_TUNE_RUPTURE_CRIT_RATE as OPT_CTX_TUNE_RUPTURE_CRIT_RATE,
} from '@/engine/optimizer/context/vector.ts'
import { SET_LUT_SIZE as SET_CONST_LUT_SIZE } from '@/engine/optimizer/encode/layout.ts'

export interface ComboDamageResult {
  damage: number
  stats: OptimizerResultStats
  mainIndex: number
}

// convert raw enemy resistance percent into the actual damage multiplier
function resistanceMultiplier(enemyResPercent: number): number {
  if (enemyResPercent < 0) return 1 - enemyResPercent / 200
  if (enemyResPercent < 75) return 1 - enemyResPercent / 100
  return 1 / (1 + 5 * (enemyResPercent / 100))
}

// compute defense multiplier after def ignore and def shred are applied
function defenseMultiplier(characterLevel: number, enemyLevel: number, defIgnore: number, defShred: number): number {
  const enemyDefense = ((8 * enemyLevel) + 792) * (1 - (defIgnore + defShred) / 100)
  return (800 + 8 * characterLevel) / (800 + 8 * characterLevel + Math.max(0, enemyDefense))
}

// tune rupture uses enemy class scaling on top of normal multipliers
function classMultiplier(enemyClass: number): number {
  if (enemyClass === 3 || enemyClass === 4) return 14
  if (enemyClass === 2) return 3
  return 1
}

// compute resistance multiplier from packed base res + combo-added res shred
function computePackedResMultiplier(enemyBaseRes: number, resShred: number): number {
  return enemyBaseRes === 100
      ? 0
      : resistanceMultiplier(enemyBaseRes - resShred)
}

// build per-combo set counts while avoiding duplicate kind contributions
// inside the same set. touched ids are tracked so clearing is cheap later.
function buildComboSetState(
    scratch: CpuScratch,
    sets: Uint8Array,
    kinds: Uint16Array,
    comboIds: Int32Array,
): number {
  const setCounts = scratch.setCounts
  const touchedSetIds = scratch.touchedSetIds
  touchedSetIds.fill(0)

  let touchedSetCount = 0

  for (let index = 0; index < OPTIMIZER_ECHOS_PER_COMBO; index += 1) {
    const echoIndex = comboIds[index]
    const setId = sets[echoIndex]
    const kindId = kinds[echoIndex]

    // ignore invalid or out-of-range set ids
    if (setId < 0 || setId >= setCounts.length) {
      continue
    }

    // only count a set/kind pair once within the same combo
    let isDuplicateKind = false
    for (let previous = 0; previous < index; previous += 1) {
      const prevEchoIndex = comboIds[previous]
      if (sets[prevEchoIndex] === setId && kinds[prevEchoIndex] === kindId) {
        isDuplicateKind = true
        break
      }
    }
    if (isDuplicateKind) {
      continue
    }

    // first time this set appears in the combo, record it so we can clear later
    if (setCounts[setId] === 0) {
      touchedSetIds[touchedSetCount] = setId
      touchedSetCount += 1
    }

    setCounts[setId] += 1
  }

  return touchedSetCount
}

// reset only the set counters that were touched by the current combo
function clearComboSetState(scratch: CpuScratch, touchedSetCount: number): void {
  for (let index = 0; index < touchedSetCount; index += 1) {
    scratch.setCounts[scratch.touchedSetIds[index]] = 0
  }
}

// build the combo's base stat vector from raw encoded echoes, then apply set effects
function buildBaseComboVector(
    scratch: CpuScratch,
    stats: Float32Array,
    setConstLut: Float32Array,
    comboIds: Int32Array,
    touchedSetCount: number,
): Float32Array {
  const comboVector = scratch.baseComboVector
  comboVector.fill(0)

  // sum all encoded stats from the 5 chosen echoes
  for (let index = 0; index < OPTIMIZER_ECHOS_PER_COMBO; index += 1) {
    const echoIndex = comboIds[index]
    const statsBase = echoIndex * OPTIMIZER_STATS_PER_ECHO

    for (let offset = 0; offset < OPTIMIZER_STATS_PER_ECHO; offset += 1) {
      comboVector[offset] += stats[statsBase + offset]
    }
  }

  // inject 2pc / 5pc style encoded set effects into the summed vector
  applySetEffectsEncoded(comboVector, scratch.setCounts, scratch.touchedSetIds, touchedSetCount, setConstLut)

  return comboVector
}

// derive the per-main version of the combo vector by adding the chosen main echo buffs
function buildMainComboVector(
    scratch: CpuScratch,
    baseVector: Float32Array,
    mainEchoBuffs: Float32Array,
    mainEchoIndex: number,
): Float32Array {
  const comboVector = scratch.comboVector
  comboVector.set(baseVector)

  const mainBase = mainEchoIndex * OPTIMIZER_MAIN_ECHO_BUFFS_PER_ECHO
  for (let offset = 0; offset < OPTIMIZER_MAIN_ECHO_BUFFS_PER_ECHO; offset += 1) {
    comboVector[offset] += mainEchoBuffs[mainBase + offset]
  }

  return comboVector
}

// quick check used in rotation mode so we can skip constraint work entirely
// when every constraint range is effectively disabled
function areConstraintsDisabled(constraints: Float32Array): boolean {
  for (let index = 0; index < constraints.length; index += 2) {
    if ((constraints[index] ?? 0) <= (constraints[index + 1] ?? 0)) {
      return false
    }
  }

  return true
}

// materialize visible summary stats from a packed context + resolved combo vector
function fillResultStats(
    out: OptimizerResultStats,
    context: Float32Array,
    contextOffset: number,
    comboVector: Float32Array,
): void {
  out.atk =
      context[contextOffset + OPT_CTX_STATIC_FINAL_ATK] +
      (context[contextOffset + OPT_CTX_BASE_ATK] * comboVector[OPTIMIZER_VEC_ATK_PERCENT] / 100) +
      comboVector[OPTIMIZER_VEC_ATK_FLAT]

  out.hp =
      context[contextOffset + OPT_CTX_STATIC_FINAL_HP] +
      (context[contextOffset + OPT_CTX_BASE_HP] * comboVector[OPTIMIZER_VEC_HP_PERCENT] / 100) +
      comboVector[OPTIMIZER_VEC_HP_FLAT]

  out.def =
      context[contextOffset + OPT_CTX_STATIC_FINAL_DEF] +
      (context[contextOffset + OPT_CTX_BASE_DEF] * comboVector[OPTIMIZER_VEC_DEF_PERCENT] / 100) +
      comboVector[OPTIMIZER_VEC_DEF_FLAT]

  out.er = context[contextOffset + OPT_CTX_STATIC_FINAL_ER] + comboVector[OPTIMIZER_VEC_ENERGY_REGEN]
  out.cr = context[contextOffset + OPT_CTX_STATIC_CRIT_RATE] + comboVector[OPTIMIZER_VEC_CRIT_RATE]
  out.cd = context[contextOffset + OPT_CTX_STATIC_CRIT_DMG] + comboVector[OPTIMIZER_VEC_CRIT_DMG]
  out.bonus = context[contextOffset + OPT_CTX_STATIC_DMG_BONUS] + comboVector[OPTIMIZER_VEC_DMG_BONUS]
  out.amp = context[contextOffset + OPT_CTX_STATIC_AMPLIFY] + comboVector[OPTIMIZER_VEC_AMPLIFY]
}

// evaluate one packed context against one resolved combo vector
// this is the core cpu-side damage evaluator.
function evaluatePackedContextDamage(
    context: Float32Array,
    contextOffset: number,
    comboVector: Float32Array,
): number {
  const finalAtk =
      context[contextOffset + OPT_CTX_STATIC_FINAL_ATK] +
      (context[contextOffset + OPT_CTX_BASE_ATK] * comboVector[OPTIMIZER_VEC_ATK_PERCENT] / 100) +
      comboVector[OPTIMIZER_VEC_ATK_FLAT]

  const finalHp =
      context[contextOffset + OPT_CTX_STATIC_FINAL_HP] +
      (context[contextOffset + OPT_CTX_BASE_HP] * comboVector[OPTIMIZER_VEC_HP_PERCENT] / 100) +
      comboVector[OPTIMIZER_VEC_HP_FLAT]

  const finalDef =
      context[contextOffset + OPT_CTX_STATIC_FINAL_DEF] +
      (context[contextOffset + OPT_CTX_BASE_DEF] * comboVector[OPTIMIZER_VEC_DEF_PERCENT] / 100) +
      comboVector[OPTIMIZER_VEC_DEF_FLAT]

  const finalER = context[contextOffset + OPT_CTX_STATIC_FINAL_ER] + comboVector[OPTIMIZER_VEC_ENERGY_REGEN]

  const critRatePct = context[contextOffset + OPT_CTX_STATIC_CRIT_RATE] + comboVector[OPTIMIZER_VEC_CRIT_RATE]
  const critDmgPct = context[contextOffset + OPT_CTX_STATIC_CRIT_DMG] + comboVector[OPTIMIZER_VEC_CRIT_DMG]

  const healingBonusPct =
      context[contextOffset + OPT_CTX_STATIC_HEALING_BONUS] +
      comboVector[OPTIMIZER_VEC_HEALING_BONUS] +
      context[contextOffset + OPT_CTX_SKILL_HEALING_BONUS]

  const shieldBonusPct =
      context[contextOffset + OPT_CTX_STATIC_SHIELD_BONUS] +
      comboVector[OPTIMIZER_VEC_SHIELD_BONUS] +
      context[contextOffset + OPT_CTX_SKILL_SHIELD_BONUS]

  const damageBonusPct = context[contextOffset + OPT_CTX_STATIC_DMG_BONUS] + comboVector[OPTIMIZER_VEC_DMG_BONUS]
  const amplifyPct = context[contextOffset + OPT_CTX_STATIC_AMPLIFY] + comboVector[OPTIMIZER_VEC_AMPLIFY]
  const specialPct = context[contextOffset + OPT_CTX_STATIC_SPECIAL] + comboVector[OPTIMIZER_VEC_SPECIAL]

  const flatDmg =
      context[contextOffset + OPT_CTX_STATIC_FLAT_DMG] +
      comboVector[OPTIMIZER_VEC_FLAT_DMG] +
      context[contextOffset + OPT_CTX_FLAT]

  const resShred = context[contextOffset + OPT_CTX_STATIC_RES_SHRED] + comboVector[OPTIMIZER_VEC_RES_SHRED]
  const defIgnore = context[contextOffset + OPT_CTX_STATIC_DEF_IGNORE] + comboVector[OPTIMIZER_VEC_DEF_IGNORE]
  const defShred = context[contextOffset + OPT_CTX_STATIC_DEF_SHRED] + comboVector[OPTIMIZER_VEC_DEF_SHRED]
  const dmgVulnPct = context[contextOffset + OPT_CTX_STATIC_DMG_VULN] + comboVector[OPTIMIZER_VEC_DMG_VULN]

  const fusionBurstMultiplier =
      context[contextOffset + OPT_CTX_STATIC_FUSION_BURST_MULTIPLIER] +
      comboVector[OPTIMIZER_VEC_FUSION_BURST_MULTIPLIER]

  const tuneBreakBoostPct =
      context[contextOffset + OPT_CTX_STATIC_TUNE_BREAK_BOOST] +
      comboVector[OPTIMIZER_VEC_TUNE_BREAK_BOOST]

  const resMult = computePackedResMultiplier(context[contextOffset + OPT_CTX_ENEMY_BASE_RES], resShred)

  const defMult = defenseMultiplier(
      context[contextOffset + OPT_CTX_LEVEL],
      context[contextOffset + OPT_CTX_ENEMY_LEVEL],
      defIgnore,
      defShred,
  )

  const critRate = Math.max(0, Math.min(1, critRatePct / 100))
  const critDmg = critDmgPct / 100

  // generic stat-scaling term shared by most archetypes
  const scaledValue =
      finalAtk * context[contextOffset + OPT_CTX_SCALING_ATK] +
      finalHp * context[contextOffset + OPT_CTX_SCALING_HP] +
      finalDef * context[contextOffset + OPT_CTX_SCALING_DEF] +
      finalER * context[contextOffset + OPT_CTX_SCALING_ER]

  switch (context[contextOffset + OPT_CTX_ARCHETYPE]) {
    case OPTIMIZER_ARCHETYPE_HEALING: {
      const total =
          ((scaledValue * context[contextOffset + OPT_CTX_MULTIPLIER]) + flatDmg) *
          (1 + healingBonusPct / 100)

      return Math.max(1, Math.floor(total))
    }

    case OPTIMIZER_ARCHETYPE_SHIELD: {
      const total =
          ((scaledValue * context[contextOffset + OPT_CTX_MULTIPLIER]) + flatDmg) *
          (1 + shieldBonusPct / 100)

      return Math.max(1, Math.floor(total))
    }

    case OPTIMIZER_ARCHETYPE_TUNE_RUPTURE: {
      const normal =
          context[contextOffset + OPT_CTX_HIT_SCALE] *
          getTuneRuptureLevelScale(context[contextOffset + OPT_CTX_LEVEL]) *
          classMultiplier(context[contextOffset + OPT_CTX_ENEMY_CLASS]) *
          resMult *
          defMult *
          (1 + dmgVulnPct / 100) *
          (1 + damageBonusPct / 100) *
          (1 + amplifyPct / 100) *
          (1 + tuneBreakBoostPct / 100)

      const crit = normal * context[contextOffset + OPT_CTX_TUNE_RUPTURE_CRIT_DMG]

      return context[contextOffset + OPT_CTX_TUNE_RUPTURE_CRIT_RATE] >= 1
          ? crit
          : (crit * context[contextOffset + OPT_CTX_TUNE_RUPTURE_CRIT_RATE]) +
          (normal * (1 - context[contextOffset + OPT_CTX_TUNE_RUPTURE_CRIT_RATE]))
    }

    case OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE:
    case OPTIMIZER_ARCHETYPE_AERO_EROSION:
    case OPTIMIZER_ARCHETYPE_FUSION_BURST: {
      const archetype = context[contextOffset + OPT_CTX_ARCHETYPE]

      const stacks =
          archetype === OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE
              ? context[contextOffset + OPT_CTX_COMBAT_SPECTRO_FRAZZLE]
              : archetype === OPTIMIZER_ARCHETYPE_AERO_EROSION
                  ? context[contextOffset + OPT_CTX_COMBAT_AERO_EROSION]
                  : context[contextOffset + OPT_CTX_COMBAT_FUSION_BURST]

      if (stacks <= 0) {
        return 0
      }

      const perStackBase = getNegativeEffectBase(
          archetype === OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE
              ? 'spectroFrazzle'
              : archetype === OPTIMIZER_ARCHETYPE_AERO_EROSION
                  ? 'aeroErosion'
                  : 'fusionBurst',
          context[contextOffset + OPT_CTX_LEVEL],
          stacks,
      )

      const normal = Math.floor(
          perStackBase *
          context[contextOffset + OPT_CTX_HIT_SCALE] *
          (archetype === OPTIMIZER_ARCHETYPE_FUSION_BURST ? (1 + fusionBurstMultiplier) : 1) *
          (1 + amplifyPct / 100) *
          (1 + damageBonusPct / 100) *
          (1 + specialPct / 100) *
          resMult *
          defMult *
          (1 + dmgVulnPct / 100),
      )

      const crit = normal * context[contextOffset + OPT_CTX_NEGATIVE_EFFECT_CRIT_DMG]

      return context[contextOffset + OPT_CTX_NEGATIVE_EFFECT_CRIT_RATE] >= 1
          ? crit
          : (crit * context[contextOffset + OPT_CTX_NEGATIVE_EFFECT_CRIT_RATE]) +
          (normal * (1 - context[contextOffset + OPT_CTX_NEGATIVE_EFFECT_CRIT_RATE]))
    }

    case OPTIMIZER_ARCHETYPE_DAMAGE:
    default: {
      // fixed damage ignores normal stat-scaling and crit calculations
      if (context[contextOffset + OPT_CTX_FIXED_DMG] > 0) {
        return Math.max(1, Math.floor(context[contextOffset + OPT_CTX_FIXED_DMG]))
      }

      const normal =
          (scaledValue * context[contextOffset + OPT_CTX_MULTIPLIER] +
              flatDmg * context[contextOffset + OPT_CTX_HIT_COUNT]) *
          resMult *
          defMult *
          (1 + dmgVulnPct / 100) *
          (1 + damageBonusPct / 100) *
          (1 + amplifyPct / 100) *
          (1 + specialPct / 100)

      const crit = normal * critDmg
      return critRate >= 1 ? crit : (crit * critRate) + (normal * (1 - critRate))
    }
  }
}

// create scratch state once and reuse it across combo evaluations
export function createComboDamageScratch(): CpuScratch {
  return createCpuScratch()
}

// evaluate one target-skill combo across every possible main echo in that combo
// and return the best passing result.
export function evaluateTargetSkillCombo(options: {
  context: Float32Array
  stats: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  constraints: Float32Array
  comboIds: Int32Array
  lockedMainIndex: number
  scratch: CpuScratch
}): ComboDamageResult | null {
  const {
    context,
    stats,
    sets,
    kinds,
    setConstLut,
    mainEchoBuffs,
    constraints,
    comboIds,
    lockedMainIndex,
    scratch,
  } = options

  const touchedSetCount = buildComboSetState(scratch, sets, kinds, comboIds)
  const baseVector = buildBaseComboVector(scratch, stats, setConstLut, comboIds, touchedSetCount)

  let bestDamage = 0
  let bestMainIndex = -1
  let bestStats: OptimizerResultStats | null = null

  for (let index = 0; index < comboIds.length; index += 1) {
    const mainIndex = comboIds[index]

    // when main is locked, only evaluate that one candidate
    if (lockedMainIndex >= 0 && mainIndex !== lockedMainIndex) {
      continue
    }

    const comboVector = buildMainComboVector(scratch, baseVector, mainEchoBuffs, mainIndex)
    const damage = evaluatePackedContextDamage(context, 0, comboVector)

    if (damage <= 0) {
      continue
    }

    const resultStats: OptimizerResultStats = {
      atk: 0,
      hp: 0,
      def: 0,
      er: 0,
      cr: 0,
      cd: 0,
      bonus: 0,
      amp: 0,
    }

    fillResultStats(resultStats, context, 0, comboVector)

    const passes = passesConstraints(
        constraints,
        resultStats.atk,
        resultStats.hp,
        resultStats.def,
        resultStats.cr,
        resultStats.cd,
        resultStats.er,
        resultStats.bonus,
        damage,
    )

    // keep only the best passing main-echo choice
    if (!passes || damage <= bestDamage) {
      continue
    }

    bestDamage = damage
    bestMainIndex = mainIndex
    bestStats = resultStats
  }

  clearComboSetState(scratch, touchedSetCount)

  return bestStats && bestMainIndex >= 0
      ? { damage: bestDamage, stats: bestStats, mainIndex: bestMainIndex }
      : null
}

// evaluate one combo in rotation mode.
// each packed context contributes weighted damage, then one display context
// is used to derive visible stats for the chosen best main echo.
export function evaluateRotationCombo(options: {
  contextStride: number
  contextCount: number
  contexts: Float32Array
  weights: Float32Array
  statsByContext: Float32Array
  setConstLutByContext: Float32Array
  mainEchoBuffsByContext: Float32Array
  displayContext: Float32Array
  displayStats: Float32Array
  displaySetConstLut: Float32Array
  displayMainEchoBuffs: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  constraints: Float32Array
  comboIds: Int32Array
  lockedMainIndex: number
  scratch: CpuScratch
}): ComboDamageResult | null {
  const {
    contextStride,
    contextCount,
    contexts,
    weights,
    statsByContext,
    setConstLutByContext,
    mainEchoBuffsByContext,
    displayContext,
    displayStats,
    displaySetConstLut,
    displayMainEchoBuffs,
    sets,
    kinds,
    constraints,
    comboIds,
    lockedMainIndex,
    scratch,
  } = options

  const touchedSetCount = buildComboSetState(scratch, sets, kinds, comboIds)

  const perContextStatsStride = sets.length * OPTIMIZER_STATS_PER_ECHO
  const perContextMainBuffStride = sets.length * OPTIMIZER_MAIN_ECHO_BUFFS_PER_ECHO
  const perContextSetLutStride = SET_CONST_LUT_SIZE

  const constraintsDisabled = areConstraintsDisabled(constraints)

  // total damage accumulated for each possible main echo position in the combo
  const totalDamageByMain = [0, 0, 0, 0, 0]

  let bestDamage = 0
  let bestMainIndex = -1
  let bestStats: OptimizerResultStats | null = null

  // first pass: accumulate weighted damage from every rotation context
  for (let index = 0; index < contextCount; index += 1) {
    const weight = weights[index] ?? 1
    if (!weight) {
      continue
    }

    const baseVector = buildBaseComboVector(
        scratch,
        statsByContext.subarray(index * perContextStatsStride, (index + 1) * perContextStatsStride),
        setConstLutByContext.subarray(index * perContextSetLutStride, (index + 1) * perContextSetLutStride),
        comboIds,
        touchedSetCount,
    )

    const mainEchoBuffs = mainEchoBuffsByContext.subarray(
        index * perContextMainBuffStride,
        (index + 1) * perContextMainBuffStride,
    )

    for (let comboIndex = 0; comboIndex < comboIds.length; comboIndex += 1) {
      const mainIndex = comboIds[comboIndex]

      if (lockedMainIndex >= 0 && mainIndex !== lockedMainIndex) {
        continue
      }

      const comboVector = buildMainComboVector(
          scratch,
          baseVector,
          mainEchoBuffs,
          mainIndex,
      )

      const damage = evaluatePackedContextDamage(contexts, index * contextStride, comboVector)

      if (damage > 0) {
        totalDamageByMain[comboIndex] += damage * weight
      }
    }
  }

  // second pass uses the display context only for visible stat extraction
  const displayBaseVector = buildBaseComboVector(
      scratch,
      displayStats,
      displaySetConstLut,
      comboIds,
      touchedSetCount,
  )

  for (let comboIndex = 0; comboIndex < comboIds.length; comboIndex += 1) {
    const mainIndex = comboIds[comboIndex]

    if (lockedMainIndex >= 0 && mainIndex !== lockedMainIndex) {
      continue
    }

    const totalDamage = totalDamageByMain[comboIndex] ?? 0
    if (totalDamage <= 0) {
      continue
    }

    // fast path: when constraints are disabled, skip stat extraction for clearly worse results
    if (constraintsDisabled && totalDamage <= bestDamage) {
      continue
    }

    const displayVector = buildMainComboVector(scratch, displayBaseVector, displayMainEchoBuffs, mainIndex)

    const resultStats: OptimizerResultStats = {
      atk: 0,
      hp: 0,
      def: 0,
      er: 0,
      cr: 0,
      cd: 0,
      bonus: 0,
      amp: 0,
    }

    fillResultStats(resultStats, displayContext, 0, displayVector)

    if (totalDamage <= bestDamage) {
      continue
    }

    if (
        !constraintsDisabled &&
        !passesConstraints(
            constraints,
            resultStats.atk,
            resultStats.hp,
            resultStats.def,
            resultStats.cr,
            resultStats.cd,
            resultStats.er,
            resultStats.bonus,
            totalDamage,
        )
    ) {
      continue
    }

    bestDamage = totalDamage
    bestMainIndex = mainIndex
    bestStats = resultStats
  }

  clearComboSetState(scratch, touchedSetCount)

  return bestStats && bestMainIndex >= 0
      ? { damage: bestDamage, stats: bestStats, mainIndex: bestMainIndex }
      : null
}

export { OPTIMIZER_PACKED_CONTEXT_STRIDE }
