/*
  Author: Runor Ewhro
  Description: evaluates a single already-chosen optimizer combo against a
               packed target context, reconstructs final combat stats from
               echo rows + set rows + main-echo bonuses, and returns the
               resulting damage/stat snapshot if all constraints pass.
*/

import type { OptResultStats } from '@/engine/optimizer/types.ts'
import { psssCstrs } from '@/engine/optimizer/constraints/statConstraints.ts'
import {
  ARCH_AERO,
  ARCH_DAMAGE,
  ARCH_ELECTRO,
  ARCH_FUSION,
  ARCH_GLACIO,
  ARCH_HACK,
  ARCH_SPECTRO,
  ARCH_TUNE,
  CTX_FLOATS,
  ARCHETYPE,
  AUX0,
  BASE_ATK,
  BASE_DEF,
  BASE_ER,
  BASE_HP,
  CRIT_DMG,
  CRIT_RATE,
  DEF_MUL,
  DMG_AMP,
  DMG_BNS,
  DMG_RED,
  FINAL_ATK,
  FINAL_DEF,
  FINAL_HP,
  FLAT_DMG,
  LOCKED_PACKED,
  META0,
  MV,
  RES_MUL,
  SCALING_ATK,
  SCALING_DEF,
  SCALING_ER,
  SCALING_HP,
  SET_MASK,
  SKILL_ID,
  DMG_VULN,
  TOGGLES,
  ECHO_STAT_STRIDE,
  MAIN_BUFF_LEN,
  SET_SLOT_COUNT,
} from '@/engine/optimizer/config/constants.ts'
import {
  applySetVec as applySetF,
  SETRTTGLALL,
  SETRTTGLST14,
} from '@/engine/optimizer/encode/sets.ts'

