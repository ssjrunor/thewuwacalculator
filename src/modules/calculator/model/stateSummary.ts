/*
  Author: Runor Ewhro
  Description: builds grouped summaries of active states and effects across
               the active resonator, teammates, weapon, main echo, and echo
               sets for calculator report surfaces.
*/

import type { CombatGraph } from '@/domain/entities/combatGraph'
import { getSrcSttNct } from '@/domain/gameData/controlOptions'
import { makeTeamComp } from '@/domain/gameData/teamComposition'
import { readRtPath } from '@/domain/gameData/runtimePath'
import type {
  EffectDef,
  EffectContext,
  SrcOwnDef,
  SourceState,
} from '@/domain/gameData/contracts'
import { isNoWeaponId, type ResRuntime } from '@/domain/entities/runtime'
import type { SkillDef } from '@/domain/entities/stats'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import { makeCombatGraph, findCombatPart } from '@/domain/state/combatGraph'
import { makeEnemy } from '@/domain/state/defaults'
import { evalCond, evalForm } from '@/engine/effects/evaluator'
import { mkSrcSttScp as mkSrcSttScp } from '@/modules/calculator/model/sourceEval.ts'
import { ffctTrgtRt } from '@/engine/effects/targetScope'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import type { CombatContext } from '@/engine/pipeline/types'
import {
  listFfctForO,
  listSkillsFor,
  listOwnersFor,
  listSttsForO,
} from '@/domain/services/gameDataService'
import { getMainEchoS } from '@/domain/services/runtimeSourceService'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { getSkillType } from '@/modules/calculator/model/skillTypes'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects'
import { toTitle } from '@/shared/lib/format'

export interface StateNode {
  id: string
  ownerLabel: string
  ownerScope: string
  ownScpLbl: string
  stateLabels: string[]
  effectLabels: string[]
}

export interface SttScpGrp {
  id: string
  label: string
  nodes: StateNode[]
}

export interface StateGroup {
  id: string
  sourceId: string
  sourceName: string
  srcProf: string
  scopes: SttScpGrp[]
}

interface SkillStateSummaryTarget {
  resonatorId: string
  skill: Pick<SkillDef, 'id' | 'tab' | 'skillType' | 'element' | 'archetype' | 'aggregationType' | 'scaling' | 'fixedDmg'>
}

type EffectOperation = EffectDef['operations'][number]

// compact number formatting used in human-readable effect labels
function formatValue(value: number, suffix = ''): string {
  const normalized = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
  return `${normalized}${suffix}`
}

