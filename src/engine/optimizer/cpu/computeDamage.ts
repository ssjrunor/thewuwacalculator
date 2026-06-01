/*
  Author: Runor Ewhro
  Description: evaluates encoded optimizer combos on the cpu for both
               target-skill and rotation modes, including set effects,
               main-echo permutations, packed-context damage evaluation,
               stat extraction, and constraint filtering.
*/

import type { OptResultStats } from '@/engine/optimizer/types.ts'
import { getNegEffectDef } from '@/domain/gameData/negativeEffects'
import { getNegBase } from '@/engine/formulas/negativeEffects.ts'
import { getTuneLevel } from '@/engine/formulas/tuneRupture.ts'
import { makeCpuScratch, type CpuScratch } from '@/engine/optimizer/cpu/scratch.ts'
import { applySetFfct } from '@/engine/optimizer/cpu/setEffects.ts'
import { psssCstrs } from '@/engine/optimizer/constraints/statConstraints.ts'
import {
  ARCH_AERO,
  ARCH_DAMAGE,
  ARCH_ELECTRO,
  ARCH_FUSION,
  ARCH_GLACIO,
  ARCH_HACK,
  ARCH_HEAL,
  ARCH_SHIELD,
  ARCH_SPECTRO,
  ARCH_TUNE,
  ECHOES_PER_SET,
  MAIN_BUFF_LEN,
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
  STAT_HEAL_BON,
  STAT_HP_FLAT,
  STAT_HP_PCT,
  STAT_RES_SHRED,
  STAT_SHIELD_BON,
  STAT_SPECIAL,
  STAT_TUNE_BREAK,
} from '@/engine/optimizer/config/constants.ts'
import {
  PACKED_CTX_LEN as OPTPCKDCTXST,
  CTX_ARCH as OPT_CTX_ARCH,
  CTX_BASE_ATK as OPTCTXBASEbm,
  CTX_BASE_DEF as OPTCTXBASED2,
  CTX_BASE_HP as OPTCTXBASEna,
  CTX_COMBAT_AERO as OPTCTXCMBTAE,
  CTX_COMBAT_ELEC as OPTCTXCMBTLC,
  CTX_COMBAT_GLAC as OPTCTXCMBTGL,
  CTX_COMBAT_ERES as OPTCTXCMBTul,
  CTX_COMBAT_FUS as OPTCTXCMBTFS,
  CTX_COMBAT_SPEC as OPTCTXCMBTSP,
  CTX_ENEMY_RES as OPTCTXENEMYB,
  CTX_ENEMY_CLASS as OPTCTXENEMYC,
  CTX_ENEMY_LVL as OPTCTXENEMYL,
  CTX_FXD_DMG as OPTCTXFXDDMG,
  CTX_FLAT as OPT_CTX_FLAT,
  CTX_HIT_CNT as OPTCTXHITCNT,
  CTX_HIT_SCL as OPTCTXHITSCL,
  CTX_LEVEL as OPT_CTX_LVL,
  CTX_MULT as OPT_CTX_MULT,
  CTX_NEG_DMG as OPTCTXNEGFFC,
  CTX_NEG_CRIT as OPT_NEG_CRIT,
  CTX_NEG_FIXED as OPT_NEG_FIXED,
  CTX_SCLN_ATK as OPTCTXSCLNdl,
  CTX_SCLN_DEF as OPTCTXSCLND2,
  CTX_SCALE_ER as OPT_SCALE_ER,
  CTX_SCLN_HP as OPTCTXSCLNH2,
  CTX_SKILL_HEAL as OPTCTXSKLLHL,
  CTX_SKILL_SHLD as OPTCTXSKLLSH,
  CTX_AMPLIFY as OPTCTXSTTCMP,
  CTX_CRIT_DMG as OPTCTXSTTCCR,
  CTX_CRIT_RATE as OPTCTXSTTCfh,
  CTX_DEF_IGNORE as OPTCTXSTTCDE,
  CTX_DEF_SHRED as OPTCTXSTTCww,
  CTX_DMG_BONUS as OPTCTXSTTCDM,
  CTX_DMG_VULN as OPTCTXSTTCtr,
  CTX_FINAL_ATK as OPTCTXSTTCFN,
  CTX_FINAL_DEF as OPTCTXSTTCgc,
  CTX_FINAL_ER as OPTCTXSTTCvj,
  CTX_FINAL_HP as OPTCTXSTTCF2,
  CTX_FLAT_DMG as OPTCTXSTTCFL,
  CTX_HEAL_BONUS as OPTCTXSTTCHL,
  CTX_NEG_MULT as OPTCTXNEGFvl,
  CTX_RES_SHRED as OPTCTXSTTCRE,
  CTX_SHLD_BONUS as OPTCTXSTTCSH,
  CTX_SPECIAL as OPTCTXSTTCSP,
  CTX_TUNE_BREAK as OPTCTXSTTCTU,
  CTX_TUNE_BOOST as OPTCTXTUNERP,
  CTX_TUNE_CRIT as OPTCTXTUNErf,
} from '@/engine/optimizer/context/vector.ts'

