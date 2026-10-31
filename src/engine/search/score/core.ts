/*
  Author: Runor Ewhro
  description: evaluates target damage from packed contexts through the shared
               combo-term and main-Echo scoring path used by search and retained
               result materialization.
*/

import { ECHO_STAT, MAIN_BUFF } from '@/engine/search/layout/echoLayout'
import { lilyExcessEr, lilySupportEr, lilyAromaStacks, LILY_SILVERED_BIT } from '@/engine/search/score/lily'
import { psssCstrs } from '@/engine/search/score/statConstraints.ts'
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
  TOGGLES,
  MAIN_BUFF_LEN,
} from '@/engine/search/layout/constants.ts'
import { type applySetVec, SETRTTGLST14, SETRTTGLST33 } from '@/engine/search/encode/sets.ts'
import {
  calcJingranFireOfLifeMultiplier,
  getJingranFortune,
  hasJingranEverflow,
} from '@/engine/search/score/jingran.ts'
import {
  calcConvert,
  calcCritConvert,
  calcErToAtk,
  calcJingranAtk,
  calcJingranFusion,
  calcShoreCritDmg,
  calcShoreCritRate,
} from '@/engine/search/score/specialMath.ts'
import { optimizerAverageDamage } from '@/engine/search/score/damageSpec.ts'

// compact stat summary attached to one optimizer result entry
export interface OptResultStats {
  atk: number
  hp: number
  def: number
  er: number
  cr: number
  cd: number
  bonus: number
  amp: number
}

export type SetBonus = ReturnType<typeof applySetVec>

// static values unpacked once from a packed target context
export interface TgtCtx {
  setGroupKey: string
  archetype: number
  skillId: number
  skillMask: number
  elementIdx: number
  charId: number
  sequence: number
  toggle0: number
  shoreInner: boolean
  shoreSupernal: boolean
  togglesBits: number
  jingranFortune: number
  jingranEverflow: boolean
  setRtMask: number
  st14FiveOn: boolean
  st33ChongmingOn: boolean
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
  aux0: number
}

// contexts are immutable once packed, so the parse is cached by identity
const parsed = new WeakMap<Float32Array, TgtCtx>()

export function tgtCtx(context: Float32Array): TgtCtx {
  const cached = parsed.get(context)
  if (cached) return cached
  if (context.length !== CTX_FLOATS) {
    throw new Error(`Packed target context length mismatch: expected ${CTX_FLOATS}, received ${context.length}`)
  }

  const u32 = new Uint32Array(context.buffer, context.byteOffset, context.length)
  const skillId = u32[SKILL_ID] >>> 0
  const skillMask = skillId & 0x7fff
  const meta0 = u32[META0] >>> 0
  const togglesBits = u32[TOGGLES] >>> 0
  const setRtMask = u32[SET_MASK] >>> 0

  const ctx: TgtCtx = {
    setGroupKey: `${skillMask}:${setRtMask}`,
    archetype: context[ARCHETYPE],
    skillId,
    skillMask,
    elementIdx: Math.max(0, Math.min(5, (skillId >>> 15) & 0x7)),
    charId: meta0 & 0xfff,
    sequence: (meta0 >>> 12) & 0xf,
    toggle0: (togglesBits & 1) ? 1 : 0,
    shoreInner: (togglesBits & (1 << 1)) !== 0,
    shoreSupernal: (togglesBits & (1 << 2)) !== 0,
    togglesBits,
    jingranFortune: getJingranFortune(togglesBits),
    jingranEverflow: hasJingranEverflow(togglesBits),
    setRtMask,
    st14FiveOn: (setRtMask & SETRTTGLST14) !== 0,
    st33ChongmingOn: (setRtMask & SETRTTGLST33) !== 0,
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
    aux0: context[AUX0],
  }
  parsed.set(context, ctx)
  return ctx
}

// combo-level values every main echo shares
export interface TgtComboTerms {
  hp: number
  def: number
  erBase: number
  atkBase: number
  critRate: number
  critDmg: number
  bonusBase: number
}

export function mkTgtComboTerms(): TgtComboTerms {
  return { hp: 0, def: 0, erBase: 0, atkBase: 0, critRate: 0, critDmg: 0, bonusBase: 0 }
}

// matching elemental bonus bucket from totals + set bonus
function setElemBonus(totals: Float64Array, setBonus: SetBonus, elementIdx: number): number {
  switch (elementIdx) {
    case 0: return totals[ECHO_STAT.aero] + setBonus.aero
    case 1: return totals[ECHO_STAT.glacio] + setBonus.glacio
    case 2: return totals[ECHO_STAT.fusion] + setBonus.fusion
    case 3: return totals[ECHO_STAT.spectro] + setBonus.spectro
    case 4: return totals[ECHO_STAT.havoc] + setBonus.havoc
    default: return totals[ECHO_STAT.electro] + setBonus.electro
  }
}

