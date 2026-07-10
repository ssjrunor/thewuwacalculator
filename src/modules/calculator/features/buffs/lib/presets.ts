/*
  Author: Runor Ewhro
  Description: Builds manual buff preset catalog entries from game-data effects
               and converts selected presets into static manual modifiers.
*/

import { getGameData } from '@/data/gameData'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'
import type { MnlMod, MnlSkllMtchM } from '@/domain/entities/manualBuffs.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type {
  AttributeKey,
  FinalStats,
  NegEffectKey,
  UnifiedBuffPool,
  ResBaseStats,
  SkillTypeKey,
} from '@/domain/entities/stats.ts'
import type {
  DataSrcRef,
  EffectDef,
  EffectScope,
  EffectContext,
  FormExpr,
  SkllMtchRule,
  SourceState,
} from '@/domain/gameData/contracts.ts'
import { makeTeamComp } from '@/domain/gameData/teamComposition.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { getResSeedBy, resResBaseSt } from '@/domain/services/resonatorSeedService.ts'
import { getWpnById } from '@/domain/services/weaponCatalogService.ts'
import { wpnAtkAt } from '@/domain/state/weaponState.ts'
import { evalForm } from '@/engine/effects/evaluator.ts'
import { calcFinalStats } from '@/engine/formulas/finalStats.ts'
import { countEchoSets, mkRtBaseBuff } from '@/engine/pipeline/buildCombatContext.ts'
import { mkNfdBuffPoo } from '@/engine/resolvers/buffPool.ts'
import {
  DVNCBASESTAT,
  DVNCBASESTuv,
  ADV_SKILL_TYPES,
  DVNCTOPSTATP,
  MOD_VL_PTNS,
  NEG_EFFECT_MODS,
  NEG_EFFECT_OPTS,
  SKLLMODPTNS,
  SKLLSCLRPTNS,
} from '@/modules/calculator/features/buffs/lib/options.ts'
import { resPssvPrms } from '@/modules/calculator/features/weapons/lib/weapon.ts'
import { truncTo } from '@/shared/lib/number.ts'
import { makeModId } from './helpers.ts'

export type BuffPresetSourceKind = 'echo' | 'echoSet' | 'weapon'
export type BuffPresetType = 'self' | 'active' | 'team'

export interface BuffPresetControl {
  key: string
  label: string
  kind: SourceState['kind']
  min?: number
  max?: number
  options?: SourceState['options']
  defaultValue: boolean | number | string
}

export interface BuffPresetEntry {
  id: string
  source: DataSrcRef & { type: BuffPresetSourceKind }
  sourceName: string
  sourceIcon: string | null
  label: string
  description?: string
  descriptionParams?: string[]
  effectName: string
  buffType: BuffPresetType
  targetScope: NonNullable<EffectDef['targetScope']>
  effect: EffectDef
  controls: BuffPresetControl[]
}

export type BuffPresetValues = Record<string, boolean | number | string>

const PRESET_SOURCE_TYPES = new Set(['echo', 'echoSet', 'weapon'])
const ALL_ATTRIBUTE_KEYS: AttributeKey[] = [
  'aero',
  'glacio',
  'spectro',
  'fusion',
  'electro',
  'havoc',
  'physical',
]
const ALL_SKILL_TYPE_KEYS: SkillTypeKey[] = [
  'basicAtk',
  'heavyAtk',
  'resonanceSkill',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'echoSkill',
  'coord',
  'spectroFrazzle',
  'aeroErosion',
  'fusionBurst',
  'havocBane',
  'glacioChafe',
  'electroFlare',
  'healing',
  'shield',
  'tuneRupture',
  'hack',
]

function isPresetSource(source: DataSrcRef): source is DataSrcRef & { type: BuffPresetSourceKind } {
  return PRESET_SOURCE_TYPES.has(source.type)
}

function sourceName(source: DataSrcRef): string {
  if (source.type === 'weapon') {
    return getWpnById(source.id)?.name ?? `Weapon ${source.id}`
  }

  if (source.type === 'echoSet') {
    const setId = Number(source.id)
    return Number.isFinite(setId) ? getSntSetNam(setId) : `Set ${source.id}`
  }

  if (source.type === 'echo') {
    return getEchoById(source.id)?.name ?? `Echo ${source.id}`
  }

  return source.id
}