// popcount helper for set bitmasks used to track unique echo kinds per set
function countOneBits(x: number): number {
  let value = x >>> 0
  value = value - ((value >>> 1) & 0x55555555)
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

// character 1206 converts excess er into atk
function calcErToAtk(charId: number, finalER: number, toggle0: number): number {
  if (charId !== 1206) return 0
  const erOver = Math.max(0, finalER - 150)
  return toggle0 ? Math.min(erOver * 20, 2600) : Math.min(erOver * 12, 1560)
}

// character 1306 converts excess crit rate into crit dmg
function calcCritConvert(charId: number, sequence: number, critRateTotal: number): number {
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
function calcConvert(charId: number, finalER: number): number {
  if (charId !== 1412 || finalER <= 125) return 0
  return Math.min((finalER - 125) * 2, 50) / 100
}

// unpack the packed target context into a more readable object
function mkPrepCtx(context: Float32Array) {
  if (context.length !== CTX_FLOATS) {
    throw new Error(`Packed target context length mismatch: expected ${CTX_FLOATS}, received ${context.length}`)
  }

  const u32 = new Uint32Array(context.buffer, context.byteOffset, context.length)
  const skillId = u32[SKILL_ID] >>> 0
  const skillMask = skillId & 0x7fff
  const elementIdx = Math.max(0, Math.min(5, (skillId >>> 15) & 0x7))
  const meta0 = u32[META0] >>> 0
  const lockedPacked = u32[LOCKED_PACKED] >>> 0
  const togglesBits = u32[TOGGLES] >>> 0
  const pckdRtMask = u32[SET_MASK] >>> 0

  // a zero runtime mask means every encoded set state is active
  const setRtMask = pckdRtMask !== 0 ? pckdRtMask : SETRTTGLALL

  return {
    archetype: context[ARCHETYPE],
    skillId,
    skillMask,
    elementIdx,
    charId: meta0 & 0xfff,
    sequence: (meta0 >>> 12) & 0xf,
    lockedEchoIndex: lockedPacked === 0 ? -1 : ((lockedPacked - 1) | 0),
    toggle0: (togglesBits & 1) ? 1 : 0,
    setRuntimeMask: setRtMask,
    set14FiveEnabled: (setRtMask & SETRTTGLST14) !== 0,
    baseAtk: context[BASE_ATK],
    baseHp: context[BASE_HP],
    baseDef: context[BASE_DEF],
    baseER: context[BASE_ER],
    finalAtk: context[FINAL_ATK],
    finalHp: context[FINAL_HP],
    finalDef: context[FINAL_DEF],
    critRate: context[CRIT_RATE],
    critDmg: context[CRIT_DMG],
    scalingAtk: context[SCALING_ATK],
    scalingHp: context[SCALING_HP],
    scalingDef: context[SCALING_DEF],
    scalingER: context[SCALING_ER],
    multiplier: context[MV],
    flatDmg: context[FLAT_DMG],
    resMult: context[RES_MUL],
    defMult: context[DEF_MUL],
    dmgReduction: context[DMG_RED],
    dmgBonus: context[DMG_BNS],
    dmgAmplify: context[DMG_AMP],
    dmgVulnPct: context[DMG_VULN],
    aux0: context[AUX0],
  }
}

// compute unique set-piece counts for the chosen combo
function mkCmbSetCnts(
    sets: Uint8Array,
    kinds: Uint16Array,
    comboIds: Int32Array,
): Uint8Array {
  const setCounts = new Uint8Array(SET_SLOT_COUNT)
  const setMask = new Uint32Array(SET_SLOT_COUNT)

  for (let index = 0; index < comboIds.length; index += 1) {
    const echoIndex = comboIds[index]
    const setId = sets[echoIndex]
    if (setId < 0 || setId >= SET_SLOT_COUNT) {
      continue
    }

    // kind ids ensure duplicate echoes of the same kind do not overcount set pieces
    const bit = (1 << (kinds[echoIndex] & 31)) >>> 0
    setMask[setId] |= bit
  }

  for (let setId = 0; setId < SET_SLOT_COUNT; setId += 1) {
    setCounts[setId] = countOneBits(setMask[setId])
  }

  return setCounts
}

// sum all raw echo stat rows for the chosen combo before main-echo bonuses
function mkBaseStts(stats: Float32Array, comboIds: Int32Array) {
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
    const base = echoIndex * ECHO_STAT_STRIDE

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
function selSetElemBn(
    base: ReturnType<typeof mkBaseStts>,
    setBonus: ReturnType<typeof applySetF>,
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
function selMainElemB(
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
function selSkllTypeB(
    base: ReturnType<typeof mkBaseStts>,
    setBonus: ReturnType<typeof applySetF>,
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
}): { damage: number; stats: OptResultStats } | null {
  const {
    context,
    stats,
    setConstLut,
    mainEchoBuffs: mainEchoBuffs,
    sets,
    kinds,
    constraints,
    comboIds,
    mainIndex,
  } = options

  const prepared = mkPrepCtx(context)
  const setCounts = mkCmbSetCnts(sets, kinds, comboIds)
  const base = mkBaseStts(stats, comboIds)

  // apply all unconditional + skill-aware set effects for this exact combo
  const setBonus = applySetF(setCounts, prepared.skillMask, setConstLut, prepared.setRuntimeMask)

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
    critDmgTotal += calcCritConvert(prepared.charId, prepared.sequence, critRateTotal)
  }

  // shared damage-bonus pool before applying chosen main echo bonuses
  const bnsBaseTtl =
      setBonus.bonusBase +
      selSetElemBn(base, setBonus, prepared.elementIdx) +
      selSkllTypeB(base, setBonus, prepared.skillMask)

  const mainBase = mainIndex * MAIN_BUFF_LEN
  const mainAtkP = mainEchoBuffs[mainBase]
  const mainAtkF = mainEchoBuffs[mainBase + 1]
  const mainER = mainEchoBuffs[mainBase + 12]
  const finalER = finalERBase + mainER

  // conditional set 14 bonus only matters when enabled and the er threshold is met
  const set14Active = prepared.set14FiveEnabled && setCounts[14] >= 5
  const s14ErBonus = set14Active && finalER >= 250 ? 30 : 0

  // add all chosen-main-echo bonuses that match the current skill
  let bonus = bnsBaseTtl + s14ErBonus + selMainElemB(mainEchoBuffs, mainBase, prepared.elementIdx)
  bonus += mainEchoBuffs[mainBase + 2] * ((prepared.skillMask >>> 0) & 1)
  bonus += mainEchoBuffs[mainBase + 3] * ((prepared.skillMask >>> 1) & 1)
  bonus += mainEchoBuffs[mainBase + 4] * ((prepared.skillMask >>> 2) & 1)
  bonus += mainEchoBuffs[mainBase + 5] * ((prepared.skillMask >>> 3) & 1)
  bonus += mainEchoBuffs[mainBase + 13] * ((prepared.skillMask >>> 6) & 1)
  bonus += mainEchoBuffs[mainBase + 14] * ((prepared.skillMask >>> 7) & 1)
  // generic add_top_stat dmgBonus from the chosen main echo (slot 17),
  // applied unconditionally on top of skill/element-specific buckets.
  bonus += mainEchoBuffs[mainBase + 17]

  const dmgBonus =
      prepared.dmgBonus +
      (bonus / 100) +
      (calcConvert(prepared.charId, finalER) * ((prepared.skillMask >>> 6) & 1))

  // rebuild final atk from base row + chosen main echo
  let finalAtk = atkBaseTerm + (prepared.baseAtk * (mainAtkP / 100)) + mainAtkF
  finalAtk += calcErToAtk(prepared.charId, finalER, prepared.toggle0)

  // 1209 adds conditional er-based bonuses; main-echo cr/cd (slots 15/16)
  // also seed these aggregates so cr/cd-granting main echoes like 6000201
  // surface in the materialized result stats too.
  let mrnyDmgBns = 0
  let critRateBns = mainEchoBuffs[mainBase + 15] / 100
  let critDmgBonus = mainEchoBuffs[mainBase + 16] / 100
  if (prepared.charId === 1209 && finalER > 0) {
    const erOver = Math.max(0, finalER - 100)
    mrnyDmgBns = Math.min(erOver * 0.25, 40) / 100

    if (((prepared.skillMask >>> 3) & 1) !== 0) {
      critRateBns += Math.min(erOver * 0.5, 80) / 100
      critDmgBonus += Math.min(erOver, 160) / 100
    }
  }

  // final stat-scaled value used by regular damage archetypes
  const scaled =
      (finalHpBase * prepared.scalingHp) +
      (finalDefBase * prepared.scalingDef) +
      (finalAtk * prepared.scalingAtk) +
      (finalER * prepared.scalingER)

  let avg
  // include the per-main cr/cd bonuses by default so the materialized stats
  // reflect main-echo top_stat contributions (cr from 6000201 etc.). archetype
  // branches that use packed crit values overwrite these.
  let statCritRate = critRateTotal + critRateBns
  let statCritDmg = critDmgTotal + critDmgBonus
  let statBonus = dmgBonus
  const statAmp = prepared.dmgAmplify

  // evaluate by archetype because tune rupture / negative effects use packed formulas
  switch (prepared.archetype) {
    case ARCH_TUNE: {
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

    case ARCH_HACK: {
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

    case ARCH_SPECTRO:
    case ARCH_AERO:
    case ARCH_FUSION:
    case ARCH_GLACIO:
    case ARCH_ELECTRO: {
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

    case ARCH_DAMAGE:
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
          (dmgBonus + (mrnyDmgBns * prepared.toggle0))

      const critRateForD = Math.max(0, Math.min(1, critRateTotal + critRateBns))
      const critDmgForDm = critDmgTotal + critDmgBonus
      const critHit = baseDamage * critDmgForDm
      avg = (critRateForD * critHit) + ((1 - critRateForD) * baseDamage)
      break
    }
  }

  // reject this evaluation if constraints are present and any stat window fails
  if (constraints && !psssCstrs(
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