// skill-type bonus buckets that match the skill mask
function skillTypeBonus(totals: Float64Array, setBonus: SetBonus, skillMask: number): number {
  return (
      ((skillMask >>> 0) & 1 ? totals[ECHO_STAT.basicAtk] + setBonus.basic : 0) +
      ((skillMask >>> 1) & 1 ? totals[ECHO_STAT.heavyAtk] + setBonus.heavy : 0) +
      ((skillMask >>> 2) & 1 ? totals[ECHO_STAT.resonanceSkill] + setBonus.skill : 0) +
      ((skillMask >>> 3) & 1 ? totals[ECHO_STAT.resonanceLiberation] + setBonus.lib : 0) +
      ((skillMask >>> 6) & 1 ? setBonus.echoSkill : 0) +
      ((skillMask >>> 7) & 1 ? setBonus.coord : 0)
  )
}

// the main echo's elemental bonus bucket
function mainElemBonus(mainEchoBuffs: Float32Array, base: number, elementIdx: number): number {
  switch (elementIdx) {
    case 0: return mainEchoBuffs[base + MAIN_BUFF.aero]
    case 1: return mainEchoBuffs[base + MAIN_BUFF.glacio]
    case 2: return mainEchoBuffs[base + MAIN_BUFF.fusion]
    case 3: return mainEchoBuffs[base + MAIN_BUFF.spectro]
    case 4: return mainEchoBuffs[base + MAIN_BUFF.havoc]
    default: return mainEchoBuffs[base + MAIN_BUFF.electro]
  }
}

// fold a combo's echo stat totals and set bonus into the shared terms
export function tgtComboTerms(ctx: TgtCtx, totals: Float64Array, setBonus: SetBonus, out: TgtComboTerms): TgtComboTerms {
  out.hp = ctx.baseHp * ((totals[ECHO_STAT.hpPercent] + setBonus.hpP) / 100) + totals[ECHO_STAT.hpFlat] + setBonus.hpF + ctx.finalHp
  out.def = ctx.charId === 1212
    ? 0
    : ctx.baseDef * ((totals[ECHO_STAT.defPercent] + setBonus.defP) / 100) + totals[ECHO_STAT.defFlat] + setBonus.defF + ctx.finalDef
  out.erBase = ctx.baseER + totals[ECHO_STAT.energyRegen] + setBonus.erSetBonus
  out.atkBase = ctx.baseAtk * ((totals[ECHO_STAT.atkPercent] + setBonus.atkP) / 100) + totals[ECHO_STAT.atkFlat] + setBonus.atkF + ctx.finalAtk
  out.critRate = ctx.critRate + ((totals[ECHO_STAT.critRate] + setBonus.critRate) / 100)
  out.critDmg = ctx.critDmg + ((totals[ECHO_STAT.critDmg] + setBonus.critDmg) / 100)
  if (ctx.charId === 1306) out.critDmg += calcCritConvert(ctx.charId, ctx.sequence, out.critRate)
  out.bonusBase = setBonus.bonusBase + setElemBonus(totals, setBonus, ctx.elementIdx) + skillTypeBonus(totals, setBonus, ctx.skillMask)
  return out
}

// returned by tgtMainDamage when a limit fails. it never beats a best, and a
// NaN from a missing main stays distinct from it
export const LIMIT_FAILED = -Infinity