function sourceIcon(source: DataSrcRef): string | null {
  if (source.type === 'weapon') {
    return getWpnById(source.id)?.icon ?? `/assets/weapon-icons/${source.id}.webp`
  }

  if (source.type === 'echoSet') {
    const setId = Number(source.id)
    return Number.isFinite(setId) ? getSntSetIco(setId) : null
  }

  if (source.type === 'echo') {
    return getEchoById(source.id)?.icon ?? `/assets/echoes/${source.id}.webp`
  }

  return null
}

function sourceDescription(source: DataSrcRef): { description?: string; params?: string[] } {
  if (source.type === 'weapon') {
    const weapon = getWpnById(source.id)
    return {
      description: weapon?.passive.desc,
      params: weapon ? resPssvPrms(weapon.passive.params, 1) : undefined,
    }
  }

  if (source.type === 'echo') {
    return { description: getEchoById(source.id)?.skillDesc }
  }

  return {}
}

function cleanPresetEffectLabel(label: string, sourceLabel: string): string {
  const cleaned = label.replace(/\s+toggle$/i, '').trim()

  if (!cleaned) {
    return sourceLabel
  }

  return cleaned
}

export function buffTypeForScope(scope: EffectDef['targetScope'] = 'self'): BuffPresetType {
  if (scope === 'active') {
    return 'active'
  }

  if (scope === 'self') {
    return 'self'
  }

  return 'team'
}

export function buffTypeLabel(type: BuffPresetType): string {
  if (type === 'active') return 'Active'
  if (type === 'team') return 'Team'
  return 'Self'
}

function controlDefault(state: SourceState): boolean | number | string {
  if (state.kind === 'toggle') {
    return true
  }

  if (state.kind === 'stack' || state.kind === 'number') {
    return state.max ?? state.defaultValue ?? 0
  }

  return state.defaultValue ?? state.options?.[0]?.id ?? ''
}

function presetEntryId(effect: EffectDef, duplicateEffectIds: Set<string>): string {
  // some sources register separate effects under the same id; include scope
  // only for those duplicates so existing stable ids remain unchanged.
  if (!duplicateEffectIds.has(effect.id)) {
    return effect.id
  }

  return `${effect.id}:${effect.targetScope ?? 'self'}`
}

export function buildBuffPresetCatalog(): BuffPresetEntry[] {
  const registry = getGameData()

  return Object.values(registry.sourcesByKey)
      .filter((sourcePkg) => isPresetSource(sourcePkg.source))
      .flatMap((sourcePkg) => {
        const source = sourcePkg.source as DataSrcRef & { type: BuffPresetSourceKind }
        // duplicate detection is scoped to one source package, matching how
        // manual preset ids are consumed by the picker.
        const effectIdCounts = new Map<string, number>()
        for (const effect of sourcePkg.effects ?? []) {
          effectIdCounts.set(effect.id, (effectIdCounts.get(effect.id) ?? 0) + 1)
        }
        const duplicateEffectIds = new Set(
          [...effectIdCounts.entries()]
              .filter(([, count]) => count > 1)
              .map(([id]) => id),
        )
        const controls = (sourcePkg.states ?? []).map((state): BuffPresetControl => ({
          key: state.controlKey,
          label: state.label,
          kind: state.kind,
          min: state.min,
          max: state.max,
          options: state.options,
          defaultValue: controlDefault(state),
        }))

        return (sourcePkg.effects ?? []).map((effect): BuffPresetEntry => {
          const description = sourceDescription(source)
          const name = sourceName(source)
          const effectLabel = cleanPresetEffectLabel(effect.label, name)

          return {
            id: presetEntryId(effect, duplicateEffectIds),
            source,
            sourceName: name,
            sourceIcon: sourceIcon(source),
            label: effectLabel,
            description: effect.description ?? description.description,
            descriptionParams: description.params,
            effectName: effectLabel,
            buffType: buffTypeForScope(effect.targetScope ?? 'self'),
            targetScope: effect.targetScope ?? 'self',
            effect,
            controls,
          }
        })
      })
      .sort((left, right) =>
        left.source.type.localeCompare(right.source.type)
        || left.sourceName.localeCompare(right.sourceName)
        || left.label.localeCompare(right.label),
      )
}