export interface CmbDmgRslt {
  damage: number
  stats: OptResultStats
  mainIndex: number
}

// convert raw enemy resistance percent into the actual damage multiplier
function resistMult(enemyResPct: number): number {
  if (enemyResPct < 0) return 1 - enemyResPct / 200
  if (enemyResPct < 75) return 1 - enemyResPct / 100
  return 1 / (1 + 5 * (enemyResPct / 100))
}

// compute defense multiplier after def ignore and def shred are applied
function defenseMult(charLvl: number, enemyLevel: number, defIgnore: number, defShred: number): number {
  const enemyDefense = ((8 * enemyLevel) + 792) * (1 - (defIgnore + defShred) / 100)
  return (800 + 8 * charLvl) / (800 + 8 * charLvl + Math.max(0, enemyDefense))
}

// tune rupture uses enemy class scaling on top of normal multipliers
function classMult(enemyClass: number): number {
  if (enemyClass === 3 || enemyClass === 4) return 14
  if (enemyClass === 2) return 3
  return 1
}

// compute resistance multiplier from packed base res + combo-added res shred
function calcPackedRes(enemyBaseRes: number, resShred: number): number {
  return enemyBaseRes === 100
      ? 0
      : resistMult(enemyBaseRes - resShred)
}

// build per-combo set counts while avoiding duplicate kind contributions
// inside the same set. touched ids are tracked so clearing is cheap later.
function makeComboSets(
    scratch: CpuScratch,
    sets: Uint8Array,
    kinds: Uint16Array,
    comboIds: Int32Array,
): number {
  const setCounts = scratch.setCounts
  const tchdSetIds = scratch.tchdSetIds
  tchdSetIds.fill(0)

  let tchdSetCnt = 0

  for (let index = 0; index < ECHOES_PER_SET; index += 1) {
    const echoIndex = comboIds[index]
    const setId = sets[echoIndex]
    const kindId = kinds[echoIndex]

    // ignore invalid or out-of-range set ids
    if (setId < 0 || setId >= setCounts.length) {
      continue
    }

    // only count a set/kind pair once within the same combo
    let isDplcKind = false
    for (let previous = 0; previous < index; previous += 1) {
      const prevEchoNdx = comboIds[previous]
      if (sets[prevEchoNdx] === setId && kinds[prevEchoNdx] === kindId) {
        isDplcKind = true
        break
      }
    }
    if (isDplcKind) {
      continue
    }

    // first time this set appears in the combo, record it so we can clear later
    if (setCounts[setId] === 0) {
      tchdSetIds[tchdSetCnt] = setId
      tchdSetCnt += 1
    }

    setCounts[setId] += 1
  }

  return tchdSetCnt
}

// reset only the set counters that were touched by the current combo
function clrCmbSetStt(scratch: CpuScratch, tchdSetCnt: number): void {
  for (let index = 0; index < tchdSetCnt; index += 1) {
    scratch.setCounts[scratch.tchdSetIds[index]] = 0
  }
}

// build the combo's base stat vector from raw encoded echoes, then apply set effects
function mkBaseCmbVct(
    scratch: CpuScratch,
    stats: Float32Array,
    setConstLut: Float32Array,
    comboIds: Int32Array,
    tchdSetCnt: number,
): Float32Array {
  const comboVector = scratch.baseCmbVctr
  comboVector.fill(0)

  // sum all encoded stats from the 5 chosen echoes
  for (let index = 0; index < ECHOES_PER_SET; index += 1) {
    const echoIndex = comboIds[index]
    const statsBase = echoIndex * STAT_STRIDE

    for (let offset = 0; offset < STAT_STRIDE; offset += 1) {
      comboVector[offset] += stats[statsBase + offset]
    }
  }

  // inject 2pc / 5pc style encoded set effects into the summed vector
  applySetFfct(comboVector, scratch.setCounts, scratch.tchdSetIds, tchdSetCnt, setConstLut)

  return comboVector
}

