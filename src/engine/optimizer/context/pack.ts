/*
  Author: Runor Ewhro
  Description: Packs compiled optimizer skill context into the fixed float
               layout used by CPU/GPU execution and provides patch helpers
               for per-job gpu dispatch metadata.
*/

import type { ResonatorRuntimeState } from '@/domain/entities/runtime.ts'
import type { SkillDefinition } from '@/domain/entities/stats.ts'
import type { CompiledTargetSkillContext } from '@/engine/optimizer/types.ts'
import { getNegativeEffectBase } from '@/engine/formulas/negativeEffects.ts'
import {
  ECHO_OPTIMIZER_MAX_COST,
  OPTIMIZER_ARCHETYPE_AERO_EROSION,
  OPTIMIZER_ARCHETYPE_DAMAGE,
  OPTIMIZER_ARCHETYPE_ELECTRO_FLARE,
  OPTIMIZER_ARCHETYPE_FUSION_BURST,
  OPTIMIZER_ARCHETYPE_GLACIO_CHAFE,
  OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE,
  OPTIMIZER_ARCHETYPE_TUNE_RUPTURE,
  OPTIMIZER_CONTEXT_FLOATS,
  OPTIMIZER_CTX_ARCHETYPE,
  OPTIMIZER_CTX_AUX0,
  OPTIMIZER_CTX_BASE_ATK,
  OPTIMIZER_CTX_BASE_INDEX,
  OPTIMIZER_CTX_BASE_DEF,
  OPTIMIZER_CTX_BASE_ER,
  OPTIMIZER_CTX_BASE_HP,
  OPTIMIZER_CTX_CRIT_DMG,
  OPTIMIZER_CTX_CRIT_RATE,
  OPTIMIZER_CTX_DISPATCH_WORKGROUP_BASE,
  OPTIMIZER_CTX_DEF_MULT,
  OPTIMIZER_CTX_DMG_AMPLIFY,
  OPTIMIZER_CTX_DMG_BONUS,
  OPTIMIZER_CTX_DMG_VULN,
  OPTIMIZER_CTX_DMG_REDUCTION,
  OPTIMIZER_CTX_FINAL_ATK,
  OPTIMIZER_CTX_FINAL_DEF,
  OPTIMIZER_CTX_FINAL_HP,
  OPTIMIZER_CTX_FLAT_DMG,
  OPTIMIZER_CTX_LOCKED_PACKED,
  OPTIMIZER_CTX_META0,
  OPTIMIZER_CTX_META1,
  OPTIMIZER_CTX_MULTIPLIER,
  OPTIMIZER_CTX_RES_MULT,
  OPTIMIZER_CTX_SCALING_ATK,
  OPTIMIZER_CTX_SCALING_DEF,
  OPTIMIZER_CTX_SCALING_ER,
  OPTIMIZER_CTX_SCALING_HP,
  OPTIMIZER_CTX_SET_RUNTIME_MASK,
  OPTIMIZER_CTX_SKILL_ID,
  OPTIMIZER_CTX_TOGGLES,
  OPTIMIZER_CTX_COMBO_N,
} from '@/engine/optimizer/config/constants.ts'
import { getTuneRuptureLevelScale } from '@/engine/formulas/tuneRupture.ts'
import { encodeSkillId } from '@/engine/optimizer/encode/skillId.ts'