function baseStatsFor(runtime: ResRuntime): ResBaseStats | undefined {
  const seed = getResSeedBy(runtime.id)
  return seed ? resResBaseSt(seed, runtime.base.level) : undefined
}

function makeScope(
    runtime: ResRuntime,
    source: DataSrcRef,
    values: BuffPresetValues,
    rank: number,
): EffectScope {
  // presets evaluate against a synthetic source runtime that applies selected
  // controls and weapon rank without mutating the live calculator runtime.
  const controls = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value]),
  )
  const sourceRuntime: ResRuntime = {
    ...runtime,
    build: {
      ...runtime.build,
      weapon: source.type === 'weapon'
        ? { ...runtime.build.weapon, id: source.id, rank }
        : runtime.build.weapon,
    },
    state: {
      ...runtime.state,
      controls: {
        ...runtime.state.controls,
        ...controls,
      },
    },
  }
  const teamMemberIds = Array.from(new Set([
    runtime.id,
    ...runtime.build.team.filter((memberId): memberId is string => Boolean(memberId)),
  ]))
  const baseStats = baseStatsFor(runtime)
  const pool: UnifiedBuffPool = baseStats ? mkRtBaseBuff(runtime) : mkNfdBuffPoo()
  const finalStats: FinalStats | undefined = baseStats
    ? calcFinalStats(
        baseStats,
        pool,
        wpnAtkAt(runtime.build.weapon.id, runtime.build.weapon.level),
    )
    : undefined
  const echoSetCounts = {
    ...countEchoSets(runtime.build.echoes),
    ...(source.type === 'echoSet' ? { [source.id]: getEchoSetDe(Number(source.id))?.setMax ?? 5 } : {}),
  }
  const context: EffectContext = {
    source,
    target: { type: 'resonator', id: runtime.id },
    sourceRuntime,
    targetRuntime: runtime,
    activeRuntime: runtime,
    targetRuntimeId: runtime.id,
    activeResonatorId: runtime.id,
    teamMemberIds,
    team: makeTeamComp(teamMemberIds),
    echoSetCounts,
    pool,
    baseStats,
    finalStats,
    sourceFinalStats: finalStats,
  }

  return {
    sourceRuntime,
    sourceFinalStats: finalStats,
    targetRuntime: runtime,
    activeRuntime: runtime,
    context,
    pool,
    baseStats,
    finalStats,
  }
}

function evalPresetValue(formula: FormExpr, scope: EffectScope): number {
  const value = evalForm(formula, scope)
  return Number.isFinite(value) ? value : 0
}

function skillTargetBase(match: SkllMtchRule | undefined): Array<{
  matchMode: MnlSkllMtchM
  skillId?: string
  tab?: string
  skillType?: SkillTypeKey
}> {
  // empty or unsupported match rules fall back to all skill types so a preset
  // never creates a manual modifier with no target.
  if (!match) {
    return [{ matchMode: 'skillType', skillType: 'all' }]
  }

  const rows: Array<{
    matchMode: MnlSkllMtchM
    skillId?: string
    tab?: string
    skillType?: SkillTypeKey
  }> = []
  const typed = match as {
    skillIds?: string[]
    tabs?: string[]
    skillTypes?: SkillTypeKey[]
  }

  rows.push(...(typed.skillIds ?? []).map((skillId) => ({ matchMode: 'skillId' as const, skillId })))
  rows.push(...(typed.tabs ?? []).map((tab) => ({ matchMode: 'tab' as const, tab })))
  rows.push(...(typed.skillTypes ?? []).map((skillType) => ({ matchMode: 'skillType' as const, skillType })))

  return rows.length > 0 ? rows : [{ matchMode: 'skillType', skillType: 'all' }]
}

function withLabel<T extends MnlMod>(modifier: T, label: string): T {
  return { ...modifier, label }
}

