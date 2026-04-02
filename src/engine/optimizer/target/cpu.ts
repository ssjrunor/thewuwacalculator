/*
  Author: Runor Ewhro
  Description: evaluates one target-mode optimizer combo on the cpu by
               aggregating echo stats, applying set effects, testing each
               valid main-echo choice, and returning the best passing result.
*/

import type { CpuScratch } from '@/engine/optimizer/cpu/scratch.ts'
import { passesConstraints } from '@/engine/optimizer/constraints/statConstraints.ts'
import {
  applySetEffectsEncoded,
  SET_RUNTIME_TOGGLE_ALL,
  SET_RUNTIME_TOGGLE_SET14_FIVE,
} from '@/engine/optimizer/encode/sets.ts'
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
} from '@/engine/optimizer/config/constants.ts'

// encoded row sizes used by the optimizer buffers
const STATS_PER_ECHO = 20
const MAIN_BUFFS_PER_ECHO = 15
const SET_SLOTS = 32

// offsets for the packed per-echo stat rows
const STAT_ATK_PERCENT = 0
const STAT_ATK_FLAT = 1
const STAT_HP_PERCENT = 2
const STAT_HP_FLAT = 3
const STAT_DEF_PERCENT = 4
const STAT_DEF_FLAT = 5
const STAT_CRIT_RATE = 6
const STAT_CRIT_DMG = 7
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
const MAIN_ATK_PERCENT = 0
const MAIN_ATK_FLAT = 1
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

