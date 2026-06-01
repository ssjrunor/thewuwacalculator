/*
  Author: Runor Ewhro
  Description: evaluates one target-mode optimizer combo on the cpu by
               aggregating echo stats, applying set effects, testing each
               valid main-echo choice, and returning the best passing result.
*/

import type { CpuScratch } from '@/engine/optimizer/cpu/scratch.ts'
import { psssCstrs } from '@/engine/optimizer/constraints/statConstraints.ts'
import {
  applySetVec,
  SETRTTGLALL,
  SETRTTGLST14,
} from '@/engine/optimizer/encode/sets.ts'
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
  MAIN_FIRST,
} from '@/engine/optimizer/config/constants.ts'

// encoded row sizes used by the optimizer buffers
const STATS_PER_ECHO = 20
const MAIN_BUFF_SIZE = 18
const SET_SLOTS = 33

// offsets for the packed per-echo stat rows
const STAT_ATK_PCT = 0
const STATATKFLAT = 1
const STAT_HP_PRCN = 2
const STAT_HP_FLAT = 3
const STAT_DEF_PCT = 4
const STATDEFFLAT = 5
const STATCRITRATE = 6
const STATCRITDMG = 7
const STAT_ER = 8
const STAT_BASIC = 10
const STAT_HEAVY = 11
const STAT_SKILL = 12
const STAT_LIB = 13
const STAT_AERO = 14
const STAT_SPECTRO = 15
const STAT_FUSION = 16
const STAT_GLACIO = 17
const STAT_HAVOC = 18
const STAT_ELECTRO = 19

// offsets for the packed main-echo bonus rows
const MAIN_ATK_PCT = 0
const MAINATKFLAT = 1
const MAIN_BASIC = 2
const MAIN_HEAVY = 3
const MAIN_SKILL = 4
const MAIN_LIB = 5
const MAIN_AERO = 6
const MAIN_GLACIO = 7
const MAIN_FUSION = 8
const MAIN_SPECTRO = 9
const MAIN_HAVOC = 10
const MAIN_ELECTRO = 11
const MAIN_ER = 12
const MAIN_ECHO_SKILL = 13
const MAIN_COORD = 14
// see encode/echoes.ts for the layout; these three slots cover top_stat
// contributions (cr/cd/dmgBonus) that previously fell on the floor.
const MAIN_CR = 15
const MAIN_CD = 16
const MAIN_DMG_BNS = 17

interface PrepTgtCpuCt {
  // static values unpacked once from the target context buffer
  archetype: number
  skillMask: number
  elementIdx: number
  charId: number
  sequence: number
  toggle0: number
  setRtMask: number
  st14FiveOn: boolean
  baseAtk: number
  baseHp: number
  baseDef: number
  baseER: number
  finalAtk: number
  finalHp: number
  finalDef: number
  critRate: number
  critDmg: number
  scalingAtk: number
  scalingHp: number
  scalingDef: number
  scalingER: number
  multiplier: number
  flatDmg: number
  resMult: number
  defMult: number
  dmgReduction: number
  dmgBonus: number
  dmgAmplify: number
  dmgVulnPct: number
  aux0: number
}

// cache parsed contexts so repeated combo checks do not keep unpacking the same buffer
const prsdCtxCch = new WeakMap<Float32Array, PrepTgtCpuCt>()