// derive the per-main version of the combo vector by adding the chosen main echo buffs
function mkMainCmbVct(
    scratch: CpuScratch,
    baseVector: Float32Array,
    mainEchoBuffs: Float32Array,
    mainEchoNdx: number,
): Float32Array {
  const comboVector = scratch.comboVector
  comboVector.set(baseVector)

  const mainBase = mainEchoNdx * MAIN_BUFF_LEN
  for (let offset = 0; offset < MAIN_BUFF_LEN; offset += 1) {
    comboVector[offset] += mainEchoBuffs[mainBase + offset]
  }

  return comboVector
}

// materialize visible summary stats from a packed context + resolved combo vector
function fillRsltStts(
    out: OptResultStats,
    context: Float32Array,
    contextOffset: number,
    comboVector: Float32Array,
): void {
  out.atk =
      context[contextOffset + OPTCTXSTTCFN] +
      (context[contextOffset + OPTCTXBASEbm] * comboVector[STAT_ATK_PCT] / 100) +
      comboVector[STAT_ATK_FLAT]

  out.hp =
      context[contextOffset + OPTCTXSTTCF2] +
      (context[contextOffset + OPTCTXBASEna] * comboVector[STAT_HP_PCT] / 100) +
      comboVector[STAT_HP_FLAT]

  out.def =
      context[contextOffset + OPTCTXSTTCgc] +
      (context[contextOffset + OPTCTXBASED2] * comboVector[STAT_DEF_PCT] / 100) +
      comboVector[STAT_DEF_FLAT]

  out.er = context[contextOffset + OPTCTXSTTCvj] + comboVector[STAT_ENERGY]
  out.cr = context[contextOffset + OPTCTXSTTCfh] + comboVector[STAT_CRIT_RATE]
  out.cd = context[contextOffset + OPTCTXSTTCCR] + comboVector[STAT_CRIT_DMG]
  out.bonus = context[contextOffset + OPTCTXSTTCDM] + comboVector[STAT_DMG_BONUS]
  out.amp = context[contextOffset + OPTCTXSTTCMP] + comboVector[STAT_AMPLIFY]
}