interface PreparedTargetCpuContext {
  // static values unpacked once from the target context buffer
  archetype: number
  skillMask: number
  elementIdx: number
  charId: number
  sequence: number
  toggle0: number
  setRuntimeMask: number
  set14FiveEnabled: boolean
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
const parsedContextCache = new WeakMap<Float32Array, PreparedTargetCpuContext>()

// fast popcount used to turn per-set bitmasks into unique-kind counts
function countOneBits(x: number): number {
  let value = x >>> 0
  value = value - ((value >>> 1) & 0x55555555)
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

// special conversion for 1206: excess er contributes atk
function calc1206ErToAtk(charId: number, finalER: number, toggle0: number): number {
  if (charId !== 1206) return 0
  const erOver = Math.max(0, finalER - 150)
  return toggle0 ? Math.min(erOver * 20, 2600) : Math.min(erOver * 12, 1560)
}

// special conversion for 1306: excess crit rate converts into crit dmg
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

// special conversion for 1412: excess er grants echo skill bonus
function calc1412Conversion(charId: number, finalER: number): number {
  if (charId !== 1412 || finalER <= 125) return 0
  return Math.min((finalER - 125) * 2, 50) / 100
}

// select the matching elemental bonus bucket from base stats + set bonus
function selectSetElementBonus(
    base: Float32Array,
    setBonus: ReturnType<typeof applySetEffectsEncoded>,
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
function selectSkillTypeBonus(
    base: Float32Array,
    setBonus: ReturnType<typeof applySetEffectsEncoded>,
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
function selectMainElementBonus(
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
function prepareTargetCpuContext(context: Float32Array): PreparedTargetCpuContext {
  const cached = parsedContextCache.get(context)
  if (cached) {
    return cached
  }

  if (context.length !== OPTIMIZER_CONTEXT_FLOATS) {
    throw new Error(`Target optimizer context length mismatch: expected ${OPTIMIZER_CONTEXT_FLOATS}, received ${context.length}`)
  }

  const u32 = new Uint32Array(context.buffer, context.byteOffset, context.length)
  const skillId = u32[OPTIMIZER_CTX_SKILL_ID] >>> 0
  const skillMask = skillId & 0x7fff
  const meta0 = u32[OPTIMIZER_CTX_META0] >>> 0
  const togglesBits = u32[OPTIMIZER_CTX_TOGGLES] >>> 0
  const packedRuntimeMask = u32[OPTIMIZER_CTX_SET_RUNTIME_MASK] >>> 0
  const setRuntimeMask = packedRuntimeMask !== 0 ? packedRuntimeMask : SET_RUNTIME_TOGGLE_ALL

  const prepared: PreparedTargetCpuContext = {
    archetype: context[OPTIMIZER_CTX_ARCHETYPE],
    skillMask,
    elementIdx: Math.max(0, Math.min(5, (skillId >>> 15) & 0x7)),
    charId: meta0 & 0xfff,
    sequence: (meta0 >>> 12) & 0xf,
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

  parsedContextCache.set(context, prepared)
  return prepared
}

// build the raw combo stat vector and per-set unique-kind counts for one 5-echo combo
function buildComboBaseState(
    scratch: CpuScratch,
    stats: Float32Array,
    sets: Uint8Array,
    kinds: Uint16Array,
    comboIds: Int32Array,
): number {
  const base = scratch.baseComboVector
  base.fill(0)

  const setCounts = scratch.setCounts
  const setMasks = scratch.setMasks
  const touchedSetIds = scratch.touchedSetIds
  let touchedSetCount = 0

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
      touchedSetIds[touchedSetCount] = setId
      touchedSetCount += 1
    }

    setMasks[setId] = nextMask
  }

  // finalize piece counts only for sets touched by this combo
  for (let index = 0; index < touchedSetCount; index += 1) {
    const setId = touchedSetIds[index]
    setCounts[setId] = countOneBits(setMasks[setId])
  }

  return touchedSetCount
}

// clear only the touched set slots so the scratch buffer can be reused cheaply
function clearComboSetState(scratch: CpuScratch, touchedSetCount: number): void {
  for (let index = 0; index < touchedSetCount; index += 1) {
    const setId = scratch.touchedSetIds[index]
    scratch.setCounts[setId] = 0
    scratch.setMasks[setId] = 0
  }
}

export function evaluateTargetCpuCombo(options: {
  context: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  constraints: Float32Array
  comboIds: Int32Array
  lockedMainIndex: number
  scratch: CpuScratch
}): { damage: number; mainIndex: number } | null {
  const {
    context,
    stats,
    setConstLut,
    mainEchoBuffs,
    sets,
    kinds,
    constraints,
    comboIds,
    lockedMainIndex,
    scratch,
  } = options

  const prepared = prepareTargetCpuContext(context)
  const touchedSetCount = buildComboBaseState(scratch, stats, sets, kinds, comboIds)
  const base = scratch.baseComboVector
  const setCounts = scratch.setCounts

  // apply encoded set bonuses once for the full combo before trying each main slot
  const setBonus = applySetEffectsEncoded(setCounts, prepared.skillMask, setConstLut, prepared.setRuntimeMask)

  const finalHpBase =
      prepared.baseHp * ((base[STAT_HP_PERCENT] + setBonus.hpP) / 100) +
      base[STAT_HP_FLAT] +
      setBonus.hpF +
      prepared.finalHp

  const finalDefBase =
      prepared.baseDef * ((base[STAT_DEF_PERCENT] + setBonus.defP) / 100) +
      base[STAT_DEF_FLAT] +
      setBonus.defF +
      prepared.finalDef

  const atkBaseTerm =
      prepared.baseAtk * ((base[STAT_ATK_PERCENT] + setBonus.atkP) / 100) +
      base[STAT_ATK_FLAT] +
      setBonus.atkF +
      prepared.finalAtk

  const finalERBase = prepared.baseER + base[STAT_ER] + setBonus.erSetBonus

  const critRateTotal = prepared.critRate + ((base[STAT_CRIT_RATE] + setBonus.critRate) / 100)
  let critDmgTotal = prepared.critDmg + ((base[STAT_CRIT_DMG] + setBonus.critDmg) / 100)

  if (prepared.charId === 1306) {
    critDmgTotal += calc1306CritConversion(prepared.charId, prepared.sequence, critRateTotal)
  }

  const bonusBaseTotal =
      setBonus.bonusBase +
      selectSetElementBonus(base, setBonus, prepared.elementIdx) +
      selectSkillTypeBonus(base, setBonus, prepared.skillMask)

  let bestDamage = 0
  let bestMainIndex = -1

  // try every combo member as the main echo unless one is explicitly locked
  for (let index = 0; index < comboIds.length; index += 1) {
    const mainIndex = lockedMainIndex >= 0 ? lockedMainIndex : comboIds[index]
    if (lockedMainIndex >= 0 && mainIndex !== lockedMainIndex) {
      continue
    }

    const mainBase = mainIndex * MAIN_BUFFS_PER_ECHO
    const finalER = finalERBase + mainEchoBuffs[mainBase + MAIN_ER]

    // set 14 conditional er threshold bonus
    const set14Active = prepared.set14FiveEnabled && setCounts[14] >= 5
    const s14ErBonus = set14Active && finalER >= 250 ? 30 : 0

    // assemble the final dmg bonus pool for this chosen main echo
    let bonus = bonusBaseTotal + s14ErBonus + selectMainElementBonus(mainEchoBuffs, mainBase, prepared.elementIdx)
    bonus += mainEchoBuffs[mainBase + MAIN_BASIC] * ((prepared.skillMask >>> 0) & 1)
    bonus += mainEchoBuffs[mainBase + MAIN_HEAVY] * ((prepared.skillMask >>> 1) & 1)
    bonus += mainEchoBuffs[mainBase + MAIN_SKILL] * ((prepared.skillMask >>> 2) & 1)
    bonus += mainEchoBuffs[mainBase + MAIN_LIB] * ((prepared.skillMask >>> 3) & 1)
    bonus += mainEchoBuffs[mainBase + MAIN_ECHO_SKILL] * ((prepared.skillMask >>> 6) & 1)
    bonus += mainEchoBuffs[mainBase + MAIN_COORD] * ((prepared.skillMask >>> 7) & 1)

    const dmgBonus =
        prepared.dmgBonus +
        (bonus / 100) +
        (calc1412Conversion(prepared.charId, finalER) * ((prepared.skillMask >>> 6) & 1))

    // final atk depends on the chosen main echo's atk bonuses
    let finalAtk =
        atkBaseTerm +
        (prepared.baseAtk * (mainEchoBuffs[mainBase + MAIN_ATK_PERCENT] / 100)) +
        mainEchoBuffs[mainBase + MAIN_ATK_FLAT]

    finalAtk += calc1206ErToAtk(prepared.charId, finalER, prepared.toggle0)

    // 1209-specific er-derived bonuses
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

    // compute the final scaling bucket used by normal damage archetypes
    const scaled =
        (finalHpBase * prepared.scalingHp) +
        (finalDefBase * prepared.scalingDef) +
        (finalAtk * prepared.scalingAtk) +
        (finalER * prepared.scalingER)

    let constraintCritRate = critRateTotal
    let constraintCritDmg = critDmgTotal
    let constraintDmgBonus = dmgBonus
    let avg = 0

    // archetype-specific average damage evaluation
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

        // tune rupture uses packed crit/bonus values directly
        constraintCritRate = prepared.critRate
        constraintCritDmg = prepared.critDmg
        constraintDmgBonus = prepared.dmgBonus
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

        // negative-effect archetypes also use packed crit/bonus values
        constraintCritRate = prepared.critRate
        constraintCritDmg = prepared.critDmg
        constraintDmgBonus = prepared.dmgBonus
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
        avg = (critRateForDamage * (baseDamage * critDmgForDamage)) + ((1 - critRateForDamage) * baseDamage)
        break
      }
    }

    // reject this main choice if it fails any active constraint window
    if (constraints && !passesConstraints(
        constraints,
        finalAtk,
        finalHpBase,
        finalDefBase,
        constraintCritRate,
        constraintCritDmg,
        finalER,
        constraintDmgBonus,
        avg,
    )) {
      if (lockedMainIndex >= 0) {
        break
      }
      continue
    }

    if (avg > bestDamage) {
      bestDamage = avg
      bestMainIndex = mainIndex
    }

    // when the main is locked there is only one candidate to test
    if (lockedMainIndex >= 0) {
      break
    }
  }

  clearComboSetState(scratch, touchedSetCount)

  return bestMainIndex >= 0
      ? {
        damage: bestDamage,
        mainIndex: bestMainIndex,
      }
      : null
}
