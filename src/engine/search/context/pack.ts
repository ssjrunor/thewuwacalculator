/*
  Author: Runor Ewhro
  description: packs compiled optimizer skill context into the fixed float
               layout used by CPU/GPU execution and provides patch helpers
               for per-job gpu dispatch metadata.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { SkillDef } from '@/domain/entities/stats.ts'
import type { CompTargetSkill } from '@/engine/search/context/compiled.ts'
import { calcReflectingShadows } from '@/engine/search/score/specialMath'
import {
  isLilyErCritSkill, lilyExcessEr, lilySupportEr, lilyAromaStacks,
  LILY_AROMA_SHIFT, LILY_SILVERED_BIT,
} from '@/engine/search/score/lily'
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
  CANDIDATE_FLOOR,
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
} from '@/engine/search/layout/constants.ts'
import { getEnemyMaxOffTune, getTuneLevel } from '@/engine/formulas/tuneRupture.ts'
import { encSkllId } from '@/engine/search/encode/skillId.ts'
import {
  calcJingranFireOfLifeMultiplier,
  getJingranFortune,
  hasJingranEverflow,
  JINGRAN_EVERFLOW_BIT,
  JINGRAN_FIRE_OF_LIFE_BIT,
  JINGRAN_FORTUNE_MASK,
  JINGRAN_FORTUNE_SHIFT,
  packJingranLibLevel,
} from '@/engine/search/score/jingran.ts'

// encode a few resonator-specific runtime toggles into a bitmask
function mkSpecTggl(runtime: ResRuntime, characterId: number): number {
  let toggles = 0

  if (characterId === 1512) {
    const stacks = Number(runtime.state.controls['resonator:1512:dream_aroma:stacks'] ?? 0)
    toggles |= Math.max(0, Math.min(4, Math.trunc(stacks))) << LILY_AROMA_SHIFT
    if (runtime.state.controls['resonator:1512:silvered_dream:active']) toggles |= LILY_SILVERED_BIT
  }

  if (characterId === 1206 && runtime.state.controls['resonator:1206:my_moment:active']) {
    toggles |= 1
  }

  if (characterId === 1209 && runtime.state.controls['resonator:1209:interfered_marker:active']) {
    toggles |= 1
  }

  if (characterId === 1505 && runtime.state.controls['resonator:1505:inner_stellarealm:active']) {
    toggles |= 1 << 1
  }

  if (characterId === 1505 && runtime.state.controls['resonator:1505:supernal_stellarealm:active']) {
    toggles |= 1 << 2
  }

  if (characterId === 1212) {
    const fortune = Number(runtime.state.controls['resonator:1212:fortune_in_disguise:stacks'] ?? 0)
    toggles |= (Math.max(0, Math.min(JINGRAN_FORTUNE_MASK, Math.trunc(fortune))) << JINGRAN_FORTUNE_SHIFT)

    toggles |= packJingranLibLevel(runtime.base.skillLevels.resonanceLiberation)

    if (
      runtime.state.controls['resonator:1212:yinghuo:active'] &&
      runtime.state.controls['resonator:1212:fire_of_life:active']
    ) {
      toggles |= JINGRAN_FIRE_OF_LIFE_BIT
    }

    if (runtime.state.controls['sequence:1212:s3:active']) {
      toggles |= JINGRAN_EVERFLOW_BIT
    }
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

// Prof. Mornye gains crit damage on liberation skills from excess Energy Regen.
function calcCritDmg(characterId: number, finalER: number): number {
  if (characterId !== 1209) {
    return 0
  }

  return Math.min(Math.max(0, finalER - 100), 160)
}

// shorekeeper grants team crit stats from her own final energy regen.
function calcShoreCritRate(characterId: number, finalER: number, innerOn: boolean): number {
  if (characterId !== 1505 || !innerOn) {
    return 0
  }

  return Math.min(Math.max(0, finalER * 0.05), 12.5)
}

function calcShoreCritDmg(characterId: number, finalER: number, innerOn: boolean, supernalOn: boolean): number {
  if (characterId !== 1505 || !innerOn || !supernalOn) {
    return 0
  }

  return Math.min(Math.max(0, finalER * 0.1), 25)
}

function calcJingranAtk(characterId: number, sequence: number, finalHp: number, everflowOn: boolean): number {
  if (characterId !== 1212) {
    return 0
  }

  return sequence >= 3 && everflowOn
    ? Math.min(Math.max(0, finalHp * 0.05), 2500)
    : Math.min(Math.max(0, finalHp * 0.036), 1800)
}

function calcJingranFusion(characterId: number, finalHp: number, fortuneStacks: number): number {
  if (characterId !== 1212) {
    return 0
  }

  return Math.min(Math.max(0, finalHp * 0.0015), 75) +
    Math.min(Math.max(0, finalHp * 0.00005), 2.5) * Math.max(0, fortuneStacks)
}

// remove resonator-side conversions; packed context stores normalized base terms.
function normPckdCtx(options: {
  compiled: CompTargetSkill
  skill: SkillDef
  toggles: number
}): {
  finalAtk: number
  dmgBonus: number
  critRate: number
  critDmg: number
} {
  const { compiled, skill, toggles } = options
  const toggle0 = (toggles & 1) !== 0
  const shoreInner = (toggles & (1 << 1)) !== 0
  const shoreSupernal = (toggles & (1 << 2)) !== 0

  let finalAtk = compiled.statFinAtk
  let dmgBonus = compiled.statDmgBonus
  let critRate = compiled.statCritRate
  let critDmg = compiled.statCritDmg

  if (isLilyErCritSkill(compiled.characterId, skill.id)) {
    const excess = lilyExcessEr(compiled.statFinEr)
    critRate -= excess * 0.5
    critDmg -= excess
  }

  if (compiled.characterId === 1512) {
    const supportEr = lilySupportEr(compiled.statFinEr)
    finalAtk -= compiled.baseAtk * lilyAromaStacks(toggles) * supportEr * 0.001
    if ((toggles & LILY_SILVERED_BIT) !== 0 && hasSkillType(skill, 'echoSkill')) {
      critRate -= supportEr / 7
      critDmg -= supportEr * 2 / 7
    }
  }

  finalAtk -= calcErToAtk(compiled.characterId, compiled.statFinEr, toggle0)
  finalAtk -= calcJingranAtk(
      compiled.characterId,
      compiled.sequence,
      compiled.statFinHp,
      hasJingranEverflow(toggles),
  )

  dmgBonus -= calcJingranFusion(
      compiled.characterId,
      compiled.statFinHp,
      getJingranFortune(toggles),
  )

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
    // remove the base-build ER conversion before candidate Echo ER is added; candidate scoring reapplies the conversion once.
    dmgBonus -= calcReflectingShadows(compiled.characterId, compiled.statFinEr)
  }

  if (hasSkillType(skill, 'resonanceLiberation', 'ultimate')) {
    critRate -= calcCritRate(compiled.characterId, compiled.statFinEr)
    critDmg -= calcCritDmg(compiled.characterId, compiled.statFinEr)
  }

  critRate -= calcShoreCritRate(compiled.characterId, compiled.statFinEr, shoreInner)
  critDmg -= calcShoreCritDmg(compiled.characterId, compiled.statFinEr, shoreInner, shoreSupernal)

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
    | (isLilyErCritSkill(compiled.characterId, skill.id) || compiled.reflectingShadows ? 1 : 0)
  const skillId = encSkllId({
    label: skill.label,
    skillType: skill.skillType,
    tab: skill.tab,
    element: skill.element,
  })

  const normalized = normPckdCtx({
    compiled,
    skill,
    toggles,
  })

  const archetype = compiled.archetype

  let pckdMltp = ttlHitScl - calcJingranFireOfLifeMultiplier(
      compiled.characterId,
      compiled.sequence,
      skillId,
      compiled.statFinHp,
      toggles,
  )
  let pckdFlatDmg = (compiled.statFlatDmg + compiled.flat) * ttlHitCnt
  let pckdDmgBns = 1 + (normalized.dmgBonus / 100)
  let pckdMplf = 1 + (compiled.statAmp / 100)
  let pckdCritRate = normalized.critRate / 100
  let pckdCritDmg = normalized.critDmg / 100
  let packedAux0 = 1 + (compiled.statFinalDmg / 100)

  // archetype-specific packing adjusts how the execution backend interprets multiplier terms
  switch (archetype) {
    case ARCH_TUNE:
    case ARCH_HACK:
      pckdMltp =
          compiled.hitScale *
          getTuneLevel(compiled.level) *
          getEnemyMaxOffTune(compiled.enemyClass)
      pckdFlatDmg = 0
      pckdDmgBns = 1 + (compiled.statDmgBonus / 100)
      pckdMplf = 1 + (compiled.statAmp / 100)
      pckdCritRate = compiled.statCritRate / 100
      pckdCritDmg = compiled.statCritDmg / 100
      packedAux0 =
        (1 + (compiled.statTuneBrcq / 100)) *
        (1 + (compiled.statFinalDmg / 100))
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
      packedAux0 = 1 + (compiled.statFinalDmg / 100)
      break

    case ARCH_DAMAGE:
    default:
      break
  }

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
  candidateFloor?: number
}): Float32Array {
  const out = new Float32Array(options.baseContext)
  out[CANDIDATE_FLOOR] = options.candidateFloor ?? 0
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