// average damage with one main echo, or LIMIT_FAILED. limits check the
// displayed stats, conditional bonuses included; `stats` receives them.
export function tgtMainDamage(
    ctx: TgtCtx,
    terms: TgtComboTerms,
    setCounts: Uint8Array,
    mainEchoBuffs: Float32Array,
    mainIndex: number,
    constraints?: Float32Array,
    stats?: OptResultStats,
): number {
  const mainBase = mainIndex * MAIN_BUFF_LEN
  const skillMask = ctx.skillMask
  const finalER = terms.erBase + mainEchoBuffs[mainBase + MAIN_BUFF.energyRegen]
  const s33AtkBonus = ctx.st33ChongmingOn && setCounts[33] >= 5 ? Math.min(Math.max(0, finalER * 0.1), 25) : 0
  const s14ErBonus = ctx.st14FiveOn && setCounts[14] >= 5 && finalER >= 250 ? 30 : 0

  // the dmg bonus pool with this main echo's buckets
  let bonus = terms.bonusBase + s14ErBonus + mainElemBonus(mainEchoBuffs, mainBase, ctx.elementIdx)
  bonus += mainEchoBuffs[mainBase + MAIN_BUFF.basicAtk] * ((skillMask >>> 0) & 1)
  bonus += mainEchoBuffs[mainBase + MAIN_BUFF.heavyAtk] * ((skillMask >>> 1) & 1)
  bonus += mainEchoBuffs[mainBase + MAIN_BUFF.resonanceSkill] * ((skillMask >>> 2) & 1)
  bonus += mainEchoBuffs[mainBase + MAIN_BUFF.resonanceLiberation] * ((skillMask >>> 3) & 1)
  bonus += mainEchoBuffs[mainBase + MAIN_BUFF.echoSkill] * ((skillMask >>> 6) & 1)
  bonus += mainEchoBuffs[mainBase + MAIN_BUFF.coord] * ((skillMask >>> 7) & 1)
  // generic dmgBonus from the main echo, regardless of skill type or element
  bonus += mainEchoBuffs[mainBase + MAIN_BUFF.dmgBonus]

  const hp = terms.hp
  const dmgBonus = ctx.dmgBonus + (bonus / 100)
    + (calcConvert(ctx.charId, finalER) * ((skillMask >>> 6) & 1))
    + calcJingranFusion(ctx.charId, hp, ctx.jingranFortune)

  let atk = terms.atkBase + (ctx.baseAtk * ((mainEchoBuffs[mainBase + MAIN_BUFF.atkPercent] + s33AtkBonus) / 100))
    + mainEchoBuffs[mainBase + MAIN_BUFF.atkFlat]
  atk += calcErToAtk(ctx.charId, finalER, ctx.toggle0)
  atk += calcJingranAtk(ctx.charId, ctx.sequence, hp, ctx.jingranEverflow)
  if (ctx.charId === 1512) {
    atk += ctx.baseAtk * lilyAromaStacks(ctx.togglesBits) * lilySupportEr(finalER) * 0.001
  }

  // main-echo cr/cd (percent top stats, scaled to the 0..1 crit totals) and
  // the er-derived resonator bonuses
  let mrnyDmgBns = 0
  let critRateBns = mainEchoBuffs[mainBase + MAIN_BUFF.critRate] / 100
  let critDmgBns = mainEchoBuffs[mainBase + MAIN_BUFF.critDmg] / 100
  critRateBns += calcShoreCritRate(ctx.charId, finalER, ctx.shoreInner)
  critDmgBns += calcShoreCritDmg(ctx.charId, finalER, ctx.shoreInner, ctx.shoreSupernal)
  if (ctx.charId === 1512 && ctx.toggle0) {
    const excess = lilyExcessEr(finalER)
    critRateBns += excess * 0.005
    critDmgBns += excess / 100
  }
  if (ctx.charId === 1512 && (ctx.togglesBits & LILY_SILVERED_BIT) !== 0 && ((skillMask >>> 6) & 1) !== 0) {
    const supportEr = lilySupportEr(finalER)
    critRateBns += supportEr / 700
    critDmgBns += supportEr / 350
  }
  if (ctx.charId === 1209 && finalER > 0) {
    const erOver = Math.max(0, finalER - 100)
    mrnyDmgBns = Math.min(erOver * 0.25, 40) / 100
    if (((skillMask >>> 3) & 1) !== 0) {
      critRateBns += Math.min(erOver * 0.5, 80) / 100
      critDmgBns += Math.min(erOver, 160) / 100
    }
  }

  let shownCritRate = terms.critRate + critRateBns
  let shownCritDmg = terms.critDmg + critDmgBns
  // the marker's er bonus is a displayed dmg bonus, so limits see it too
  let shownBonus = dmgBonus + mrnyDmgBns * ctx.toggle0
  let avg: number

  switch (ctx.archetype) {
    // tune rupture, hack and negative effects use the packed crit/bonus values
    case ARCH_TUNE:
    case ARCH_HACK:
    case ARCH_SPECTRO:
    case ARCH_AERO:
    case ARCH_FUSION:
    case ARCH_GLACIO:
    case ARCH_ELECTRO: {
      const normal = ctx.multiplier * ctx.resMult * ctx.defMult * ctx.dmgReduction * ctx.dmgBonus * ctx.dmgAmplify * ctx.aux0
      avg = optimizerAverageDamage(normal, ctx.critRate, ctx.critDmg)
      shownCritRate = ctx.critRate
      shownCritDmg = ctx.critDmg
      shownBonus = ctx.dmgBonus
      break
    }

    case ARCH_DAMAGE:
    default: {
      const scaled = (hp * ctx.scalingHp) + (terms.def * ctx.scalingDef) + (atk * ctx.scalingAtk) + (finalER * ctx.scalingER)
      const baseMul = ctx.resMult * ctx.defMult * ctx.dmgReduction * ctx.dmgAmplify * ctx.aux0
      const multiplier = ctx.multiplier
        + calcJingranFireOfLifeMultiplier(ctx.charId, ctx.sequence, ctx.skillId, hp, ctx.togglesBits)
      const baseDamage = (scaled * multiplier + ctx.flatDmg) * baseMul * shownBonus
      avg = optimizerAverageDamage(baseDamage, shownCritRate, shownCritDmg)
      break
    }
  }

  if (constraints && !psssCstrs(constraints, atk, hp, terms.def, shownCritRate, shownCritDmg, finalER, shownBonus, avg)) {
    return LIMIT_FAILED
  }
  if (stats) {
    stats.atk = atk
    stats.hp = hp
    stats.def = terms.def
    stats.er = finalER
    stats.cr = shownCritRate * 100
    stats.cd = shownCritDmg * 100
    stats.bonus = (shownBonus - 1) * 100
    stats.amp = (ctx.dmgAmplify - 1) * 100
  }
  return avg
}