function getOptionLabel(
    options: Array<{ value: string; label: string }>,
    value: string | undefined,
    fallback = 'Unknown',
): string {
  return options.find((option) => option.value === value)?.label ?? fallback
}

function formatValue(value: number, suffix = '%'): string {
  const truncated = truncTo(value, 2)
  const display = Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(2).replace(/\.?0+$/, '')
  return `+${display}${suffix}`
}

function scalarSuffix(field: string): string {
  return field === 'fixedDmg' ? '' : '%'
}

function hasEvery<T extends string>(values: Set<string>, required: T[]): boolean {
  return required.every((value) => values.has(value))
}

function normalizeAttributeTargets(
    target: (AttributeKey | 'all') | (AttributeKey | 'all')[],
): Array<AttributeKey | 'all'> {
  const targets = Array.isArray(target) ? target : [target]
  const uniqueTargets = new Set(targets)

  if (uniqueTargets.has('all') || hasEvery(uniqueTargets, ALL_ATTRIBUTE_KEYS)) {
    return ['all']
  }

  return Array.from(uniqueTargets)
}

function normalizeSkillTypeTargets(target: SkillTypeKey | SkillTypeKey[]): SkillTypeKey[] {
  const targets = Array.isArray(target) ? target : [target]
  const uniqueTargets = new Set(targets)

  if (uniqueTargets.has('all') || hasEvery(uniqueTargets, ALL_SKILL_TYPE_KEYS)) {
    return ['all']
  }

  return Array.from(uniqueTargets)
}

export function formatManualModifierPreview(modifier: MnlMod): string {
  if (modifier.scope === 'baseStat') {
    return `${getOptionLabel(DVNCBASESTAT, modifier.stat)} ${getOptionLabel(DVNCBASESTuv, modifier.field)} ${formatValue(modifier.value, modifier.field === 'flat' ? '' : '%')}`
  }

  if (modifier.scope === 'topStat') {
    const suffix = modifier.stat === 'flatDmg' || modifier.stat === 'special' || modifier.stat === 'tuneBreakBoost'
      ? ''
      : '%'
    return `${getOptionLabel(DVNCTOPSTATP, modifier.stat)} ${formatValue(modifier.value, suffix)}`
  }

  if (modifier.scope === 'attribute') {
    return `${modifier.attribute === 'all' ? 'All Elements' : getOptionLabel([
      { value: 'aero', label: 'Aero' },
      { value: 'glacio', label: 'Glacio' },
      { value: 'spectro', label: 'Spectro' },
      { value: 'fusion', label: 'Fusion' },
      { value: 'electro', label: 'Electro' },
      { value: 'havoc', label: 'Havoc' },
      { value: 'physical', label: 'Physical' },
    ], modifier.attribute)} ${getOptionLabel(MOD_VL_PTNS, modifier.mod)} ${formatValue(modifier.value)}`
  }

  if (modifier.scope === 'skillType') {
    return `${getOptionLabel(ADV_SKILL_TYPES, modifier.skillType)} ${getOptionLabel(MOD_VL_PTNS, modifier.mod)} ${formatValue(modifier.value)}`
  }

  if (modifier.scope === 'negativeEffect') {
    return `${getOptionLabel(NEG_EFFECT_OPTS, modifier.negativeEffect)} ${getOptionLabel(NEG_EFFECT_MODS, modifier.mod)} ${formatValue(modifier.value, modifier.mod === 'multiplier' ? '' : '%')}`
  }

  const target = modifier.matchMode === 'skillId'
    ? 'Skill'
    : modifier.matchMode === 'tab'
      ? 'Tab'
      : getOptionLabel(ADV_SKILL_TYPES, modifier.skillType ?? 'all')

  if (modifier.effect === 'mod') {
    return `${target} ${getOptionLabel(MOD_VL_PTNS, modifier.mod)} ${formatValue(modifier.value)}`
  }

  if (modifier.effect === 'addHitMultiplier') {
    return `${target} Hit ${modifier.hitIndex + 1} MV ${formatValue(modifier.value)}`
  }

  if (modifier.effect === 'scalar') {
    return `${target} ${getOptionLabel(SKLLSCLRPTNS, modifier.field)} ${formatValue(modifier.value, scalarSuffix(modifier.field))}`
  }

  return `${target} ${getOptionLabel(SKLLMODPTNS, modifier.effect)} ${formatValue(modifier.value)}`
}