// fast popcount used to turn per-set bitmasks into unique-kind counts
function countOneBits(x: number): number {
  let value = x >>> 0
  value = value - ((value >>> 1) & 0x55555555)
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

// special conversion for 1206: excess er contributes atk
function calcErToAtk(charId: number, finalER: number, toggle0: number): number {
  if (charId !== 1206) return 0
  const erOver = Math.max(0, finalER - 150)
  return toggle0 ? Math.min(erOver * 20, 2600) : Math.min(erOver * 12, 1560)
}

// special conversion for 1306: excess crit rate converts into crit dmg
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

// special conversion for 1412: excess er grants echo skill bonus
function calcConvert(charId: number, finalER: number): number {
  if (charId !== 1412 || finalER <= 125) return 0
  return Math.min((finalER - 125) * 2, 50) / 100
}

// select the matching elemental bonus bucket from base stats + set bonus
function selSetElemBn(
    base: Float32Array,
    setBonus: ReturnType<typeof applySetVec>,
    elementIdx: number,
): number {
  switch (elementIdx) {
    case 0: return base[STAT_AERO] + setBonus.aero
    case 1: return base[STAT_GLACIO] + setBonus.glacio
    case 2: return base[STAT_FUSION] + setBonus.fusion
    case 3: return base[STAT_SPECTRO] + setBonus.spectro
    case 4: return base[STAT_HAVOC] + setBonus.havoc
    default: return base[STAT_ELECTRO] + setBonus.electro
  }
}

// sum all skill-type-specific bonus buckets that match the current skill mask
function selSkllTypeB(
    base: Float32Array,
    setBonus: ReturnType<typeof applySetVec>,
    skillMask: number,
): number {
  return (
      ((skillMask >>> 0) & 1 ? base[STAT_BASIC] + setBonus.basic : 0) +
      ((skillMask >>> 1) & 1 ? base[STAT_HEAVY] + setBonus.heavy : 0) +
      ((skillMask >>> 2) & 1 ? base[STAT_SKILL] + setBonus.skill : 0) +
      ((skillMask >>> 3) & 1 ? base[STAT_LIB] + setBonus.lib : 0) +
      ((skillMask >>> 6) & 1 ? setBonus.echoSkill : 0) +
      ((skillMask >>> 7) & 1 ? setBonus.coord : 0)
  )
}

// select the current main echo's elemental bonus bucket
function selMainElemB(
    mainEchoBuffs: Float32Array,
    base: number,
    elementIdx: number,
): number {
  switch (elementIdx) {
    case 0: return mainEchoBuffs[base + MAIN_AERO]
    case 1: return mainEchoBuffs[base + MAIN_GLACIO]
    case 2: return mainEchoBuffs[base + MAIN_FUSION]
    case 3: return mainEchoBuffs[base + MAIN_SPECTRO]
    case 4: return mainEchoBuffs[base + MAIN_HAVOC]
    default: return mainEchoBuffs[base + MAIN_ELECTRO]
  }
}

// parse and cache the packed target context so combo evaluation can stay lightweight
function prprTgtCpuCt(context: Float32Array): PrepTgtCpuCt {
  const cached = prsdCtxCch.get(context)
  if (cached) {
    return cached
  }

  if (context.length !== CTX_FLOATS) {
    throw new Error(`Target optimizer context length mismatch: expected ${CTX_FLOATS}, received ${context.length}`)
  }

  const u32 = new Uint32Array(context.buffer, context.byteOffset, context.length)
  const skillId = u32[SKILL_ID] >>> 0
  const skillMask = skillId & 0x7fff
  const meta0 = u32[META0] >>> 0
  const togglesBits = u32[TOGGLES] >>> 0
  const pckdRtMask = u32[SET_MASK] >>> 0
  const setRtMask = pckdRtMask !== 0 ? pckdRtMask : SETRTTGLALL

  const prepared: PrepTgtCpuCt = {
    archetype: context[ARCHETYPE],
    skillMask,
    elementIdx: Math.max(0, Math.min(5, (skillId >>> 15) & 0x7)),
    charId: meta0 & 0xfff,
    sequence: (meta0 >>> 12) & 0xf,
    toggle0: (togglesBits & 1) ? 1 : 0,
    setRtMask: setRtMask,
    st14FiveOn: (setRtMask & SETRTTGLST14) !== 0,
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

  prsdCtxCch.set(context, prepared)
  return prepared
}

// build the raw combo stat vector and per-set unique-kind counts for one 5-echo combo
function mkCmbBaseStt(
    scratch: CpuScratch,
    stats: Float32Array,
    sets: Uint8Array,
    kinds: Uint16Array,
    comboIds: Int32Array,
): number {
  const base = scratch.baseCmbVctr
  base.fill(0)

  const setCounts = scratch.setCounts
  const setMasks = scratch.setMasks
  const tchdSetIds = scratch.tchdSetIds
  let tchdSetCnt = 0

  for (let comboIndex = 0; comboIndex < comboIds.length; comboIndex += 1) {
    const echoIndex = comboIds[comboIndex]
    const statsBase = echoIndex * STATS_PER_ECHO

    // add the current echo's packed stat row into the combo base vector
    for (let offset = 0; offset < STATS_PER_ECHO; offset += 1) {
      base[offset] += stats[statsBase + offset]
    }

    const setId = sets[echoIndex]
    if (setId < 0 || setId >= SET_SLOTS) {
      continue
    }

    // use kind ids so duplicates of the same echo do not overcount set pieces
    const bit = (1 << (kinds[echoIndex] & 31)) >>> 0
    const prevMask = setMasks[setId] >>> 0
    const nextMask = (prevMask | bit) >>> 0
    if (nextMask === prevMask) {
      continue
    }

    if (prevMask === 0) {
      tchdSetIds[tchdSetCnt] = setId
      tchdSetCnt += 1
    }

    setMasks[setId] = nextMask
  }

  // finalize piece counts only for sets touched by this combo
  for (let index = 0; index < tchdSetCnt; index += 1) {
    const setId = tchdSetIds[index]
    setCounts[setId] = countOneBits(setMasks[setId])
  }

  return tchdSetCnt
}

// clear only the touched set slots so the scratch buffer can be reused cheaply
function clrCmbSetStt(scratch: CpuScratch, tchdSetCnt: number): void {
  for (let index = 0; index < tchdSetCnt; index += 1) {
    const setId = scratch.tchdSetIds[index]
    scratch.setCounts[setId] = 0
    scratch.setMasks[setId] = 0
  }
}

export function evalTgtCpuCm(options: {
  context: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  constraints: Float32Array
  comboIds: Int32Array
  lockMainIdx: number
  scratch: CpuScratch
}): { damage: number; mainIndex: number } | null {
  const {
    context,
    stats,
    setConstLut,
    mainEchoBuffs: mainEchoBuffs,
    sets,
    kinds,
    constraints,
    comboIds,
    lockMainIdx: lockMainNdx,
    scratch,
  } = options

  const prepared = prprTgtCpuCt(context)
  const tchdSetCnt = mkCmbBaseStt(scratch, stats, sets, kinds, comboIds)
  const base = scratch.baseCmbVctr
  const setCounts = scratch.setCounts

  // apply encoded set bonuses once for the full combo before trying each main slot
  const setBonus = applySetVec(setCounts, prepared.skillMask, setConstLut, prepared.setRtMask)

  const finalHpBase =
      prepared.baseHp * ((base[STAT_HP_PRCN] + setBonus.hpP) / 100) +
      base[STAT_HP_FLAT] +
      setBonus.hpF +
      prepared.finalHp

  const finalDefBase =
      prepared.baseDef * ((base[STAT_DEF_PCT] + setBonus.defP) / 100) +
      base[STATDEFFLAT] +
      setBonus.defF +
      prepared.finalDef

  const atkBaseTerm =
      prepared.baseAtk * ((base[STAT_ATK_PCT] + setBonus.atkP) / 100) +
      base[STATATKFLAT] +
      setBonus.atkF +
      prepared.finalAtk

  const finalERBase = prepared.baseER + base[STAT_ER] + setBonus.erSetBonus

  const critRateTotal = prepared.critRate + ((base[STATCRITRATE] + setBonus.critRate) / 100)
  let critDmgTotal = prepared.critDmg + ((base[STATCRITDMG] + setBonus.critDmg) / 100)

  if (prepared.charId === 1306) {
    critDmgTotal += calcCritConvert(prepared.charId, prepared.sequence, critRateTotal)
  }

  const bnsBaseTtl =
      setBonus.bonusBase +
      selSetElemBn(base, setBonus, prepared.elementIdx) +
      selSkllTypeB(base, setBonus, prepared.skillMask)

  let bestDamage = 0
  let bestMainIndex = -1
  const firstSlotMain = lockMainNdx === MAIN_FIRST
  const fixedMain = firstSlotMain || lockMainNdx >= 0

  // try every combo member as the main echo unless one is explicitly locked
  for (let index = 0; index < comboIds.length; index += 1) {
    const mainIndex = firstSlotMain
        ? comboIds[0]
        : lockMainNdx >= 0
          ? lockMainNdx
          : comboIds[index]

    const mainBase = mainIndex * MAIN_BUFF_SIZE
    const finalER = finalERBase + mainEchoBuffs[mainBase + MAIN_ER]

    // set 14 conditional er threshold bonus
    const set14Active = prepared.st14FiveOn && setCounts[14] >= 5
    const s14ErBonus = set14Active && finalER >= 250 ? 30 : 0

    // assemble the final dmg bonus pool for this chosen main echo
    let bonus = bnsBaseTtl + s14ErBonus + selMainElemB(mainEchoBuffs, mainBase, prepared.elementIdx)
    bonus += mainEchoBuffs[mainBase + MAIN_BASIC] * ((prepared.skillMask >>> 0) & 1)
    bonus += mainEchoBuffs[mainBase + MAIN_HEAVY] * ((prepared.skillMask >>> 1) & 1)
    bonus += mainEchoBuffs[mainBase + MAIN_SKILL] * ((prepared.skillMask >>> 2) & 1)
    bonus += mainEchoBuffs[mainBase + MAIN_LIB] * ((prepared.skillMask >>> 3) & 1)
    bonus += mainEchoBuffs[mainBase + MAIN_ECHO_SKILL] * ((prepared.skillMask >>> 6) & 1)
    bonus += mainEchoBuffs[mainBase + MAIN_COORD] * ((prepared.skillMask >>> 7) & 1)
    // generic top_stat dmgBonus (e.g. set effects or conditional echo passives
    // that grant +N% damage regardless of skill type or element)
    bonus += mainEchoBuffs[mainBase + MAIN_DMG_BNS]

    const dmgBonus =
        prepared.dmgBonus +
        (bonus / 100) +
        (calcConvert(prepared.charId, finalER) * ((prepared.skillMask >>> 6) & 1))

    // final atk depends on the chosen main echo's atk bonuses
    let finalAtk =
        atkBaseTerm +
        (prepared.baseAtk * (mainEchoBuffs[mainBase + MAIN_ATK_PCT] / 100)) +
        mainEchoBuffs[mainBase + MAINATKFLAT]

    finalAtk += calcErToAtk(prepared.charId, finalER, prepared.toggle0)

    // 1209-specific er-derived bonuses + main-echo cr/cd contributions
    // (the latter are %-typed top_stat operations, normalized to the same
    // 0..1 scale critRateTotal/critDmgTotal use).
    let mrnyDmgBns = 0
    let critRateBns = mainEchoBuffs[mainBase + MAIN_CR] / 100
    let critDmgBonus = mainEchoBuffs[mainBase + MAIN_CD] / 100

    if (prepared.charId === 1209 && finalER > 0) {
      const erOver = Math.max(0, finalER - 100)
      mrnyDmgBns = Math.min(erOver * 0.25, 40) / 100

      if (((prepared.skillMask >>> 3) & 1) !== 0) {
        critRateBns += Math.min(erOver * 0.5, 80) / 100
        critDmgBonus += Math.min(erOver, 160) / 100
      }
    }

    // compute the final scaling bucket used by normal damage archetypes
    const scaled =
        (finalHpBase * prepared.scalingHp) +
        (finalDefBase * prepared.scalingDef) +
        (finalAtk * prepared.scalingAtk) +
        (finalER * prepared.scalingER)

    let cstrCritRate = critRateTotal
    let cstrCritDmg = critDmgTotal
    let cstrDmgBns = dmgBonus
    let avg = 0

    // archetype-specific average damage evaluation
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

        // tune rupture uses packed crit/bonus values directly
        cstrCritRate = prepared.critRate
        cstrCritDmg = prepared.critDmg
        cstrDmgBns = prepared.dmgBonus
        break
      }

      case ARCH_HACK: {
        const normal =
            prepared.multiplier *
            prepared.resMult *
            prepared.defMult *
            prepared.dmgReduction *
            prepared.dmgBonus *
            prepared.dmgAmplify

        const critRate = Math.max(0, Math.min(1, prepared.critRate))
        const critDmg = prepared.critDmg
        avg = (critRate * (normal * critDmg)) + ((1 - critRate) * normal)

        cstrCritRate = prepared.critRate
        cstrCritDmg = prepared.critDmg
        cstrDmgBns = prepared.dmgBonus
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

        // negative-effect archetypes also use packed crit/bonus values
        cstrCritRate = prepared.critRate
        cstrCritDmg = prepared.critDmg
        cstrDmgBns = prepared.dmgBonus
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
        avg = (critRateForD * (baseDamage * critDmgForDm)) + ((1 - critRateForD) * baseDamage)
        break
      }
    }

    // reject this main choice if it fails any active constraint window
    if (constraints && !psssCstrs(
        constraints,
        finalAtk,
        finalHpBase,
        finalDefBase,
        cstrCritRate,
        cstrCritDmg,
        finalER,
        cstrDmgBns,
        avg,
    )) {
      if (fixedMain) {
        break
      }
      continue
    }

    if (avg > bestDamage) {
      bestDamage = avg
      bestMainIndex = mainIndex
    }

    // when the main is locked there is only one candidate to test
    if (fixedMain) {
      break
    }
  }

  clrCmbSetStt(scratch, tchdSetCnt)

  return bestMainIndex >= 0
      ? {
        damage: bestDamage,
        mainIndex: bestMainIndex,
      }
      : null
}
