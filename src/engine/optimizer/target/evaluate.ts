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
  SETRTTGLST33,
} from '@/engine/optimizer/encode/sets.ts'
import {
  calcJingranFireOfLifeMultiplier,
  getJingranFortune,
  hasJingranEverflow,
} from '@/engine/optimizer/jingran.ts'
import {
  calcConvert,
  calcCritConvert,
  calcErToAtk,
  calcJingranAtk,
  calcJingranFusion,
  calcShoreCritDmg,
  calcShoreCritRate,
  countOneBits,
} from '@/engine/optimizer/specialMath.ts'
import { optimizerAverageDamage } from '@/engine/optimizer/damageSpec.ts'

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
    shoreInner: (togglesBits & (1 << 1)) !== 0,
    shoreSupernal: (togglesBits & (1 << 2)) !== 0,
    togglesBits,
    jingranFortune: getJingranFortune(togglesBits),
    jingranEverflow: hasJingranEverflow(togglesBits),
    setRuntimeMask: setRtMask,
    set14FiveEnabled: (setRtMask & SETRTTGLST14) !== 0,
    set33ChongmingEnabled: (setRtMask & SETRTTGLST33) !== 0,
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

function createBaseStats() {
  return {
    atkP: 0,
    atkF: 0,
    hpP: 0,
    hpF: 0,
    defP: 0,
    defF: 0,
    critRate: 0,
    critDmg: 0,
    er: 0,
    basic: 0,
    heavy: 0,
    skill: 0,
    lib: 0,
    aero: 0,
    spectro: 0,
    fusion: 0,
    glacio: 0,
    havoc: 0,
    electro: 0,
  }
}

