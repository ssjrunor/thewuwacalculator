/*
  Author: Runor Ewhro
  Description: Packs compiled optimizer skill context into the fixed float
               layout used by CPU/GPU execution and provides patch helpers
               for per-job gpu dispatch metadata.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { SkillDef } from '@/domain/entities/stats.ts'
import type { CompTargetSkill } from '@/engine/optimizer/types.ts'
import { getNegBase } from '@/engine/formulas/negativeEffects.ts'
import {
  MAX_ECHO_COST,
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
  BASE_INDEX,
  BASE_DEF,
  BASE_ER,
  BASE_HP,
  CRIT_DMG,
  CRIT_RATE,
  WORKGROUP_BASE,
  DEF_MUL,
  DMG_AMP,
  DMG_BNS,
  DMG_VULN,
  DMG_RED,
  FINAL_ATK,
  FINAL_DEF,
  FINAL_HP,
  FLAT_DMG,
  LOCKED_PACKED,
  META0,
  META1,
  MV,
  RES_MUL,
  SCALING_ATK,
  SCALING_DEF,
  SCALING_ER,
  SCALING_HP,
  SET_MASK,
  SKILL_ID,
  TOGGLES,
  COMBO_N,
} from '@/engine/optimizer/config/constants.ts'
import { getTuneLevel } from '@/engine/formulas/tuneRupture.ts'
import { encSkllId } from '@/engine/optimizer/encode/skillId.ts'

// encode a few resonator-specific runtime toggles into a bitmask
function mkSpecTggl(runtime: ResRuntime, characterId: number): number {
  let toggles = 0

  if (characterId === 1206 && runtime.state.controls['resonator:1206:my_moment:active']) {
    toggles |= 1
  }

  if (characterId === 1209 && runtime.state.controls['resonator:1209:interfered_marker:active']) {
    toggles |= 1
  }

  return toggles >>> 0
}

// small helper for checking whether a skill has any of a set of types
function hasSkillType(skill: SkillDef, ...types: string[]): boolean {
  return skill.skillType.some((type) => types.includes(type))
}

// brant-kun converts energy regen above 150 into atk, depending on toggle state
function calcErToAtk(characterId: number, finalER: number, toggle0: boolean): number {
  if (characterId !== 1206) {
    return 0
  }

  const erOver = Math.max(0, finalER - 150)
  return toggle0 ? Math.min(erOver * 20, 2600) : Math.min(erOver * 12, 1560)
}

// augusta converts crit rate overflow into crit damage at certain sequences
function calcCritConvert(characterId: number, sequence: number, critRateTotal: number): number {
  if (characterId !== 1306 || sequence < 2) {
    return 0
  }

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

// sigrika-chan gets extra echo skill bonus from excess energy regen
function calcEchoSkill(characterId: number, finalER: number): number {
  if (characterId !== 1412 || finalER <= 125) {
    return 0
  }

  return Math.min((finalER - 125) * 2, 50)
}

// prof. mornye gets dmg bonus from excess energy regen under the toggle state
function calcDmgBonus(characterId: number, finalER: number): number {
  if (characterId !== 1209) {
    return 0
  }

  return Math.min(Math.max(0, finalER - 100) * 0.25, 40)
}

// prof. mornye gets crit rate on liberation-type skills from excess energy regen
function calcCritRate(characterId: number, finalER: number): number {
  if (characterId !== 1209) {
    return 0
  }

  return Math.min(Math.max(0, finalER - 100) * 0.5, 80)
}

// even more... prof. mornye gets crit damage on liberation-type skills from excess energy regen
function calcCritDmg(characterId: number, finalER: number): number {
  if (characterId !== 1209) {
    return 0
  }

  return Math.min(Math.max(0, finalER - 100), 160)
}

// remove special resonator-side conversions so packed context stores normalized base terms
function normPckdCtx(options: {
  compiled: CompTargetSkill
  skill: SkillDef
  toggle0: boolean
}): {
  finalAtk: number
  dmgBonus: number
  critRate: number
  critDmg: number
} {
  const { compiled, skill, toggle0 } = options

  let finalAtk = compiled.statFinAtk
  let dmgBonus = compiled.statDmgBonus
  let critRate = compiled.statCritRate
  let critDmg = compiled.statCritDmg

  finalAtk -= calcErToAtk(compiled.characterId, compiled.statFinEr, toggle0)

  critDmg -= calcCritConvert(
      compiled.characterId,
      compiled.sequence,
      compiled.statCritRate / 100,
  ) * 100

  if (hasSkillType(skill, 'echoSkill')) {
    dmgBonus -= calcEchoSkill(compiled.characterId, compiled.statFinEr)
  }

  if (toggle0) {
    dmgBonus -= calcDmgBonus(compiled.characterId, compiled.statFinEr)
  }

  if (hasSkillType(skill, 'resonanceLiberation', 'ultimate')) {
    critRate -= calcCritRate(compiled.characterId, compiled.statFinEr)
    critDmg -= calcCritDmg(compiled.characterId, compiled.statFinEr)
  }

  return {
    finalAtk,
    dmgBonus,
    critRate,
    critDmg,
  }
}

// pack resonator id, sequence, combo mode, combo k, and max cost into one u32
function buildMeta0(characterId: number, sequence: number, comboMode: number, comboK: number): number {
  return (
      (characterId & 0xfff) |
      ((sequence & 0xf) << 12) |
      ((comboMode & 0x3) << 16) |
      ((comboK & 0x7) << 18) |
      ((MAX_ECHO_COST & 0x3f) << 21)
  ) >>> 0
}

// pack combo count into meta1
function buildMeta1(comboCount: number): number {
  return comboCount >>> 0
}

// tune rupture uses enemy class scaling
function classMult(enemyClass: number): number {
  if (enemyClass === 3 || enemyClass === 4) {
    return 14
  }

  if (enemyClass === 2) {
    return 3
  }

  return 1
}

// build the pre-scaled base multiplier for negative-effect archetypes
function mkNegFfctBas(compiled: CompTargetSkill): number {
  const prmrStck = compiled.archetype === ARCH_SPECTRO
      ? compiled.combatSpectro
      : compiled.archetype === ARCH_AERO
          ? compiled.combatAero
          : compiled.archetype === ARCH_FUSION
              ? compiled.combatFusion
              : compiled.archetype === ARCH_GLACIO
                  ? compiled.combatGlacio
              : compiled.combatElectro
  const xtrLctrRageS = compiled.archetype === ARCH_ELECTRO
      ? compiled.combatElecRage
      : 0

  if (prmrStck <= 0 && xtrLctrRageS <= 0) {
    return 0
  }

  const base =
      getNegBase(
      compiled.archetype === ARCH_SPECTRO
          ? 'spectroFrazzle'
          : compiled.archetype === ARCH_AERO
              ? 'aeroErosion'
              : compiled.archetype === ARCH_FUSION
                  ? 'fusionBurst'
                  : compiled.archetype === ARCH_GLACIO
                      ? 'glacioChafe'
                  : 'electroFlare',
      compiled.level,
      prmrStck,
      { fixedMv: compiled.negEfxFxdMv > 0 ? compiled.negEfxFxdMv : undefined },
  ) + (
        compiled.archetype === ARCH_ELECTRO
          ? getNegBase(
            'electroFlare',
            compiled.level,
            xtrLctrRageS,
            { fixedMv: compiled.negEfxFxdMv > 0 ? compiled.negEfxFxdMv : undefined },
          )
          : 0
      )

  return base * compiled.hitScale * (1 + compiled.negEfxMult)
}

// pack one compiled target context into the fixed float/u32 layout used by execution
export function packTargetCtx(options: {
  compiled: CompTargetSkill
  skill: SkillDef
  runtime: ResRuntime
  comboN: number
  comboK: number
  comboCount: number
  comboBaseIndex: number
  lockEchoIdx: number
  setRtMask: number
}): Float32Array {
  const {
    compiled,
    skill,
    runtime,
    comboN,
    comboK,
    comboCount,
    comboBaseIndex: cmbBaseNdx,
    lockEchoIdx: lockEchoNdx,
    setRtMask: setRtMask,
  } = options

  const out = new Float32Array(CTX_FLOATS)
  const u32 = new Uint32Array(out.buffer)

  const ttlHitScl = compiled.hitScale > 0 ? compiled.hitScale : compiled.multiplier
  const ttlHitCnt = Math.max(1, compiled.hitCount || 1)
  const toggles = mkSpecTggl(runtime, compiled.characterId)

  const normalized = normPckdCtx({
    compiled,
    skill,
    toggle0: (toggles & 1) !== 0,
  })

  const archetype = compiled.archetype

  let pckdMltp = ttlHitScl
  let pckdFlatDmg = (compiled.statFlatDmg + compiled.flat) * ttlHitCnt
  let pckdDmgBns = 1 + (normalized.dmgBonus / 100)
  let pckdMplf = 1 + (compiled.statAmp / 100)
  let pckdCritRate = normalized.critRate / 100
  let pckdCritDmg = normalized.critDmg / 100
  let packedAux0 = 1 + (compiled.statSpec / 100)

  // archetype-specific packing adjusts how the execution backend interprets multiplier terms
  switch (archetype) {
    case ARCH_TUNE:
    case ARCH_HACK:
      pckdMltp =
          compiled.hitScale *
          getTuneLevel(compiled.level) *
          classMult(compiled.enemyClass)
      pckdFlatDmg = 0
      pckdDmgBns = 1 + (compiled.statDmgBonus / 100)
      pckdMplf = 1 + (compiled.statAmp / 100)
      pckdCritRate = compiled.tuneRptrCrny
      pckdCritDmg = compiled.tuneCritDmg
      packedAux0 = 1 + (compiled.statTuneBrcq / 100)
      break

    case ARCH_SPECTRO:
    case ARCH_AERO:
    case ARCH_FUSION:
    case ARCH_GLACIO:
    case ARCH_ELECTRO:
      pckdMltp = mkNegFfctBas(compiled)
      pckdFlatDmg = 0
      pckdDmgBns = 1 + (compiled.statDmgBonus / 100)
      pckdMplf = 1 + (compiled.statAmp / 100)
      pckdCritRate = compiled.negEfxCritoo
      pckdCritDmg = compiled.negEfxCritsa
      packedAux0 = 1 + (compiled.statSpec / 100)
      break

    case ARCH_DAMAGE:
    default:
      break
  }

  const skillId = encSkllId({
    label: skill.label,
    skillType: skill.skillType,
    tab: skill.tab,
    element: skill.element,
  })

  out[BASE_ATK] = compiled.baseAtk
  out[BASE_HP] = compiled.baseHp
  out[BASE_DEF] = compiled.baseDef
  out[BASE_ER] = compiled.statFinEr

  out[FINAL_ATK] = normalized.finalAtk
  out[FINAL_HP] = compiled.statFinHp
  out[FINAL_DEF] = compiled.statFinDef

  out[SCALING_ATK] = compiled.scalingAtk
  out[SCALING_HP] = compiled.scalingHp
  out[SCALING_DEF] = compiled.scalingDef
  out[SCALING_ER] = compiled.scalingER

  out[MV] = pckdMltp
  out[FLAT_DMG] = pckdFlatDmg
  out[RES_MUL] = compiled.resMult
  out[DEF_MUL] = compiled.defMult
  out[DMG_RED] = compiled.dmgReduction
  out[DMG_BNS] = pckdDmgBns
  out[DMG_AMP] = pckdMplf
  out[DMG_VULN] = compiled.statDmgVuln
  out[CRIT_RATE] = pckdCritRate
  out[CRIT_DMG] = pckdCritDmg
  out[AUX0] = packedAux0
  out[ARCHETYPE] = archetype

  u32[TOGGLES] = toggles
  u32[SKILL_ID] = skillId
  u32[META0] = buildMeta0(compiled.characterId, compiled.sequence, 0, comboK)
  u32[META1] = buildMeta1(comboCount)
  u32[LOCKED_PACKED] = lockEchoNdx < 0 ? 0 : ((lockEchoNdx + 1) >>> 0)
  u32[BASE_INDEX] = cmbBaseNdx >>> 0
  u32[SET_MASK] = setRtMask >>> 0
  u32[COMBO_N] = comboN >>> 0
  u32[WORKGROUP_BASE] = 0

  return out
}

// patch a base context into the per-gpu-job variant without rebuilding the full compiled context
export function ptchTgtCtxFo(options: {
  baseContext: Float32Array
  comboN: number
  comboK: number
  comboCount: number
  comboBaseIndex: number
  lockEchoIdx: number
  comboMode?: number
}): Float32Array {
  const out = new Float32Array(options.baseContext)
  const u32 = new Uint32Array(out.buffer)

  const characterId = u32[META0] & 0xfff
  const sequence = (u32[META0] >>> 12) & 0xf

  u32[META0] = buildMeta0(characterId, sequence, options.comboMode ?? 2, options.comboK)
  u32[META1] = buildMeta1(options.comboCount)
  u32[LOCKED_PACKED] = options.lockEchoIdx < 0 ? 0 : ((options.lockEchoIdx + 1) >>> 0)
  u32[BASE_INDEX] = options.comboBaseIndex >>> 0
  u32[COMBO_N] = options.comboN >>> 0
  u32[WORKGROUP_BASE] = 0

  return out
}

// update the dispatch workgroup base in-place results before a gpu dispatch
export function ptchTgtCtxDi(
    context: Float32Array,
    wgBase: number,
): void {
  new Uint32Array(context.buffer)[WORKGROUP_BASE] = wgBase >>> 0
}
