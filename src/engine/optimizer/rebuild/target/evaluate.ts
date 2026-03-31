/*
  Author: Runor Ewhro
  Description: evaluates a single already-chosen optimizer combo against a
               packed target context, reconstructs final combat stats from
               echo rows + set rows + main-echo bonuses, and returns the
               resulting damage/stat snapshot if all constraints pass.
*/

import type { OptimizerResultStats } from '@/engine/optimizer/types'
import {
  OPTIMIZER_ARCHETYPE_AERO_EROSION,
  OPTIMIZER_ARCHETYPE_DAMAGE,
  OPTIMIZER_ARCHETYPE_FUSION_BURST,
  OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE,
  OPTIMIZER_ARCHETYPE_TUNE_RUPTURE,
  OPTIMIZER_CONTEXT_FLOATS,
  OPTIMIZER_CTX_ARCHETYPE,
  OPTIMIZER_CTX_AUX0,
  OPTIMIZER_CTX_BASE_ATK,
  OPTIMIZER_CTX_BASE_DEF,
  OPTIMIZER_CTX_BASE_ER,
  OPTIMIZER_CTX_BASE_HP,
  OPTIMIZER_CTX_CRIT_DMG,
  OPTIMIZER_CTX_CRIT_RATE,
  OPTIMIZER_CTX_DEF_MULT,
  OPTIMIZER_CTX_DMG_AMPLIFY,
  OPTIMIZER_CTX_DMG_BONUS,
  OPTIMIZER_CTX_DMG_REDUCTION,
  OPTIMIZER_CTX_FINAL_ATK,
  OPTIMIZER_CTX_FINAL_DEF,
  OPTIMIZER_CTX_FINAL_HP,
  OPTIMIZER_CTX_FLAT_DMG,
  OPTIMIZER_CTX_LOCKED_PACKED,
  OPTIMIZER_CTX_META0,
  OPTIMIZER_CTX_MULTIPLIER,
  OPTIMIZER_CTX_RES_MULT,
  OPTIMIZER_CTX_SCALING_ATK,
  OPTIMIZER_CTX_SCALING_DEF,
  OPTIMIZER_CTX_SCALING_ER,
  OPTIMIZER_CTX_SCALING_HP,
  OPTIMIZER_CTX_SET_RUNTIME_MASK,
  OPTIMIZER_CTX_SKILL_ID,
  OPTIMIZER_CTX_DMG_VULN,
  OPTIMIZER_CTX_TOGGLES,
} from '@/engine/optimizer/constants'
import {
  applySetEffectsEncoded as applyLegacySetEffectsEncoded,
  SET_RUNTIME_TOGGLE_ALL,
  SET_RUNTIME_TOGGLE_SET14_FIVE,
} from '@/engine/optimizer/rebuild/encode/sets'

// packed row sizes used by the legacy evaluator
const STATS_PER_ECHO = 20
const MAIN_BUFFS_PER_ECHO = 15
const SET_SLOTS = 32