// signed number formatting used for buffs/debuffs
function fmtSgndVl(value: number, suffix = ''): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${formatValue(value, suffix)}`
}

// pretty labels for base stat references
function fmtBaseStatL(stat: string): string {
  if (stat === 'atk') return 'ATK'
  if (stat === 'hp') return 'HP'
  if (stat === 'def') return 'DEF'
  return toTitle(stat)
}

// pretty labels for top-level scalar stats
function fmtTopStatLb(stat: string): string {
  const labels: Record<string, string> = {
    flatDmg: 'Flat DMG',
    amplify: 'DMG Amplify',
    critRate: 'Crit Rate',
    critDmg: 'Crit DMG',
    energyRegen: 'Energy Regen',
    healingBonus: 'Healing Bonus',
    shieldBonus: 'Shield Bonus',
    dmgBonus: 'DMG Bonus',
    dmgVuln: 'DMG Vulnerability',
    tuneBreakBoost: 'Tune Break Boost',
    special: 'Special',
  }

  return labels[stat] ?? toTitle(stat)
}

function fmtTopStatSfx(stat: string): string {
  return stat === 'tuneBreakBoost' ? '' : '%'
}

// labels for skill-specific scalar fields
function fmtSkllSclrL(field: string): string {
  const labels: Record<string, string> = {
    fixedDmg: 'Fixed DMG',
    skillHealingBonus: 'Healing Bonus',
    skillShieldBonus: 'Shield Bonus',
    tuneRuptureCritRate: 'Tune Rupture Crit Rate',
    tuneRuptureCritDmg: 'Tune Rupture Crit DMG',
    negativeEffectCritRate: 'Negative Effect Crit Rate',
    negativeEffectCritDmg: 'Negative Effect Crit DMG',
  }

  return labels[field] ?? toTitle(field)
}

// display labels for attribute-targeted effect ops
function fmtTtrbLbl(attribute: string): string {
  if (attribute === 'all') {
    return 'All Attributes'
  }

  return toTitle(attribute)
}

// display labels for modifier types
function fmtModLbl(mod: string): string {
  const labels: Record<string, string> = {
    resShred: 'RES Shred',
    dmgBonus: 'DMG Bonus',
    amplify: 'DMG Amplify',
    defIgnore: 'DEF Ignore',
    defShred: 'DEF Shred',
    dmgVuln: 'DMG Vulnerability',
    critRate: 'Crit Rate',
    critDmg: 'Crit DMG',
  }

  return labels[mod] ?? toTitle(mod)
}

function fmtNegFfctLb(key: string): string {
  return getSkillType(key).label
}

function isNgFfctSkll(target: SkillStateSummaryTarget): boolean {
  return (
      target.skill.archetype === 'spectroFrazzle' ||
      target.skill.archetype === 'aeroErosion' ||
      target.skill.archetype === 'fusionBurst' ||
      target.skill.archetype === 'glacioChafe' ||
      target.skill.archetype === 'electroFlare'
  )
}

function skllTypeMtchs(
    operationSkillType: Extract<EffectOperation, { type: 'add_skilltype_mod' }>['skillType'],
    target: SkillStateSummaryTarget,
    includeAll: boolean,
): boolean {
  const skillTypes = Array.isArray(operationSkillType) ? operationSkillType : [operationSkillType]

  if (includeAll && skillTypes.includes('all')) {
    return true
  }

  return target.skill.skillType.some((type) => skillTypes.includes(type))
}

function matchTargetsSkill(
    match: Extract<
        EffectOperation,
        {
          type:
              | 'add_skill_mod'
              | 'add_skill_multiplier'
              | 'add_skill_hit_multiplier'
              | 'add_skill_scalar'
              | 'scale_skill_multiplier'
        }
    >['match'],
    target: SkillStateSummaryTarget,
): boolean {
  if (!match) {
    return true
  }

  if (match.skillIds?.length && !match.skillIds.includes(target.skill.id)) {
    return false
  }

  if (match.tabs?.length && !match.tabs.includes(target.skill.tab)) {
    return false
  }

  if (
      match.skillTypes?.length &&
      !target.skill.skillType.some((type) => match.skillTypes!.includes(type))
  ) {
    return false
  }

  return true
}

function isSkillDamageFormula(target: SkillStateSummaryTarget): boolean {
  return target.skill.archetype === 'skillDamage'
}

function isSupportFormula(target: SkillStateSummaryTarget): boolean {
  return target.skill.archetype === 'healing' || target.skill.archetype === 'shield'
}

function targetUsesBaseStat(target: SkillStateSummaryTarget, stat: string): boolean {
  return isSkillDamageFormula(target) || isSupportFormula(target)
      ? Boolean(target.skill.scaling?.[stat as keyof typeof target.skill.scaling])
      : false
}

function targetUsesTopStat(target: SkillStateSummaryTarget, stat: string): boolean {
  if (isSkillDamageFormula(target)) {
    if ((target.skill.fixedDmg ?? 0) > 0) {
      return false
    }

    if (stat === 'energyRegen') {
      return Boolean(target.skill.scaling?.energyRegen)
    }

    return (
        stat === 'flatDmg' ||
        stat === 'amplify' ||
        stat === 'critRate' ||
        stat === 'critDmg' ||
        stat === 'dmgBonus' ||
        stat === 'defIgnore' ||
        stat === 'defShred' ||
        stat === 'dmgVuln' ||
        stat === 'special'
    )
  }

  if (target.skill.archetype === 'healing') {
    return stat === 'healingBonus' || (stat === 'energyRegen' && Boolean(target.skill.scaling?.energyRegen))
  }

  if (target.skill.archetype === 'shield') {
    return stat === 'shieldBonus' || (stat === 'energyRegen' && Boolean(target.skill.scaling?.energyRegen))
  }

  if (target.skill.archetype === 'tuneRupture' || target.skill.archetype === 'hack') {
    return (
        stat === 'amplify' ||
        stat === 'defIgnore' ||
        stat === 'defShred' ||
        stat === 'dmgVuln' ||
        stat === 'tuneBreakBoost'
    )
  }

  if (isNgFfctSkll(target)) {
    return stat === 'amplify' || stat === 'defIgnore' || stat === 'defShred' || stat === 'dmgVuln' || stat === 'special'
  }

  return false
}

function targetUsesAttributeMod(target: SkillStateSummaryTarget, mod: string): boolean {
  if (isSkillDamageFormula(target)) {
    return (
        mod === 'resShred' ||
        mod === 'dmgBonus' ||
        mod === 'amplify' ||
        mod === 'defIgnore' ||
        mod === 'defShred' ||
        mod === 'dmgVuln' ||
        mod === 'critRate' ||
        mod === 'critDmg'
    )
  }

  if (target.skill.archetype === 'tuneRupture' || target.skill.archetype === 'hack' || isNgFfctSkll(target)) {
    return mod === 'resShred' || mod === 'defIgnore' || mod === 'defShred' || mod === 'dmgVuln'
  }

  return false
}

function targetUsesSkillTypeMod(
    target: SkillStateSummaryTarget,
    operation: Extract<EffectOperation, { type: 'add_skilltype_mod' }>,
): boolean {
  if (isSkillDamageFormula(target)) {
    return skllTypeMtchs(operation.skillType, target, true)
  }

  if (target.skill.archetype === 'tuneRupture' || target.skill.archetype === 'hack') {
    if (!skllTypeMtchs(operation.skillType, target, true)) {
      return false
    }

    return (
        operation.mod === 'resShred' ||
        operation.mod === 'defIgnore' ||
        operation.mod === 'defShred' ||
        operation.mod === 'dmgVuln' ||
        (operation.mod === 'dmgBonus' && skllTypeMtchs(operation.skillType, target, false))
    )
  }

  if (isNgFfctSkll(target)) {
    if (!skllTypeMtchs(operation.skillType, target, false)) {
      return false
    }

    return (
        operation.mod === 'resShred' ||
        operation.mod === 'defIgnore' ||
        operation.mod === 'defShred' ||
        operation.mod === 'dmgVuln' ||
        operation.mod === 'amplify' ||
        operation.mod === 'dmgBonus'
    )
  }

  return false
}

function targetUsesSkillMod(target: SkillStateSummaryTarget, mod: string): boolean {
  if (isSkillDamageFormula(target)) {
    return true
  }

  if (target.skill.archetype === 'tuneRupture' || target.skill.archetype === 'hack') {
    return mod === 'resShred' || mod === 'defIgnore' || mod === 'defShred' || mod === 'dmgVuln'
  }

  return false
}

function targetUsesSkillScalar(target: SkillStateSummaryTarget, field: string): boolean {
  if (isSkillDamageFormula(target)) {
    return field === 'fixedDmg'
  }

  if (target.skill.archetype === 'healing') {
    return field === 'skillHealingBonus'
  }

  if (target.skill.archetype === 'shield') {
    return field === 'skillShieldBonus'
  }

  if (target.skill.archetype === 'tuneRupture') {
    return field === 'tuneRuptureCritRate' || field === 'tuneRuptureCritDmg'
  }

  if (isNgFfctSkll(target)) {
    return field === 'negativeEffectCritRate' || field === 'negativeEffectCritDmg'
  }

  return false
}

// group desc shown above nodes with the same owner scope
function fmtOwnScpLbl(owner: SrcOwnDef): string {
  if (owner.source.type === 'echo' || owner.source.type === 'echoSet') {
    return 'Echoes'
  }

  const labels: Record<SrcOwnDef['scope'], string> = {
    resonator: 'State',
    weapon: 'Weapon',
    echo: 'Echo',
    team: 'Team',
    sequence: 'Sequence',
    inherent: 'Inherent',
  }

  return labels[owner.scope] ?? toTitle(owner.scope)
}

// internal group id for owner scope buckets
function fmtOwnScpKey(owner: SrcOwnDef): string {
  if (owner.source.type === 'echo' || owner.source.type === 'echoSet') {
    return 'echoes'
  }

  return owner.scope
}

// owner display desc shown for each node
function fmtOwnLbl(owner: SrcOwnDef): string {
  if (owner.source.type === 'echo') {
    return `Main Echo: ${owner.label}`
  }

  return owner.label
}

// specialized desc for echo set piece summaries like "Moonlit Clouds 2pc"
function fmtEchoSetPc(owner: SrcOwnDef, effectId: string): string {
  const setId = Number(owner.source.id)
  const setDef = Number.isFinite(setId) ? getEchoSetDe(setId) : undefined

  if (!setDef) {
    return owner.label
  }

  if (effectId.endsWith(':1pc')) {
    return `${owner.label} 1pc`
  }

  if (effectId.endsWith(':2pc')) {
    return `${owner.label} 2pc`
  }

  if (effectId.endsWith(':3pc')) {
    return `${owner.label} 3pc`
  }

  if (effectId.endsWith(':5pc')) {
    return `${owner.label} 5pc`
  }

  return `${owner.label} ${setDef.setMax === 1 ? '1pc' : setDef.setMax === 3 ? '3pc' : '5pc'}`
}

// wrap a runtime effect context into the evaluator scope shape used by conditions/formulas
function makeEvalScope(context: EffectContext) {
  return {
    sourceRuntime: context.sourceRuntime,
    sourceFinalStats: context.sourceFinalStats,
    targetRuntime: context.targetRuntime,
    activeRuntime: context.activeRuntime,
    context,
    baseStats: context.baseStats,
    finalStats: context.finalStats,
    pool: context.pool,
  }
}

// detect whether a source state is currently active by reading its runtime path
function isSttAct(state: SourceState, context: EffectContext): boolean {
  const rawValue = readRtPath(context.sourceRuntime, state.path)
  const valueWithDefault = rawValue ?? getSrcSttNct(
      context.sourceRuntime,
      context.targetRuntime,
      state,
      context.activeRuntime,
  )

  // toggles are active only when explicitly true
  if (state.kind === 'toggle') {
    return valueWithDefault === true
  }

  // selects are active when they differ from the default/empty state
  if (state.kind === 'select') {
    const value = valueWithDefault == null ? '' : String(valueWithDefault)
    const defaultValue = state.defaultValue == null ? '' : String(state.defaultValue)
    return value !== '' && value !== defaultValue
  }

  // numeric/stack states are active when finite and different from default and zero
  const numericValue =
      typeof valueWithDefault === 'number'
          ? valueWithDefault
          : typeof valueWithDefault === 'string'
              ? Number(valueWithDefault)
              : 0
  const defaultValue =
      typeof state.defaultValue === 'number'
          ? state.defaultValue
          : typeof state.defaultValue === 'string'
              ? Number(state.defaultValue)
              : 0

  return Number.isFinite(numericValue) && numericValue !== defaultValue && numericValue !== 0
}

// resolve skill labels used by skill-scoped operations so summary text can be human-readable
function resMtchSkllL(
    effect: EffectDef,
    operation: EffectDef['operations'][number],
): string[] {
  const skills = effect.source.type === 'resonator'
      ? listSkillsFor('resonator', effect.source.id)
      : []

  if (!('match' in operation) || !operation.match) {
    return []
  }

  if (operation.match.skillIds?.length) {
    return operation.match.skillIds
        .map((skillId) => skills.find((skill) => skill.id === skillId)?.label ?? String(skillId))
        .filter((label): label is string => Boolean(label))
  }

  if (operation.match.skillTypes?.length) {
    return operation.match.skillTypes.map((skillType) => getSkillType(skillType).label)
  }

  if (operation.match.tabs?.length) {
    return operation.match.tabs
        .map((tab) => {
          const skillInTab = skills.find((skill) => skill.tab === tab)

          if (skillInTab?.sectionTitle) {
            return skillInTab.sectionTitle
          }

          return toTitle(tab)
        })
        .filter((label, index, arr) => arr.indexOf(label) === index)
  }

  return []
}

// runtime and skill operations do not store a reverse "affected skills" index, so the rotation When modal derives it
// from the same operation metadata that the evaluator uses when applying effects.
function opTargetsSkill(
    operation: EffectOperation,
    target: SkillStateSummaryTarget,
): boolean {
  // The When modal should mirror the selected skill's damage formula, not every state that happens to be active. Each
  // operation is therefore checked against the formula bucket that can actually consume it.
  if (operation.type === 'add_base_stat') {
    return targetUsesBaseStat(target, operation.stat)
  }

  if (operation.type === 'add_top_stat') {
    return targetUsesTopStat(target, operation.stat)
  }

  if (operation.type === 'add_attribute_mod') {
    const attrs = Array.isArray(operation.attribute) ? operation.attribute : [operation.attribute]
    return targetUsesAttributeMod(target, operation.mod) && (attrs.includes('all') || attrs.includes(target.skill.element))
  }

  if (operation.type === 'add_skilltype_mod') {
    return targetUsesSkillTypeMod(target, operation)
  }

  if (operation.type === 'add_negative_effect_mod') {
    const negativeEffects = Array.isArray(operation.negativeEffect) ? operation.negativeEffect : [operation.negativeEffect]
    return isNgFfctSkll(target) && negativeEffects.some((effectKey) => effectKey === target.skill.archetype)
  }

  if (
      operation.type === 'add_skill_mod' ||
      operation.type === 'add_skill_multiplier' ||
      operation.type === 'add_skill_hit_multiplier' ||
      operation.type === 'add_skill_scalar' ||
      operation.type === 'scale_skill_multiplier'
  ) {
    if (!matchTargetsSkill(operation.match, target)) {
      return false
    }

    if (operation.type === 'add_skill_mod') {
      return targetUsesSkillMod(target, operation.mod)
    }

    if (operation.type === 'add_skill_scalar') {
      return targetUsesSkillScalar(target, operation.field)
    }

    return true
  }

  return false
}

function effectTargetsSkill(effect: EffectDef, target: SkillStateSummaryTarget): boolean {
  return effect.operations.some((operation) => opTargetsSkill(operation, target))
}

// escape html because effect labels are later rendered with span markup
function escapeHtml(value: string): string {
  return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
}

// build the final highlighted desc fragment for one effect line
function withHghl(mainLabel: string, modLabel: string, value: string): string {
  return [
    mainLabel ? `<span class="effect-label-main">${escapeHtml(mainLabel)}</span>` : '',
    (modLabel || value)
        ? `<span class="effect-label-mod">${modLabel ? `${escapeHtml(modLabel)} ` : ''}<span class="effect-label-value highlight">${escapeHtml(value)}</span></span>`
        : '',
  ]
      .filter(Boolean)
      .join(' ')
}

// convert effect operations into compact human-readable summary labels
function fmtOpLbls(
    effect: EffectDef,
    context: EffectContext,
    target?: SkillStateSummaryTarget | null,
): string[] {
  const scope = makeEvalScope(context)
  const operations = target
      ? effect.operations.filter((operation) => opTargetsSkill(operation, target))
      : effect.operations

  return operations.flatMap((operation) => {
    // base stat adders like atk% / hp flat / def flat
    if (operation.type === 'add_base_stat') {
      const suffix = operation.field === 'percent' ? '%' : ''
      const value = fmtSgndVl(evalForm(operation.value, scope), suffix)
      return withHghl(fmtBaseStatL(operation.stat), '', value)
    }

    // top-level scalar adders like crit rate, flat damage, healing bonus, etc.
    if (operation.type === 'add_top_stat') {
      const rawValue = evalForm(operation.value, scope)
      const value = fmtSgndVl(rawValue, fmtTopStatSfx(operation.stat))
      return withHghl(fmtTopStatLb(operation.stat), '', value)
    }

    // attribute mod ops may affect one or several attributes
    if (operation.type === 'add_attribute_mod') {
      const attributes = Array.isArray(operation.attribute) ? operation.attribute : [operation.attribute]
      const value = fmtSgndVl(evalForm(operation.value, scope), '%')

      return attributes.map((attr) =>
          withHghl(
              fmtTtrbLbl(attr),
              fmtModLbl(operation.mod),
              value,
          ),
      )
    }

    // skill-type mod ops may affect one or several skill types
    if (operation.type === 'add_skilltype_mod') {
      const skillTypes = Array.isArray(operation.skillType) ? operation.skillType : [operation.skillType]
      const value = fmtSgndVl(evalForm(operation.value, scope), '%')

      return skillTypes.map((st) =>
          withHghl(
              getSkillType(st).label,
              fmtModLbl(operation.mod),
              value,
          ),
      )
    }

    if (operation.type === 'add_negative_effect_mod') {
      const negFfct = Array.isArray(operation.negativeEffect)
          ? operation.negativeEffect
          : [operation.negativeEffect]
      const rawValue = evalForm(operation.value, scope)
      const value = operation.mod === 'multiplier'
          ? fmtSgndVl(rawValue * 100, '%')
          : fmtSgndVl(rawValue, '%')
      const modLabel = operation.mod === 'multiplier'
          ? 'Multiplier'
          : fmtModLbl(operation.mod)

      return negFfct.map((negEffect) =>
          withHghl(
              fmtNegFfctLb(negEffect),
              modLabel,
              value,
          ),
      )
    }

    // skill-specific mod ops are matched against skill ids/types/tabs
    if (operation.type === 'add_skill_mod') {
      const labels = resMtchSkllL(effect, operation)
      const value = fmtSgndVl(evalForm(operation.value, scope), '%')
      const modLabel = fmtModLbl(operation.mod)

      if (labels.length === 0) {
        return withHghl('Skill', modLabel, value)
      }

      return labels.map((label) => {
        const shldTrimDmgS =
            operation.mod === 'dmgBonus' ||
            operation.mod === 'amplify' ||
            operation.mod === 'dmgVuln'

        const cleanedLabel =
            shldTrimDmgS && /\sDMG$/i.test(label)
                ? label.replace(/\sDMG$/i, '')
                : label

        return withHghl(cleanedLabel, modLabel, value)
      })
    }

    // direct multiplier addition for matched skills
    if (operation.type === 'add_skill_multiplier') {
      const labels = resMtchSkllL(effect, operation)
      const added = fmtSgndVl(evalForm(operation.value, scope), '')

      if (labels.length === 0) {
        return withHghl('', 'Skill Multiplier', added)
      }

      return labels.map((label) => {
        const cleanedLabel = /\sDMG$/i.test(label)
            ? label.replace(/\sDMG$/i, '')
            : label

        return withHghl(cleanedLabel, 'DMG Multiplier', added)
      })
    }

    // direct multiplier addition for one hit row on matched skills
    if (operation.type === 'add_skill_hit_multiplier') {
      const labels = resMtchSkllL(effect, operation)
      const added = fmtSgndVl(evalForm(operation.value, scope), '')
      const hitLabel = `Hit ${operation.hitIndex + 1} DMG Multiplier`

      if (labels.length === 0) {
        return withHghl('', hitLabel, added)
      }

      return labels.map((label) => {
        const cleanedLabel = /\sDMG$/i.test(label)
            ? label.replace(/\sDMG$/i, '')
            : label

        return withHghl(cleanedLabel, hitLabel, added)
      })
    }

    // multiplicative scaling for matched skills
    if (operation.type === 'scale_skill_multiplier') {
      const labels = resMtchSkllL(effect, operation)
      const scale = `×${formatValue(evalForm(operation.value, scope))}`

      if (labels.length === 0) {
        return withHghl('', 'Skill Multiplier', scale)
      }

      return labels.map((label) => {
        const cleanedLabel = /\sDMG$/i.test(label)
            ? label.replace(/\sDMG$/i, '')
            : label

        return withHghl(cleanedLabel, 'DMG Multiplier', scale)
      })
    }

    // scalar fields on matched skills like fixed damage, extra crit rate, etc.
    if (operation.type === 'add_skill_scalar') {
      const labels = resMtchSkllL(effect, operation)
      const suffix = /CritRate|CritDmg|Bonus$/.test(operation.field) ? '%' : ''
      const value = fmtSgndVl(evalForm(operation.value, scope), suffix)
      const scalarLabel = fmtSkllSclrL(operation.field)

      if (labels.length === 0) {
        return withHghl('Skill', scalarLabel, value)
      }

      return labels.map((label) => {
        const cleanedLabel = /\sDMG$/i.test(label)
            ? label.replace(/\sDMG$/i, '')
            : label

        return withHghl(cleanedLabel, scalarLabel, value)
      })
    }

    return []
  })
}

// determine whether an owner block is visible in the current runtime/effect context
function ownIsVsbl(owner: SrcOwnDef, context: EffectContext): boolean {
  const scope = makeEvalScope(context)

  if (!evalCond(owner.unlockWhen, scope)) {
    return false
  }

  return evalCond(owner.visibleWhen, scope)
}

// determine whether a source state should appear in the current summary context
function sttIsVsbl(state: SourceState, context: EffectContext): boolean {
  if (!(state.requires ?? state.controlDependencies ?? []).every((controlKey) => Boolean(context.sourceRuntime.state.controls[controlKey]))) {
    return false
  }

  const stateScope = mkSrcSttScp(
      context.sourceRuntime,
      context.targetRuntime,
      state,
      context.activeRuntime,
  )

  if (!evalCond(state.visibleWhen, stateScope)) {
    return false
  }

  return evalCond(state.enabledWhen, stateScope)
}

// build an effect runtime context for a specific source runtime relative to the
// target runtime being inspected and the current active runtime.
function buildContext(
    srcRt: ResRuntime,
    targetRt: ResRuntime,
    activeRt: ResRuntime,
    runtimesById: Record<string, ResRuntime>,
    selTrgtByOwn: Record<string, string | null>,
    graph: CombatGraph | null,
    prepCntxByRe: Record<string, CombatContext> = {},
    enemyProfile = makeEnemy(),
): EffectContext {
  const prepCtx = prepCntxByRe[srcRt.id] ?? null
  const teamMemIds = Array.from(
      new Set([activeRt.id, ...activeRt.build.team.filter((memberId): memberId is string => Boolean(memberId))]),
  )
  const sourceSeed = prepCtx ? null : getResSeedBy(srcRt.id)

  // try to reuse an existing graph participant if available
  const srcPart =
      graph ? Object.values(graph.participants).find((participant) => participant.resonatorId === srcRt.id) : null

  // otherwise build a transient graph so we can still resolve combat context for teammates
  const trnsGrph = !srcPart && sourceSeed
      ? makeCombatGraph({
        actRt: activeRt,
        partRts: runtimesById,
        targetsByRes: {
          [activeRt.id]: selTrgtByOwn,
        },
      })
      : null
  const trnsTgtSlotI =
      trnsGrph ? findCombatPart(trnsGrph, srcRt.id) : null

  // resolve combat context from either the live graph or the transient fallback
  const cmbtCtx = prepCtx
      ?? (srcPart
          ? makeCombatEnv({
            graph: graph!,
            targetSlotId: srcPart.slotId,
            enemy: enemyProfile,
          })
          : trnsGrph && trnsTgtSlotI
              ? makeCombatEnv({
                graph: trnsGrph,
                targetSlotId: trnsTgtSlotI,
                enemy: enemyProfile,
              })
              : null)

  return {
    source: {
      type: 'resonator',
      id: srcRt.id,
    },
    sourceRuntime: srcRt,
    sourceFinalStats: cmbtCtx?.finalStats,
    targetRuntime: targetRt,
    activeRuntime: activeRt,
    targetRuntimeId: targetRt.id,
    activeResonatorId: activeRt.id,
    teamMemberIds: teamMemIds,
    team: makeTeamComp(teamMemIds),
    echoSetCounts: countEchoSets(srcRt.build.echoes),
    selectedTargetsByOwnerKey: selTrgtByOwn,
    baseStats: cmbtCtx?.baseStats,
    finalStats: cmbtCtx?.finalStats,
    pool: cmbtCtx?.buffs,
    enemy: cmbtCtx?.enemy ?? enemyProfile,
  }
}

// dedupe repeated labels while preserving order
function nqStrn(values: string[]): string[] {
  return Array.from(new Set(values))
}

// bucket nodes by scope so the overview ui can render grouped sections
function grpNdsByScp(nodes: StateNode[]): SttScpGrp[] {
  const groups = new Map<string, SttScpGrp>()

  for (const node of nodes) {
    const existing = groups.get(node.ownerScope)
    if (existing) {
      existing.nodes.push(node)
      continue
    }

    groups.set(node.ownerScope, {
      id: node.ownerScope,
      label: node.ownScpLbl,
      nodes: [node],
    })
  }

  return Array.from(groups.values()).sort((left, right) => left.label.localeCompare(right.label))
}

// build the full overview summary for the active resonator plus all relevant supporting sources
export function makeStateSummary(
    actRt: ResRuntime | null,
    runtimesById: Record<string, ResRuntime>,
    graph: CombatGraph | null = null,
    selTrgtVrrd: Record<string, string | null> | null = null,
    options: {
      cntxByResId?: Record<string, CombatContext>
      enemyProfile?: ReturnType<typeof makeEnemy>
      activeRuntime?: ResRuntime | null
      showAllStates?: boolean
      skillTarget?: SkillStateSummaryTarget | null
    } = {},
): StateGroup[] {
  if (!actRt) {
    return []
  }

  const targetRt = actRt
  const activeRt = options.activeRuntime ?? targetRt

  // use explicit target overrides when given, otherwise try to pull them from the active graph participant
  const actPart = graph?.participants[graph.activeSlotId]
  const selTrgtByOwn = selTrgtVrrd
      ? { ...selTrgtVrrd }
      : actPart
          ? { ...actPart.slot.routing.selectedTargetsByOwnerKey }
          : {}

  // include the active resonator and all non-empty teammates as sources
  const sourceIds = Array.from(
      new Set([activeRt.id, ...activeRt.build.team.filter((memberId): memberId is string => Boolean(memberId))]),
  )

  const groups = sourceIds.flatMap((sourceId) => {
    const srcRt =
        runtimesById[sourceId]
        ?? (sourceId === targetRt.id ? targetRt : sourceId === activeRt.id ? activeRt : null)
    const srcRes = getResSeedBy(sourceId)

    if (!srcRt || !srcRes) {
      return []
    }

    const context = buildContext(
        srcRt,
        targetRt,
        activeRt,
        runtimesById,
        selTrgtByOwn,
        graph,
        options.cntxByResId,
        options.enemyProfile,
    )
    const weaponId = srcRt.build.weapon.id
    const mainEchoSrc = getMainEchoS(srcRt)
    const setIds = Array.from(
        new Set(
            srcRt.build.echoes
                .filter((echo): echo is NonNullable<typeof echo> => Boolean(echo))
                .map((echo) => String(echo.set)),
        ),
    )

    // build source-specific contexts for weapon, main echo, and each set owner
    const wpnCtx = !isNoWeaponId(weaponId)
        ? { ...context, source: { type: 'weapon' as const, id: weaponId } }
        : null
    const echoContext = mainEchoSrc
        ? { ...context, source: mainEchoSrc }
        : null
    const echoSetCntx = new Map(
        setIds.map((setId) => [
          setId,
          { ...context, source: { type: 'echoSet' as const, id: setId } },
        ]),
    )

    // collect all owners that can contribute visible states/effects
    const owners = [
      ...listOwnersFor('resonator', sourceId),
      ...(!isNoWeaponId(weaponId) ? listOwnersFor('weapon', weaponId) : []),
      ...(mainEchoSrc ? listOwnersFor(mainEchoSrc.type, mainEchoSrc.id) : []),
      ...setIds.flatMap((setId) => listOwnersFor('echoSet', setId)),
    ]

    const nodes = owners.flatMap((owner) => {
      const ownerContext =
          owner.source.type === 'weapon' && wpnCtx
              ? wpnCtx
              : owner.source.type === 'echo' && echoContext
                  ? echoContext
                  : owner.source.type === 'echoSet'
                      ? echoSetCntx.get(owner.source.id) ?? context
                      : context

      if (!ownIsVsbl(owner, ownerContext)) {
        return []
      }

      // collect visible + currently active states under this owner
      const states = listSttsForO(owner.ownerKey)
          .filter((state) => sttIsVsbl(state, ownerContext))
          .filter((state) => isSttAct(state, ownerContext))

      // collect effects that both target this runtime and pass their condition
      const effects = listFfctForO(owner.ownerKey)
          .filter((effect) => ffctTrgtRt(effect, ownerContext))
          .filter((effect) => !options.skillTarget || effectTargetsSkill(effect, options.skillTarget))
          .filter((effect) => evalCond(effect.condition, makeEvalScope(ownerContext)))

      const effectLabels = nqStrn(effects.flatMap((effect) => fmtOpLbls(effect, ownerContext, options.skillTarget)))
      if (states.length === 0 && effectLabels.length === 0) {
        return []
      }

      if (!options.showAllStates && states.length > 0 && effectLabels.length === 0) {
        return []
      }

      // echo set effects can be broken out by piece desc (2pc / 5pc / 3pc)
      if (owner.source.type === 'echoSet' && effects.length > 0) {
        const ffctLblsByPc = new Map<string, string[]>()

        for (const effect of effects) {
          const labels = nqStrn(fmtOpLbls(effect, ownerContext, options.skillTarget))
          if (labels.length === 0) {
            continue
          }

          const pieceLabel = fmtEchoSetPc(owner, effect.id)
          const existing = ffctLblsByPc.get(pieceLabel) ?? []
          ffctLblsByPc.set(pieceLabel, nqStrn([...existing, ...labels]))
        }

        const effectNodes = Array.from(ffctLblsByPc.entries()).map(([pieceLabel, labels]) => ({
          id: `${owner.ownerKey}:${pieceLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          ownerLabel: pieceLabel,
          ownerScope: fmtOwnScpKey(owner),
          ownScpLbl: fmtOwnScpLbl(owner),
          stateLabels: [],
          effectLabels: labels,
        } satisfies StateNode))

        if (effectNodes.length > 0) {
          return effectNodes
        }
      }

      // standard owner node combines active state labels plus effect labels
      return [
        {
          id: owner.ownerKey,
          ownerLabel: fmtOwnLbl(owner),
          ownerScope: fmtOwnScpKey(owner),
          ownScpLbl: fmtOwnScpLbl(owner),
          stateLabels: nqStrn(
              states
                  .map((state) => state.label)
                  .filter((label) => label !== owner.label),
          ),
          effectLabels,
        } satisfies StateNode,
      ]
    })

    if (nodes.length === 0) {
      return []
    }

    // one top-level group per source resonator
    return [
      {
        id: srcRt.id,
        sourceId: srcRt.id,
        sourceName: srcRes.name,
        srcProf: srcRes.profile ?? '',
        scopes: grpNdsByScp(nodes.sort((left, right) => left.ownerLabel.localeCompare(right.ownerLabel))),
      } satisfies StateGroup,
    ]
  })

  // keep the active resonator first, then sort teammates alphabetically
  return groups.sort((left, right) => {
    if (left.sourceId === actRt.id && right.sourceId !== actRt.id) {
      return -1
    }

    if (left.sourceId !== actRt.id && right.sourceId === actRt.id) {
      return 1
    }

    return left.sourceName.localeCompare(right.sourceName)
  })
}