// evaluate one packed context against one resolved combo vector
// this is the core cpu-side damage evaluator.
function evalPckdCtxD(
    context: Float32Array,
    contextOffset: number,
    comboVector: Float32Array,
): number {
  const finalAtk =
      context[contextOffset + OPTCTXSTTCFN] +
      (context[contextOffset + OPTCTXBASEbm] * comboVector[STAT_ATK_PCT] / 100) +
      comboVector[STAT_ATK_FLAT]

  const finalHp =
      context[contextOffset + OPTCTXSTTCF2] +
      (context[contextOffset + OPTCTXBASEna] * comboVector[STAT_HP_PCT] / 100) +
      comboVector[STAT_HP_FLAT]

  const finalDef =
      context[contextOffset + OPTCTXSTTCgc] +
      (context[contextOffset + OPTCTXBASED2] * comboVector[STAT_DEF_PCT] / 100) +
      comboVector[STAT_DEF_FLAT]

  const finalER = context[contextOffset + OPTCTXSTTCvj] + comboVector[STAT_ENERGY]

  const critRatePct = context[contextOffset + OPTCTXSTTCfh] + comboVector[STAT_CRIT_RATE]
  const critDmgPct = context[contextOffset + OPTCTXSTTCCR] + comboVector[STAT_CRIT_DMG]

  const hlngBnsPct =
      context[contextOffset + OPTCTXSTTCHL] +
      comboVector[STAT_HEAL_BON] +
      context[contextOffset + OPTCTXSKLLHL]

  const shldBnsPct =
      context[contextOffset + OPTCTXSTTCSH] +
      comboVector[STAT_SHIELD_BON] +
      context[contextOffset + OPTCTXSKLLSH]

  const dmgBnsPct = context[contextOffset + OPTCTXSTTCDM] + comboVector[STAT_DMG_BONUS]
  const amplifyPct = context[contextOffset + OPTCTXSTTCMP] + comboVector[STAT_AMPLIFY]
  const specialPct = context[contextOffset + OPTCTXSTTCSP] + comboVector[STAT_SPECIAL]

  const flatDmg =
      context[contextOffset + OPTCTXSTTCFL] +
      comboVector[STAT_FLAT_DMG] +
      context[contextOffset + OPT_CTX_FLAT]

  const resShred = context[contextOffset + OPTCTXSTTCRE] + comboVector[STAT_RES_SHRED]
  const defIgnore = context[contextOffset + OPTCTXSTTCDE] + comboVector[STAT_DEF_IGNORE]
  const defShred = context[contextOffset + OPTCTXSTTCww] + comboVector[STAT_DEF_SHRED]
  const dmgVulnPct = context[contextOffset + OPTCTXSTTCtr] + comboVector[STAT_DMG_VULN]

  const negFfctMltp =
      context[contextOffset + OPTCTXNEGFvl]

  const tuneBrkBstPc =
      context[contextOffset + OPTCTXSTTCTU] +
      comboVector[STAT_TUNE_BREAK]

  const resMult = calcPackedRes(context[contextOffset + OPTCTXENEMYB], resShred)

  const defMult = defenseMult(
      context[contextOffset + OPT_CTX_LVL],
      context[contextOffset + OPTCTXENEMYL],
      defIgnore,
      defShred,
  )

  const critRate = Math.max(0, Math.min(1, critRatePct / 100))
  const critDmg = critDmgPct / 100

  // generic stat-scaling term shared by most archetypes
  const scaledValue =
      finalAtk * context[contextOffset + OPTCTXSCLNdl] +
      finalHp * context[contextOffset + OPTCTXSCLNH2] +
      finalDef * context[contextOffset + OPTCTXSCLND2] +
      finalER * context[contextOffset + OPT_SCALE_ER]

  switch (context[contextOffset + OPT_CTX_ARCH]) {
    case ARCH_HEAL: {
      const total =
          ((scaledValue * context[contextOffset + OPT_CTX_MULT]) + flatDmg) *
          (1 + hlngBnsPct / 100)

      return Math.max(1, Math.floor(total))
    }

    case ARCH_SHIELD: {
      const total =
          ((scaledValue * context[contextOffset + OPT_CTX_MULT]) + flatDmg) *
          (1 + shldBnsPct / 100)

      return Math.max(1, Math.floor(total))
    }

    case ARCH_TUNE: {
      const normal =
          context[contextOffset + OPTCTXHITSCL] *
          getTuneLevel(context[contextOffset + OPT_CTX_LVL]) *
          classMult(context[contextOffset + OPTCTXENEMYC]) *
          resMult *
          defMult *
          (1 + dmgVulnPct / 100) *
          (1 + dmgBnsPct / 100) *
          (1 + amplifyPct / 100) *
          (1 + tuneBrkBstPc / 100)

      const crit = normal * context[contextOffset + OPTCTXTUNERP]

      return context[contextOffset + OPTCTXTUNErf] >= 1
          ? crit
          : (crit * context[contextOffset + OPTCTXTUNErf]) +
          (normal * (1 - context[contextOffset + OPTCTXTUNErf]))
    }

    case ARCH_HACK: {
      const normal =
          context[contextOffset + OPTCTXHITSCL] *
          getTuneLevel(context[contextOffset + OPT_CTX_LVL]) *
          classMult(context[contextOffset + OPTCTXENEMYC]) *
          resMult *
          defMult *
          (1 + dmgVulnPct / 100) *
          (1 + dmgBnsPct / 100) *
          (1 + amplifyPct / 100)

      const crit = normal * context[contextOffset + OPTCTXTUNERP]

      return context[contextOffset + OPTCTXTUNErf] >= 1
          ? crit
          : (crit * context[contextOffset + OPTCTXTUNErf]) +
          (normal * (1 - context[contextOffset + OPTCTXTUNErf]))
    }

    case ARCH_SPECTRO:
    case ARCH_AERO:
    case ARCH_FUSION:
    case ARCH_GLACIO:
    case ARCH_ELECTRO: {
      const archetype = context[contextOffset + OPT_CTX_ARCH]

      const prmrStck =
          archetype === ARCH_SPECTRO
              ? context[contextOffset + OPTCTXCMBTSP]
              : archetype === ARCH_AERO
                  ? context[contextOffset + OPTCTXCMBTAE]
                  : archetype === ARCH_FUSION
                      ? context[contextOffset + OPTCTXCMBTFS]
                      : archetype === ARCH_GLACIO
                          ? context[contextOffset + OPTCTXCMBTGL]
                      : context[contextOffset + OPTCTXCMBTLC]
      const xtrLctrRageS =
          archetype === ARCH_ELECTRO
              && prmrStck > getNegEffectDef('electroFlare')
              ? context[contextOffset + OPTCTXCMBTul]
              : 0

      if (prmrStck <= 0 && xtrLctrRageS <= 0) {
        return 0
      }

      const perStackBase =
          getNegBase(
          archetype === ARCH_SPECTRO
              ? 'spectroFrazzle'
              : archetype === ARCH_AERO
                  ? 'aeroErosion'
                  : archetype === ARCH_FUSION
                      ? 'fusionBurst'
                      : archetype === ARCH_GLACIO
                          ? 'glacioChafe'
                      : 'electroFlare',
          context[contextOffset + OPT_CTX_LVL],
          prmrStck,
          {
            fixedMv: context[contextOffset + OPT_NEG_FIXED] > 0
              ? context[contextOffset + OPT_NEG_FIXED]
              : undefined,
          },
      ) + (
            archetype === ARCH_ELECTRO
                ? getNegBase(
                  'electroFlare',
                  context[contextOffset + OPT_CTX_LVL],
                  xtrLctrRageS,
                  {
                    fixedMv: context[contextOffset + OPT_NEG_FIXED] > 0
                      ? context[contextOffset + OPT_NEG_FIXED]
                      : undefined,
                  },
                )
                : 0
          )

      const normal = Math.floor(
          perStackBase *
          context[contextOffset + OPTCTXHITSCL] *
          (1 + negFfctMltp) *
          (1 + amplifyPct / 100) *
          (1 + dmgBnsPct / 100) *
          (1 + specialPct / 100) *
          resMult *
          defMult *
          (1 + dmgVulnPct / 100),
      )

      const crit = normal * context[contextOffset + OPTCTXNEGFFC]

      return context[contextOffset + OPT_NEG_CRIT] >= 1
          ? crit
          : (crit * context[contextOffset + OPT_NEG_CRIT]) +
          (normal * (1 - context[contextOffset + OPT_NEG_CRIT]))
    }

    case ARCH_DAMAGE:
    default: {
      // fixed damage ignores normal stat-scaling and crit calculations
      if (context[contextOffset + OPTCTXFXDDMG] > 0) {
        return Math.max(1, Math.floor(context[contextOffset + OPTCTXFXDDMG]))
      }

      const normal =
          (scaledValue * context[contextOffset + OPT_CTX_MULT] +
              flatDmg * context[contextOffset + OPTCTXHITCNT]) *
          resMult *
          defMult *
          (1 + dmgVulnPct / 100) *
          (1 + dmgBnsPct / 100) *
          (1 + amplifyPct / 100) *
          (1 + specialPct / 100)

      const crit = normal * critDmg
      return critRate >= 1 ? crit : (crit * critRate) + (normal * (1 - critRate))
    }
  }
}