// popcount helper for set bitmasks used to track unique echo kinds per set
function countOneBits(x: number): number {
  let value = x >>> 0
  value = value - ((value >>> 1) & 0x55555555)
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

// shared min/max range test
function passesConstraints(
    constraints: Float32Array,
    finalAtk: number,
    finalHp: number,
    finalDef: number,
    critRate: number,
    critDmg: number,
    finalER: number,
    dmgBonus: number,
    damage: number,
): boolean {
  const inRange = (value: number, minValue: number, maxValue: number) =>
      minValue > maxValue || (value >= minValue && value <= maxValue)

  return (
      inRange(finalAtk, constraints[0], constraints[1]) &&
      inRange(finalHp, constraints[2], constraints[3]) &&
      inRange(finalDef, constraints[4], constraints[5]) &&
      inRange(critRate, constraints[6], constraints[7]) &&
      inRange(critDmg, constraints[8], constraints[9]) &&
      inRange(finalER, constraints[10], constraints[11]) &&
      inRange(dmgBonus, constraints[12], constraints[13]) &&
      inRange(damage, constraints[14], constraints[15])
  )
}

// character 1206 converts excess er into atk
function calc1206ErToAtk(charId: number, finalER: number, toggle0: number): number {
  if (charId !== 1206) return 0
  const erOver = Math.max(0, finalER - 150)
  return toggle0 ? Math.min(erOver * 20, 2600) : Math.min(erOver * 12, 1560)
}

// character 1306 converts excess crit rate into crit dmg
function calc1306CritConversion(charId: number, sequence: number, critRateTotal: number): number {
  if (charId !== 1306 || sequence < 2) return 0

  let bonusCd = 0

  if (critRateTotal >= 1) {
    const excess = critRateTotal - 1
    bonusCd += Math.min(excess * 2, 1)
  }

  if (sequence >= 6 && critRateTotal >= 1.5) {
    const excess = critRateTotal - 1.5
    bonusCd += Math.min(excess * 2, 0.5)
  }

  return bonusCd
}

// character 1412 gains echo-skill bonus from excess er
function calc1412Conversion(charId: number, finalER: number): number {
  if (charId !== 1412 || finalER <= 125) return 0
  return Math.min((finalER - 125) * 2, 50) / 100
}

// unpack the packed target context into a more readable object
function buildPreparedContext(context: Float32Array) {
  if (context.length !== OPTIMIZER_CONTEXT_FLOATS) {
    throw new Error(`Legacy target context length mismatch: expected ${OPTIMIZER_CONTEXT_FLOATS}, received ${context.length}`)
  }

  const u32 = new Uint32Array(context.buffer, context.byteOffset, context.length)
  const skillId = u32[OPTIMIZER_CTX_SKILL_ID] >>> 0
  const skillMask = skillId & 0x7fff
  const elementIdx = Math.max(0, Math.min(5, (skillId >>> 15) & 0x7))
  const meta0 = u32[OPTIMIZER_CTX_META0] >>> 0
  const lockedPacked = u32[OPTIMIZER_CTX_LOCKED_PACKED] >>> 0
  const togglesBits = u32[OPTIMIZER_CTX_TOGGLES] >>> 0
  const packedRuntimeMask = u32[OPTIMIZER_CTX_SET_RUNTIME_MASK] >>> 0

  // older callers may leave runtime mask at 0, so fall back to "all active"
  const setRuntimeMask = packedRuntimeMask !== 0 ? packedRuntimeMask : SET_RUNTIME_TOGGLE_ALL

  return {
    archetype: context[OPTIMIZER_CTX_ARCHETYPE],
    skillId,
    skillMask,
    elementIdx,
    charId: meta0 & 0xfff,
    sequence: (meta0 >>> 12) & 0xf,
    lockedEchoIndex: lockedPacked === 0 ? -1 : ((lockedPacked - 1) | 0),
    toggle0: (togglesBits & 1) ? 1 : 0,
    setRuntimeMask,
    set14FiveEnabled: (setRuntimeMask & SET_RUNTIME_TOGGLE_SET14_FIVE) !== 0,
    baseAtk: context[OPTIMIZER_CTX_BASE_ATK],
    baseHp: context[OPTIMIZER_CTX_BASE_HP],
    baseDef: context[OPTIMIZER_CTX_BASE_DEF],
    baseER: context[OPTIMIZER_CTX_BASE_ER],
    finalAtk: context[OPTIMIZER_CTX_FINAL_ATK],
    finalHp: context[OPTIMIZER_CTX_FINAL_HP],
    finalDef: context[OPTIMIZER_CTX_FINAL_DEF],
    critRate: context[OPTIMIZER_CTX_CRIT_RATE],
    critDmg: context[OPTIMIZER_CTX_CRIT_DMG],
    scalingAtk: context[OPTIMIZER_CTX_SCALING_ATK],
    scalingHp: context[OPTIMIZER_CTX_SCALING_HP],
    scalingDef: context[OPTIMIZER_CTX_SCALING_DEF],
    scalingER: context[OPTIMIZER_CTX_SCALING_ER],
    multiplier: context[OPTIMIZER_CTX_MULTIPLIER],
    flatDmg: context[OPTIMIZER_CTX_FLAT_DMG],
    resMult: context[OPTIMIZER_CTX_RES_MULT],
    defMult: context[OPTIMIZER_CTX_DEF_MULT],
    dmgReduction: context[OPTIMIZER_CTX_DMG_REDUCTION],
    dmgBonus: context[OPTIMIZER_CTX_DMG_BONUS],
    dmgAmplify: context[OPTIMIZER_CTX_DMG_AMPLIFY],
    dmgVulnPct: context[OPTIMIZER_CTX_DMG_VULN],
    aux0: context[OPTIMIZER_CTX_AUX0],
  }
}

// compute unique set-piece counts for the chosen combo
function buildComboSetCounts(
    sets: Uint8Array,
    kinds: Uint16Array,
    comboIds: Int32Array,
): Uint8Array {
  const setCounts = new Uint8Array(SET_SLOTS)
  const setMask = new Uint32Array(SET_SLOTS)

  for (let index = 0; index < comboIds.length; index += 1) {
    const echoIndex = comboIds[index]
    const setId = sets[echoIndex]
    if (setId < 0 || setId >= SET_SLOTS) {
      continue
    }

    // kind ids ensure duplicate echoes of the same kind do not overcount set pieces
    const bit = (1 << (kinds[echoIndex] & 31)) >>> 0
    setMask[setId] |= bit
  }

  for (let setId = 0; setId < SET_SLOTS; setId += 1) {
    setCounts[setId] = countOneBits(setMask[setId])
  }

  return setCounts
}

// sum all raw echo stat rows for the chosen combo before main-echo bonuses
function buildBaseStats(stats: Float32Array, comboIds: Int32Array) {
  let atkP = 0
  let atkF = 0
  let hpP = 0
  let hpF = 0
  let defP = 0
  let defF = 0
  let critRate = 0
  let critDmg = 0
  let er = 0
  let basic = 0
  let heavy = 0
  let skill = 0
  let lib = 0
  let aero = 0
  let spectro = 0
  let fusion = 0
  let glacio = 0
  let havoc = 0
  let electro = 0

  for (let index = 0; index < comboIds.length; index += 1) {
    const echoIndex = comboIds[index]
    const base = echoIndex * STATS_PER_ECHO

    atkP += stats[base]
    atkF += stats[base + 1]
    hpP += stats[base + 2]
    hpF += stats[base + 3]
    defP += stats[base + 4]
    defF += stats[base + 5]
    critRate += stats[base + 6]
    critDmg += stats[base + 7]
    er += stats[base + 8]
    basic += stats[base + 10]
    heavy += stats[base + 11]
    skill += stats[base + 12]
    lib += stats[base + 13]
    aero += stats[base + 14]
    spectro += stats[base + 15]
    fusion += stats[base + 16]
    glacio += stats[base + 17]
    havoc += stats[base + 18]
    electro += stats[base + 19]
  }

  return {
    atkP,
    atkF,
    hpP,
    hpF,
    defP,
    defF,
    critRate,
    critDmg,
    er,
    basic,
    heavy,
    skill,
    lib,
    aero,
    spectro,
    fusion,
    glacio,
    havoc,
    electro,
  }
}

// select the combined element bonus bucket that matches the target skill element
function selectSetElementBonus(
    base: ReturnType<typeof buildBaseStats>,
    setBonus: ReturnType<typeof applyLegacySetEffectsEncoded>,
    elementIdx: number,
): number {
  switch (elementIdx) {
    case 0: return base.aero + setBonus.aero
    case 1: return base.glacio + setBonus.glacio
    case 2: return base.fusion + setBonus.fusion
    case 3: return base.spectro + setBonus.spectro
    case 4: return base.havoc + setBonus.havoc
    default: return base.electro + setBonus.electro
  }
}

// select the chosen main echo's element-specific bonus bucket
function selectMainElementBonus(
    mainEchoBuffs: Float32Array,
    base: number,
    elementIdx: number,
): number {
  switch (elementIdx) {
    case 0: return mainEchoBuffs[base + 6]
    case 1: return mainEchoBuffs[base + 7]
    case 2: return mainEchoBuffs[base + 8]
    case 3: return mainEchoBuffs[base + 9]
    case 4: return mainEchoBuffs[base + 10]
    default: return mainEchoBuffs[base + 11]
  }
}

// sum all skill-type-specific bonus buckets that apply to this target skill
function selectSkillTypeBonus(
    base: ReturnType<typeof buildBaseStats>,
    setBonus: ReturnType<typeof applyLegacySetEffectsEncoded>,
    skillMask: number,
): number {
  return (
      ((skillMask >>> 0) & 1 ? base.basic + setBonus.basic : 0) +
      ((skillMask >>> 1) & 1 ? base.heavy + setBonus.heavy : 0) +
      ((skillMask >>> 2) & 1 ? base.skill + setBonus.skill : 0) +
      ((skillMask >>> 3) & 1 ? base.lib + setBonus.lib : 0) +
      ((skillMask >>> 6) & 1 ? setBonus.echoSkill : 0) +
      ((skillMask >>> 7) & 1 ? setBonus.coord : 0)
  )
}

export function evalTarget(options: {
  context: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  constraints?: Float32Array
  comboIds: Int32Array
  mainIndex: number
}): { damage: number; stats: OptimizerResultStats } | null {
  const {
    context,
    stats,
    setConstLut,
    mainEchoBuffs,
    sets,
    kinds,
    constraints,
    comboIds,
    mainIndex,
  } = options

  const prepared = buildPreparedContext(context)
  const setCounts = buildComboSetCounts(sets, kinds, comboIds)
  const base = buildBaseStats(stats, comboIds)

  // apply all unconditional + skill-aware set effects for this exact combo
  const setBonus = applyLegacySetEffectsEncoded(setCounts, prepared.skillMask, setConstLut, prepared.setRuntimeMask)

  const finalHpBase =
      prepared.baseHp * ((base.hpP + setBonus.hpP) / 100) +
      base.hpF +
      setBonus.hpF +
      prepared.finalHp

  const finalDefBase =
      prepared.baseDef * ((base.defP + setBonus.defP) / 100) +
      base.defF +
      setBonus.defF +
      prepared.finalDef

  const atkBaseTerm =
      prepared.baseAtk * ((base.atkP + setBonus.atkP) / 100) +
      base.atkF +
      setBonus.atkF +
      prepared.finalAtk

  const finalERBase = prepared.baseER + base.er + setBonus.erSetBonus

  const critRateTotal = prepared.critRate + ((base.critRate + setBonus.critRate) / 100)
  let critDmgTotal = prepared.critDmg + ((base.critDmg + setBonus.critDmg) / 100)

  if (prepared.charId === 1306) {
    critDmgTotal += calc1306CritConversion(prepared.charId, prepared.sequence, critRateTotal)
  }

  // shared damage-bonus pool before applying chosen main echo bonuses
  const bonusBaseTotal =
      setBonus.bonusBase +
      selectSetElementBonus(base, setBonus, prepared.elementIdx) +
      selectSkillTypeBonus(base, setBonus, prepared.skillMask)

  const mainBase = mainIndex * MAIN_BUFFS_PER_ECHO
  const mainAtkP = mainEchoBuffs[mainBase]
  const mainAtkF = mainEchoBuffs[mainBase + 1]
  const mainER = mainEchoBuffs[mainBase + 12]
  const finalER = finalERBase + mainER

  // conditional set 14 bonus only matters when enabled and the er threshold is met
  const set14Active = prepared.set14FiveEnabled && setCounts[14] >= 5
  const s14ErBonus = set14Active && finalER >= 250 ? 30 : 0

  // add all chosen-main-echo bonuses that match the current skill
  let bonus = bonusBaseTotal + s14ErBonus + selectMainElementBonus(mainEchoBuffs, mainBase, prepared.elementIdx)
  bonus += mainEchoBuffs[mainBase + 2] * ((prepared.skillMask >>> 0) & 1)
  bonus += mainEchoBuffs[mainBase + 3] * ((prepared.skillMask >>> 1) & 1)
  bonus += mainEchoBuffs[mainBase + 4] * ((prepared.skillMask >>> 2) & 1)
  bonus += mainEchoBuffs[mainBase + 5] * ((prepared.skillMask >>> 3) & 1)
  bonus += mainEchoBuffs[mainBase + 13] * ((prepared.skillMask >>> 6) & 1)
  bonus += mainEchoBuffs[mainBase + 14] * ((prepared.skillMask >>> 7) & 1)

  const dmgBonus =
      prepared.dmgBonus +
      (bonus / 100) +
      (calc1412Conversion(prepared.charId, finalER) * ((prepared.skillMask >>> 6) & 1))

  // rebuild final atk from base row + chosen main echo
  let finalAtk = atkBaseTerm + (prepared.baseAtk * (mainAtkP / 100)) + mainAtkF
  finalAtk += calc1206ErToAtk(prepared.charId, finalER, prepared.toggle0)

  // 1209 adds conditional er-based bonuses
  let mornyeDmgBonus = 0
  let critRateBonus = 0
  let critDmgBonus = 0
  if (prepared.charId === 1209 && finalER > 0) {
    const erOver = Math.max(0, finalER - 100)
    mornyeDmgBonus = Math.min(erOver * 0.25, 40) / 100

    if (((prepared.skillMask >>> 3) & 1) !== 0) {
      critRateBonus = Math.min(erOver * 0.5, 80) / 100
      critDmgBonus = Math.min(erOver, 160) / 100
    }
  }

  // final stat-scaled value used by regular damage archetypes
  const scaled =
      (finalHpBase * prepared.scalingHp) +
      (finalDefBase * prepared.scalingDef) +
      (finalAtk * prepared.scalingAtk) +
      (finalER * prepared.scalingER)

  let avg
  let statCritRate = critRateTotal
  let statCritDmg = critDmgTotal
  let statBonus = dmgBonus
  const statAmp = prepared.dmgAmplify

  // evaluate by archetype because tune rupture / negative effects use packed formulas
  switch (prepared.archetype) {
    case OPTIMIZER_ARCHETYPE_TUNE_RUPTURE: {
      const normal =
          prepared.multiplier *
          prepared.resMult *
          prepared.defMult *
          prepared.dmgReduction *
          prepared.dmgBonus *
          prepared.dmgAmplify *
          prepared.aux0

      const critRate = Math.max(0, Math.min(1, prepared.critRate))
      const critDmg = prepared.critDmg
      avg = (critRate * (normal * critDmg)) + ((1 - critRate) * normal)

      statCritRate = prepared.critRate
      statCritDmg = prepared.critDmg
      statBonus = prepared.dmgBonus
      break
    }

    case OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE:
    case OPTIMIZER_ARCHETYPE_AERO_EROSION:
    case OPTIMIZER_ARCHETYPE_FUSION_BURST: {
      const normal = Math.floor(
          prepared.multiplier *
          prepared.resMult *
          prepared.defMult *
          prepared.dmgReduction *
          prepared.dmgBonus *
          prepared.dmgAmplify *
          prepared.aux0,
      )

      const critRate = Math.max(0, Math.min(1, prepared.critRate))
      const critDmg = prepared.critDmg
      avg = (critRate * (normal * critDmg)) + ((1 - critRate) * normal)

      statCritRate = prepared.critRate
      statCritDmg = prepared.critDmg
      statBonus = prepared.dmgBonus
      break
    }

    case OPTIMIZER_ARCHETYPE_DAMAGE:
    default: {
      const baseMul =
          prepared.resMult *
          prepared.defMult *
          prepared.dmgReduction *
          prepared.dmgAmplify *
          prepared.aux0

      const baseDamage =
          (scaled * prepared.multiplier + prepared.flatDmg) *
          baseMul *
          (dmgBonus + (mornyeDmgBonus * prepared.toggle0))

      const critRateForDamage = Math.max(0, Math.min(1, critRateTotal + critRateBonus))
      const critDmgForDamage = critDmgTotal + critDmgBonus
      const critHit = baseDamage * critDmgForDamage
      avg = (critRateForDamage * critHit) + ((1 - critRateForDamage) * baseDamage)
      break
    }
  }

  // reject this evaluation if constraints are present and any stat window fails
  if (constraints && !passesConstraints(
      constraints,
      finalAtk,
      finalHpBase,
      finalDefBase,
      statCritRate,
      statCritDmg,
      finalER,
      statBonus,
      avg,
  )) {
    return null
  }

  return {
    damage: avg,
    stats: {
      atk: finalAtk,
      hp: finalHpBase,
      def: finalDefBase,
      er: finalER,
      cr: statCritRate * 100,
      cd: statCritDmg * 100,
      bonus: (statBonus - 1) * 100,
      amp: (statAmp - 1) * 100,
    },
  }
}