// encode a few resonator-specific runtime toggles into a bitmask
function buildSpecialToggles(runtime: ResonatorRuntimeState, characterId: number): number {
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
function hasSkillType(skill: SkillDefinition, ...types: string[]): boolean {
  return skill.skillType.some((type) => types.includes(type))
}

// brant-kun converts energy regen above 150 into atk, depending on toggle state
function calc1206ErToAtk(characterId: number, finalER: number, toggle0: boolean): number {
  if (characterId !== 1206) {
    return 0
  }

  const erOver = Math.max(0, finalER - 150)
  return toggle0 ? Math.min(erOver * 20, 2600) : Math.min(erOver * 12, 1560)
}

// augusta converts crit rate overflow into crit damage at certain sequences
function calc1306CritConversion(characterId: number, sequence: number, critRateTotal: number): number {
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
function calc1412EchoSkillBonusPoints(characterId: number, finalER: number): number {
  if (characterId !== 1412 || finalER <= 125) {
    return 0
  }

  return Math.min((finalER - 125) * 2, 50)
}

// prof. mornye gets dmg bonus from excess energy regen under the toggle state
function calc1209DmgBonusPoints(characterId: number, finalER: number): number {
  if (characterId !== 1209) {
    return 0
  }

  return Math.min(Math.max(0, finalER - 100) * 0.25, 40)
}

// prof. mornye gets crit rate on liberation-type skills from excess energy regen
function calc1209CritRatePoints(characterId: number, finalER: number): number {
  if (characterId !== 1209) {
    return 0
  }

  return Math.min(Math.max(0, finalER - 100) * 0.5, 80)
}

// even more... prof. mornye gets crit damage on liberation-type skills from excess energy regen
function calc1209CritDmgPoints(characterId: number, finalER: number): number {
  if (characterId !== 1209) {
    return 0
  }

  return Math.min(Math.max(0, finalER - 100), 160)
}

// remove special resonator-side conversions so packed context stores normalized base terms
function normalizePackedContext(options: {
  compiled: CompiledTargetSkillContext
  skill: SkillDefinition
  toggle0: boolean
}): {
  finalAtk: number
  dmgBonus: number
  critRate: number
  critDmg: number
} {
  const { compiled, skill, toggle0 } = options

  let finalAtk = compiled.staticFinalAtk
  let dmgBonus = compiled.staticDmgBonus
  let critRate = compiled.staticCritRate
  let critDmg = compiled.staticCritDmg

  finalAtk -= calc1206ErToAtk(compiled.characterId, compiled.staticFinalER, toggle0)

  critDmg -= calc1306CritConversion(
      compiled.characterId,
      compiled.sequence,
      compiled.staticCritRate / 100,
  ) * 100

  if (hasSkillType(skill, 'echoSkill')) {
    dmgBonus -= calc1412EchoSkillBonusPoints(compiled.characterId, compiled.staticFinalER)
  }

  if (toggle0) {
    dmgBonus -= calc1209DmgBonusPoints(compiled.characterId, compiled.staticFinalER)
  }

  if (hasSkillType(skill, 'resonanceLiberation', 'ultimate')) {
    critRate -= calc1209CritRatePoints(compiled.characterId, compiled.staticFinalER)
    critDmg -= calc1209CritDmgPoints(compiled.characterId, compiled.staticFinalER)
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
      ((ECHO_OPTIMIZER_MAX_COST & 0x3f) << 21)
  ) >>> 0
}

// pack combo count into meta1
function buildMeta1(comboCount: number): number {
  return comboCount >>> 0
}

// tune rupture uses enemy class scaling
function classMultiplier(enemyClass: number): number {
  if (enemyClass === 3 || enemyClass === 4) {
    return 14
  }

  if (enemyClass === 2) {
    return 3
  }

  return 1
}

// build the pre-scaled base multiplier for negative-effect archetypes
function buildNegativeEffectBaseScale(compiled: CompiledTargetSkillContext): number {
  const primaryStacks = compiled.archetype === OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE
      ? compiled.combatSpectroFrazzle
      : compiled.archetype === OPTIMIZER_ARCHETYPE_AERO_EROSION
          ? compiled.combatAeroErosion
          : compiled.archetype === OPTIMIZER_ARCHETYPE_FUSION_BURST
              ? compiled.combatFusionBurst
              : compiled.archetype === OPTIMIZER_ARCHETYPE_GLACIO_CHAFE
                  ? compiled.combatGlacioChafe
              : compiled.combatElectroFlare
  const extraElectroRageStacks = compiled.archetype === OPTIMIZER_ARCHETYPE_ELECTRO_FLARE
      ? compiled.combatElectroRage
      : 0

  if (primaryStacks <= 0 && extraElectroRageStacks <= 0) {
    return 0
  }

  const base =
      getNegativeEffectBase(
      compiled.archetype === OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE
          ? 'spectroFrazzle'
          : compiled.archetype === OPTIMIZER_ARCHETYPE_AERO_EROSION
              ? 'aeroErosion'
              : compiled.archetype === OPTIMIZER_ARCHETYPE_FUSION_BURST
                  ? 'fusionBurst'
                  : compiled.archetype === OPTIMIZER_ARCHETYPE_GLACIO_CHAFE
                      ? 'glacioChafe'
                  : 'electroFlare',
      compiled.level,
      primaryStacks,
  ) + (
        compiled.archetype === OPTIMIZER_ARCHETYPE_ELECTRO_FLARE
          ? getNegativeEffectBase('electroFlare', compiled.level, extraElectroRageStacks)
          : 0
      )

  return base * compiled.hitScale * (1 + compiled.negativeEffectMultiplier)
}

// pack one compiled target context into the fixed float/u32 layout used by execution
export function packTargetContext(options: {
  compiled: CompiledTargetSkillContext
  skill: SkillDefinition
  runtime: ResonatorRuntimeState
  comboN: number
  comboK: number
  comboCount: number
  comboBaseIndex: number
  lockedEchoIndex: number
  setRuntimeMask: number
}): Float32Array {
  const {
    compiled,
    skill,
    runtime,
    comboN,
    comboK,
    comboCount,
    comboBaseIndex,
    lockedEchoIndex,
    setRuntimeMask,
  } = options

  const out = new Float32Array(OPTIMIZER_CONTEXT_FLOATS)
  const u32 = new Uint32Array(out.buffer)

  const totalHitScale = compiled.hitScale > 0 ? compiled.hitScale : compiled.multiplier
  const totalHitCount = Math.max(1, compiled.hitCount || 1)
  const toggles = buildSpecialToggles(runtime, compiled.characterId)

  const normalized = normalizePackedContext({
    compiled,
    skill,
    toggle0: (toggles & 1) !== 0,
  })

  const archetype = compiled.archetype

  let packedMultiplier = totalHitScale
  let packedFlatDmg = (compiled.staticFlatDmg + compiled.flat) * totalHitCount
  let packedDmgBonus = 1 + (normalized.dmgBonus / 100)
  let packedAmplify = 1 + (compiled.staticAmplify / 100)
  let packedCritRate = normalized.critRate / 100
  let packedCritDmg = normalized.critDmg / 100
  let packedAux0 = 1 + (compiled.staticSpecial / 100)

  // archetype-specific packing adjusts how the execution backend interprets multiplier terms
  switch (archetype) {
    case OPTIMIZER_ARCHETYPE_TUNE_RUPTURE:
      packedMultiplier =
          compiled.hitScale *
          getTuneRuptureLevelScale(compiled.level) *
          classMultiplier(compiled.enemyClass)
      packedFlatDmg = 0
      packedDmgBonus = 1 + (compiled.staticDmgBonus / 100)
      packedAmplify = 1 + (compiled.staticAmplify / 100)
      packedCritRate = compiled.tuneRuptureCritRate
      packedCritDmg = compiled.tuneRuptureCritDmg
      packedAux0 = 1 + (compiled.staticTuneBreakBoost / 100)
      break

    case OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE:
    case OPTIMIZER_ARCHETYPE_AERO_EROSION:
    case OPTIMIZER_ARCHETYPE_FUSION_BURST:
    case OPTIMIZER_ARCHETYPE_GLACIO_CHAFE:
    case OPTIMIZER_ARCHETYPE_ELECTRO_FLARE:
      packedMultiplier = buildNegativeEffectBaseScale(compiled)
      packedFlatDmg = 0
      packedDmgBonus = 1 + (compiled.staticDmgBonus / 100)
      packedAmplify = 1 + (compiled.staticAmplify / 100)
      packedCritRate = compiled.negativeEffectCritRate
      packedCritDmg = compiled.negativeEffectCritDmg
      packedAux0 = 1 + (compiled.staticSpecial / 100)
      break

    case OPTIMIZER_ARCHETYPE_DAMAGE:
    default:
      break
  }

  const skillId = encodeSkillId({
    label: skill.label,
    skillType: skill.skillType,
    tab: skill.tab,
    element: skill.element,
  })

  out[OPTIMIZER_CTX_BASE_ATK] = compiled.baseAtk
  out[OPTIMIZER_CTX_BASE_HP] = compiled.baseHp
  out[OPTIMIZER_CTX_BASE_DEF] = compiled.baseDef
  out[OPTIMIZER_CTX_BASE_ER] = compiled.staticFinalER

  out[OPTIMIZER_CTX_FINAL_ATK] = normalized.finalAtk
  out[OPTIMIZER_CTX_FINAL_HP] = compiled.staticFinalHp
  out[OPTIMIZER_CTX_FINAL_DEF] = compiled.staticFinalDef

  out[OPTIMIZER_CTX_SCALING_ATK] = compiled.scalingAtk
  out[OPTIMIZER_CTX_SCALING_HP] = compiled.scalingHp
  out[OPTIMIZER_CTX_SCALING_DEF] = compiled.scalingDef
  out[OPTIMIZER_CTX_SCALING_ER] = compiled.scalingER

  out[OPTIMIZER_CTX_MULTIPLIER] = packedMultiplier
  out[OPTIMIZER_CTX_FLAT_DMG] = packedFlatDmg
  out[OPTIMIZER_CTX_RES_MULT] = compiled.resMult
  out[OPTIMIZER_CTX_DEF_MULT] = compiled.defMult
  out[OPTIMIZER_CTX_DMG_REDUCTION] = compiled.dmgReduction
  out[OPTIMIZER_CTX_DMG_BONUS] = packedDmgBonus
  out[OPTIMIZER_CTX_DMG_AMPLIFY] = packedAmplify
  out[OPTIMIZER_CTX_DMG_VULN] = compiled.staticDmgVuln
  out[OPTIMIZER_CTX_CRIT_RATE] = packedCritRate
  out[OPTIMIZER_CTX_CRIT_DMG] = packedCritDmg
  out[OPTIMIZER_CTX_AUX0] = packedAux0
  out[OPTIMIZER_CTX_ARCHETYPE] = archetype

  u32[OPTIMIZER_CTX_TOGGLES] = toggles
  u32[OPTIMIZER_CTX_SKILL_ID] = skillId
  u32[OPTIMIZER_CTX_META0] = buildMeta0(compiled.characterId, compiled.sequence, 0, comboK)
  u32[OPTIMIZER_CTX_META1] = buildMeta1(comboCount)
  u32[OPTIMIZER_CTX_LOCKED_PACKED] = lockedEchoIndex < 0 ? 0 : ((lockedEchoIndex + 1) >>> 0)
  u32[OPTIMIZER_CTX_BASE_INDEX] = comboBaseIndex >>> 0
  u32[OPTIMIZER_CTX_SET_RUNTIME_MASK] = setRuntimeMask >>> 0
  u32[OPTIMIZER_CTX_COMBO_N] = comboN >>> 0
  u32[OPTIMIZER_CTX_DISPATCH_WORKGROUP_BASE] = 0

  return out
}

// patch a base context into the per-gpu-job variant without rebuilding the full compiled context
export function patchTargetContextForGpuJob(options: {
  baseContext: Float32Array
  comboN: number
  comboK: number
  comboCount: number
  comboBaseIndex: number
  lockedEchoIndex: number
}): Float32Array {
  const out = new Float32Array(options.baseContext)
  const u32 = new Uint32Array(out.buffer)

  const characterId = u32[OPTIMIZER_CTX_META0] & 0xfff
  const sequence = (u32[OPTIMIZER_CTX_META0] >>> 12) & 0xf

  u32[OPTIMIZER_CTX_META0] = buildMeta0(characterId, sequence, 2, options.comboK)
  u32[OPTIMIZER_CTX_META1] = buildMeta1(options.comboCount)
  u32[OPTIMIZER_CTX_LOCKED_PACKED] = options.lockedEchoIndex < 0 ? 0 : ((options.lockedEchoIndex + 1) >>> 0)
  u32[OPTIMIZER_CTX_BASE_INDEX] = options.comboBaseIndex >>> 0
  u32[OPTIMIZER_CTX_COMBO_N] = options.comboN >>> 0
  u32[OPTIMIZER_CTX_DISPATCH_WORKGROUP_BASE] = 0

  return out
}

// update the dispatch workgroup base in-place right before a gpu dispatch
export function patchTargetContextDispatchWorkgroupBase(
    context: Float32Array,
    workgroupBase: number,
): void {
  new Uint32Array(context.buffer)[OPTIMIZER_CTX_DISPATCH_WORKGROUP_BASE] = workgroupBase >>> 0
}