export function presetToManualModifiers(
    entry: BuffPresetEntry,
    runtime: ResRuntime,
    values: BuffPresetValues,
    rank: number,
): MnlMod[] {
  const scope = makeScope(runtime, entry.source, values, rank)

  // translate data-effect operations into the static manual modifier rows the
  // buff editor already knows how to persist and apply.
  return entry.effect.operations.flatMap((operation): MnlMod[] => {
    const value = 'value' in operation ? evalPresetValue(operation.value, scope) : 0

    if (operation.type === 'add_base_stat') {
      return [withLabel({
        id: makeModId(),
        enabled: true,
        label: entry.label,
        scope: 'baseStat',
        stat: operation.stat,
        field: operation.field,
        value,
      }, entry.label)]
    }

    if (operation.type === 'add_top_stat') {
      return [withLabel({
        id: makeModId(),
        enabled: true,
        label: entry.label,
        scope: 'topStat',
        stat: operation.stat,
        value,
      }, entry.label)]
    }

    if (operation.type === 'add_attribute_mod') {
      return normalizeAttributeTargets(operation.attribute).map((attribute) => withLabel({
        id: makeModId(),
        enabled: true,
        label: entry.label,
        scope: 'attribute',
        attribute,
        mod: operation.mod,
        value,
      }, entry.label))
    }

    if (operation.type === 'add_skilltype_mod') {
      return normalizeSkillTypeTargets(operation.skillType).map((skillType) => withLabel({
        id: makeModId(),
        enabled: true,
        label: entry.label,
        scope: 'skillType',
        skillType,
        mod: operation.mod,
        value,
      }, entry.label))
    }

    if (operation.type === 'add_negative_effect_mod') {
      const negativeEffects = Array.isArray(operation.negativeEffect) ? operation.negativeEffect : [operation.negativeEffect]
      return negativeEffects.map((negativeEffect) => withLabel({
        id: makeModId(),
        enabled: true,
        label: entry.label,
        scope: 'negativeEffect',
        negativeEffect: negativeEffect as NegEffectKey,
        mod: operation.mod,
        value,
      }, entry.label))
    }

    if (operation.type === 'add_skill_mod') {
      return skillTargetBase(operation.match).map((target) => withLabel({
        id: makeModId(),
        enabled: true,
        label: entry.label,
        scope: 'skill',
        ...target,
        effect: 'mod',
        mod: operation.mod,
        value,
      }, entry.label))
    }

    if (operation.type === 'add_skill_multiplier') {
      return skillTargetBase(operation.match).map((target) => withLabel({
        id: makeModId(),
        enabled: true,
        label: entry.label,
        scope: 'skill',
        ...target,
        effect: 'addMultiplier',
        value: value * 100,
      }, entry.label))
    }

    if (operation.type === 'add_skill_hit_multiplier') {
      return skillTargetBase(operation.match).map((target) => withLabel({
        id: makeModId(),
        enabled: true,
        label: entry.label,
        scope: 'skill',
        ...target,
        effect: 'addHitMultiplier',
        hitIndex: operation.hitIndex,
        value: value * 100,
      }, entry.label))
    }

    if (operation.type === 'scale_skill_multiplier') {
      return skillTargetBase(operation.match).map((target) => withLabel({
        id: makeModId(),
        enabled: true,
        label: entry.label,
        scope: 'skill',
        ...target,
        effect: 'scaleMultiplier',
        value: (value - 1) * 100,
      }, entry.label))
    }

    if (operation.type === 'add_skill_scalar') {
      return skillTargetBase(operation.match).map((target) => withLabel({
        id: makeModId(),
        enabled: true,
        label: entry.label,
        scope: 'skill',
        ...target,
        effect: 'scalar',
        field: operation.field,
        value,
      }, entry.label))
    }

    return []
  })
}