// sum all raw echo stat rows for the chosen combo before main-echo bonuses
function mkBaseStts(
    stats: Float32Array,
    comboIds: Int32Array,
    base = createBaseStats(),
) {
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

  base.atkP = atkP
  base.atkF = atkF
  base.hpP = hpP
  base.hpF = hpF
  base.defP = defP
  base.defF = defF
  base.critRate = critRate
  base.critDmg = critDmg
  base.er = er
  base.basic = basic
  base.heavy = heavy
  base.skill = skill
  base.lib = lib
  base.aero = aero
  base.spectro = spectro
  base.fusion = fusion
  base.glacio = glacio
  base.havoc = havoc
  base.electro = electro
  return base
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

interface TargetEvaluationOptions {
  context: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  constraints?: Float32Array
  comboIds: Int32Array
  mainIndex: number
}

export function evalTarget(options: TargetEvaluationOptions): { damage: number; stats: OptResultStats } | null {
  const prepared = mkPrepCtx(options.context)
  const setCounts = mkCmbSetCnts(options.sets, options.kinds, options.comboIds)
  const base = mkBaseStts(options.stats, options.comboIds)
  const setBonus = applySetF(setCounts, prepared.skillMask, options.setConstLut, prepared.setRuntimeMask)
  const stats = { atk: 0, hp: 0, def: 0, er: 0, cr: 0, cd: 0, bonus: 0, amp: 0 }
  const damage = evaluatePreparedTarget(
    prepared, base, setCounts, setBonus,
    options.mainEchoBuffs, options.mainIndex, options.constraints, stats,
  )
  return damage == null ? null : { damage, stats }
}

// Packed contexts are immutable during a search. Unpack them once, then
// prepare each candidate frame's set effects once. A trial only totals the
// changing stat rows and evaluates the shared formula, without result objects.
export function prepareTargetScoring(
  contexts: readonly Float32Array[],
  setConstLut: Float32Array,
  weights?: Float32Array,
) {
  const prepared = contexts.map(mkPrepCtx)
  const setGroups: Array<{ skillMask: number; runtimeMask: number }> = []
  const groupIndexes = new Map<string, number>()
  const setGroupByContext = prepared.map((context) => {
    const key = `${context.skillMask}:${context.setRuntimeMask}`
    let index = groupIndexes.get(key)
    if (index === undefined) {
      index = setGroups.length
      setGroups.push({ skillMask: context.skillMask, runtimeMask: context.setRuntimeMask })
      groupIndexes.set(key, index)
    }
    return index
  })

  // Fixed frame inputs must not change for the lifetime of the returned scorer.
  return ({ sets, kinds, comboIds, mainEchoBuffs, mainIndex }: Pick<
    TargetEvaluationOptions, 'sets' | 'kinds' | 'comboIds' | 'mainEchoBuffs' | 'mainIndex'
  >) => {
    const setCounts = mkCmbSetCnts(sets, kinds, comboIds)
    const setBonuses = setGroups.map(({ skillMask, runtimeMask }) =>
      applySetF(setCounts, skillMask, setConstLut, runtimeMask),
    )
    const base = createBaseStats()
    const scoreBase = (totals: ReturnType<typeof createBaseStats>) => {
      if (!weights && prepared.length === 1) {
        return evaluatePreparedTarget(
          prepared[0], totals, setCounts, setBonuses[setGroupByContext[0]], mainEchoBuffs, mainIndex,
        ) ?? 0
      }
      let total = 0
      for (let index = 0; index < prepared.length; index += 1) {
        const damage = evaluatePreparedTarget(
          prepared[index], totals, setCounts, setBonuses[setGroupByContext[index]], mainEchoBuffs, mainIndex,
        ) ?? 0
        total += damage * (weights?.[index] ?? 1)
      }
      return total
    }
    const scorer = (stats: Float32Array) => {
      // Reuse JS-number totals rather than Float32 scratch to preserve the
      // original summation precision, including conversion thresholds.
      mkBaseStts(stats, comboIds, base)
      return scoreBase(base)
    }
    // Reference-allocation trials change only the first Echo's substat lane.
    // Bind the other four rows once for this main-stat candidate, so each
    // trial reads one row instead of summing all five again.
    scorer.prepareFirstLane = (fixedStats: Float32Array) => {
      if (comboIds.length !== 5 || comboIds[0] !== 0 || comboIds[1] !== 1
        || comboIds[2] !== 2 || comboIds[3] !== 3 || comboIds[4] !== 4) return scorer
      const fixed = new Float64Array(ECHO_STAT_STRIDE)
      for (let index = 1; index < comboIds.length; index += 1) {
        const offset = comboIds[index] * ECHO_STAT_STRIDE
        for (let stat = 0; stat < ECHO_STAT_STRIDE; stat += 1) fixed[stat] += fixedStats[offset + stat]
      }
      const candidateBase = createBaseStats()
      return (stats: Float32Array) => {
        candidateBase.atkP = stats[0] + fixed[0]
        candidateBase.atkF = stats[1] + fixed[1]
        candidateBase.hpP = stats[2] + fixed[2]
        candidateBase.hpF = stats[3] + fixed[3]
        candidateBase.defP = stats[4] + fixed[4]
        candidateBase.defF = stats[5] + fixed[5]
        candidateBase.critRate = stats[6] + fixed[6]
        candidateBase.critDmg = stats[7] + fixed[7]
        candidateBase.er = stats[8] + fixed[8]
        candidateBase.basic = stats[10] + fixed[10]
        candidateBase.heavy = stats[11] + fixed[11]
        candidateBase.skill = stats[12] + fixed[12]
        candidateBase.lib = stats[13] + fixed[13]
        candidateBase.aero = stats[14] + fixed[14]
        candidateBase.spectro = stats[15] + fixed[15]
        candidateBase.fusion = stats[16] + fixed[16]
        candidateBase.glacio = stats[17] + fixed[17]
        candidateBase.havoc = stats[18] + fixed[18]
        candidateBase.electro = stats[19] + fixed[19]
        return scoreBase(candidateBase)
      }
    }
    return scorer
  }
}

function evaluatePreparedTarget(
  prepared: ReturnType<typeof mkPrepCtx>,
  base: ReturnType<typeof mkBaseStts>,
  setCounts: Uint8Array,
  setBonus: ReturnType<typeof applySetF>,
  mainEchoBuffs: Float32Array,
  mainIndex: number,
  constraints?: Float32Array,
  resultStats?: OptResultStats,
): number | null {
  const finalHpBase =
      prepared.baseHp * ((base.hpP + setBonus.hpP) / 100) +
      base.hpF +
      setBonus.hpF +
      prepared.finalHp

  let finalDefBase =
      prepared.baseDef * ((base.defP + setBonus.defP) / 100) +
      base.defF +
      setBonus.defF +
      prepared.finalDef
  if (prepared.charId === 1212) {
    finalDefBase = 0
  }

  const finalERBase = prepared.baseER + base.er + setBonus.erSetBonus

  const atkBaseTerm =
      prepared.baseAtk * ((base.atkP + setBonus.atkP) / 100) +
      base.atkF +
      setBonus.atkF +
      prepared.finalAtk

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
  const set33Active = prepared.set33ChongmingEnabled && setCounts[33] >= 5
  const s33AtkBonus = set33Active ? Math.min(Math.max(0, finalER * 0.1), 25) : 0

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
      (calcConvert(prepared.charId, finalER) * ((prepared.skillMask >>> 6) & 1)) +
      calcJingranFusion(prepared.charId, finalHpBase, prepared.jingranFortune)

  // rebuild final atk from base row + chosen main echo
  let finalAtk = atkBaseTerm + (prepared.baseAtk * ((mainAtkP + s33AtkBonus) / 100)) + mainAtkF
  finalAtk += calcErToAtk(prepared.charId, finalER, prepared.toggle0)
  finalAtk += calcJingranAtk(
      prepared.charId,
      prepared.sequence,
      finalHpBase,
      prepared.jingranEverflow,
  )

  // 1209 adds conditional er-based bonuses; main-echo cr/cd (slots 15/16)
  // also seed these aggregates so cr/cd-granting main echoes like 6000201
  // surface in the materialized result stats too.
  let mrnyDmgBns = 0
  let critRateBns = mainEchoBuffs[mainBase + 15] / 100
  let critDmgBonus = mainEchoBuffs[mainBase + 16] / 100
  critRateBns += calcShoreCritRate(prepared.charId, finalER, prepared.shoreInner)
  critDmgBonus += calcShoreCritDmg(
      prepared.charId,
      finalER,
      prepared.shoreInner,
      prepared.shoreSupernal,
  )
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

      avg = optimizerAverageDamage(normal, prepared.critRate, prepared.critDmg)

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

      avg = optimizerAverageDamage(normal, prepared.critRate, prepared.critDmg)

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
      const normal =
          prepared.multiplier *
          prepared.resMult *
          prepared.defMult *
          prepared.dmgReduction *
          prepared.dmgBonus *
          prepared.dmgAmplify *
          prepared.aux0

      avg = optimizerAverageDamage(normal, prepared.critRate, prepared.critDmg)

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

      const effectiveMultiplier =
          prepared.multiplier +
          calcJingranFireOfLifeMultiplier(
              prepared.charId,
              prepared.sequence,
              prepared.skillId,
              finalHpBase,
              prepared.togglesBits,
          )

      const baseDamage =
          (scaled * effectiveMultiplier + prepared.flatDmg) *
          baseMul *
          (dmgBonus + (mrnyDmgBns * prepared.toggle0))

      const critRateForD = critRateTotal + critRateBns
      const critDmgForDm = critDmgTotal + critDmgBonus
      avg = optimizerAverageDamage(baseDamage, critRateForD, critDmgForDm)
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

  if (resultStats) {
    resultStats.atk = finalAtk
    resultStats.hp = finalHpBase
    resultStats.def = finalDefBase
    resultStats.er = finalER
    resultStats.cr = statCritRate * 100
    resultStats.cd = statCritDmg * 100
    resultStats.bonus = (statBonus - 1) * 100
    resultStats.amp = (statAmp - 1) * 100
  }
  return avg
}