// create scratch state once and reuse it across combo evaluations
export function mkCmbDmgScrt(): CpuScratch {
  return makeCpuScratch()
}

// evaluate one target-skill combo across every possible main echo in that combo
// and return the best passing result.
export function evalTgtSkllC(options: {
  context: Float32Array
  stats: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  constraints: Float32Array
  comboIds: Int32Array
  lockMainIdx: number
  scratch: CpuScratch
}): CmbDmgRslt | null {
  const {
    context,
    stats,
    sets,
    kinds,
    setConstLut,
    mainEchoBuffs: mainEchoBuffs,
    constraints,
    comboIds,
    lockMainIdx: lockMainNdx,
    scratch,
  } = options

  const tchdSetCnt = makeComboSets(scratch, sets, kinds, comboIds)
  const baseVector = mkBaseCmbVct(scratch, stats, setConstLut, comboIds, tchdSetCnt)

  let bestDamage = 0
  let bestMainIndex = -1
  let bestStats: OptResultStats | null = null

  for (let index = 0; index < comboIds.length; index += 1) {
    const mainIndex = comboIds[index]

    // when main is locked, only evaluate that one candidate
    if (lockMainNdx >= 0 && mainIndex !== lockMainNdx) {
      continue
    }

    const comboVector = mkMainCmbVct(scratch, baseVector, mainEchoBuffs, mainIndex)
    const damage = evalPckdCtxD(context, 0, comboVector)

    if (damage <= 0) {
      continue
    }

    const resultStats: OptResultStats = {
      atk: 0,
      hp: 0,
      def: 0,
      er: 0,
      cr: 0,
      cd: 0,
      bonus: 0,
      amp: 0,
    }

    fillRsltStts(resultStats, context, 0, comboVector)

    const passes = psssCstrs(
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

  clrCmbSetStt(scratch, tchdSetCnt)

  return bestStats && bestMainIndex >= 0
      ? { damage: bestDamage, stats: bestStats, mainIndex: bestMainIndex }
      : null
}

export { OPTPCKDCTXST as OPTIMIZER_PACKED_CONTEXT_STRIDE }
