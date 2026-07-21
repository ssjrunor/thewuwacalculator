/*
  Author: Runor Ewhro
  Description: Pure transition/derivation logic for manual buff modifiers,
               shared by every renderer (buffs pane + teammate modal) so the
               well-structured backend has one source of truth for how a
               modifier's scope, fields, value bounds, and summary resolve.
*/

import type {
  MnlBaseStatK,
  MnlMod,
  MnlModScp,
  MnlModVlKey,
  MnlNegFfctModKey,
  MnlSkllMtchM,
  MnlSkllSclrK,
  MnlTopStatKe,
} from '@/domain/entities/manualBuffs.ts'
import type { AttributeKey, NegEffectKey, SkillTypeKey } from '@/domain/entities/stats.ts'
import { mkDefMnlMod } from '@/domain/state/defaults.ts'
import { clmpMnlModVl } from '@/modules/calculator/features/buffs/lib/helpers.ts'
import {
  ADV_SKILL_TYPES,
  DVNCBASESTAT,
  DVNCBASESTuv,
  DVNCTOPSTATP,
  DVNCTTRBPTNS,
  MOD_VL_PTNS,
  NEG_EFFECT_MODS,
  NEG_EFFECT_OPTS,
  SKLLMODPTNS,
  SKLLSCLRPTNS,
  type BuffOption,
} from '@/modules/calculator/features/buffs/lib/options.ts'

type SkillMod = Extract<MnlMod, { scope: 'skill' }>

export interface SkillMatchOption {
  value: string
  label: string
}

function optMax(options: Array<BuffOption>, value: string | undefined, fallback = 999): number {
  return options.find((option) => option.value === value)?.max ?? fallback
}

function optLabel(options: Array<BuffOption>, value: string | undefined, fallback = 'Unspecified'): string {
  return options.find((option) => option.value === value)?.label ?? fallback
}

export function getSkllModPt(modifier: SkillMod): string {
  return modifier.effect === 'mod' ? modifier.mod : modifier.effect
}

export function getModVlMax(modifier: MnlMod): number {
  if (modifier.scope === 'baseStat') {
    return optMax(DVNCBASESTuv, modifier.field, 999)
  }
  if (modifier.scope === 'topStat') {
    return optMax(DVNCTOPSTATP, modifier.stat, 999)
  }
  if (modifier.scope === 'skill') {
    if (modifier.effect === 'scalar') {
      return optMax(SKLLSCLRPTNS, modifier.field, 999)
    }
    return optMax(SKLLMODPTNS, getSkllModPt(modifier), 999)
  }
  if (modifier.scope === 'negativeEffect') {
    return optMax(NEG_EFFECT_MODS, modifier.mod, 999)
  }
  return 999
}

export function getModVlSfx(modifier: MnlMod): string | null {
  if (modifier.scope === 'topStat' && modifier.stat === 'tuneBreakBoost') {
    return null
  }
  return getModVlMax(modifier) === 9999 ? null : '%'
}

// change a modifier to a new scope, resetting fields to that scope's defaults
// while preserving its identity and enabled state.
export function changeModScope(modifier: MnlMod, scope: MnlModScp): MnlMod {
  return { ...mkDefMnlMod(modifier.id, scope), enabled: modifier.enabled }
}

export function setModValue(modifier: MnlMod, rawValue: number): MnlMod {
  return { ...modifier, value: clmpMnlModVl(modifier, rawValue) }
}

// re-clamps value because the ceiling can change when the field/stat changes.
function reclamp(next: MnlMod): MnlMod {
  return { ...next, value: clmpMnlModVl(next, next.value) }
}

export function setBaseStat(modifier: MnlMod, stat: MnlBaseStatK): MnlMod {
  return { ...(modifier as Extract<MnlMod, { scope: 'baseStat' }>), stat }
}

export function setBaseField(modifier: MnlMod, field: 'flat' | 'percent'): MnlMod {
  return reclamp({ ...(modifier as Extract<MnlMod, { scope: 'baseStat' }>), field })
}

export function setTopStat(modifier: MnlMod, stat: MnlTopStatKe): MnlMod {
  return reclamp({ ...(modifier as Extract<MnlMod, { scope: 'topStat' }>), stat })
}

export function setAttribute(modifier: MnlMod, attribute: AttributeKey | 'all'): MnlMod {
  return { ...(modifier as Extract<MnlMod, { scope: 'attribute' }>), attribute }
}

export function setSkillType(modifier: MnlMod, skillType: SkillTypeKey): MnlMod {
  return { ...(modifier as Extract<MnlMod, { scope: 'skillType' }>), skillType }
}

// the mod key shared by attribute + skillType scopes
export function setElementMod(modifier: MnlMod, mod: MnlModVlKey): MnlMod {
  return { ...(modifier as Extract<MnlMod, { scope: 'attribute' | 'skillType' }>), mod }
}

export function setNegEffect(modifier: MnlMod, negativeEffect: NegEffectKey): MnlMod {
  return { ...(modifier as Extract<MnlMod, { scope: 'negativeEffect' }>), negativeEffect }
}

export function setNegMod(modifier: MnlMod, mod: MnlNegFfctModKey): MnlMod {
  return reclamp({ ...(modifier as Extract<MnlMod, { scope: 'negativeEffect' }>), mod })
}

export function setSkillMatchMode(
  modifier: MnlMod,
  matchMode: MnlSkllMtchM,
  tabFallback: string,
): MnlMod {
  const current = modifier as SkillMod
  return {
    ...current,
    matchMode,
    skillId: matchMode === 'skillId' ? current.skillId ?? '' : undefined,
    tab: matchMode === 'tab' ? current.tab ?? tabFallback : undefined,
    skillType: matchMode === 'skillType' ? current.skillType ?? 'all' : undefined,
  }
}

export function setSkillTarget(modifier: MnlMod, value: string): MnlMod {
  const current = modifier as SkillMod
  if (current.matchMode === 'skillId') {
    return { ...current, skillId: value }
  }
  if (current.matchMode === 'tab') {
    return { ...current, tab: value }
  }
  return { ...current, skillType: value as SkillTypeKey }
}

// the "Modifier" select on a skill modifier chooses between mod keys and the
// special multiplier/scalar effects; rebuild the row for the chosen effect.
export function applySkillMod(modifier: MnlMod, optionValue: string): MnlMod {
  const current = modifier as SkillMod
  const shared = {
    id: current.id,
    enabled: current.enabled,
    label: current.label,
    scope: 'skill' as const,
    matchMode: current.matchMode,
    skillId: current.skillId,
    tab: current.tab,
    skillType: current.skillType,
    value: current.value,
  }

  if (optionValue === 'addMultiplier') {
    return { ...shared, effect: 'addMultiplier' }
  }
  if (optionValue === 'scaleMultiplier') {
    return { ...shared, effect: 'scaleMultiplier' }
  }
  if (optionValue === 'addHitMultiplier') {
    return { ...shared, effect: 'addHitMultiplier', hitIndex: current.effect === 'addHitMultiplier' ? current.hitIndex : 0 }
  }
  if (optionValue === 'scalar') {
    return { ...shared, effect: 'scalar', field: current.effect === 'scalar' ? current.field : 'fixedDmg' }
  }
  return { ...current, effect: 'mod', mod: optionValue as MnlModVlKey }
}

export function setSkillScalarField(modifier: MnlMod, field: MnlSkllSclrK): MnlMod {
  return reclamp({ ...(modifier as Extract<MnlMod, { scope: 'skill'; effect: 'scalar' }>), field })
}

export function setSkillHit(modifier: MnlMod, hitOneBased: number): MnlMod {
  return {
    ...(modifier as Extract<MnlMod, { scope: 'skill'; effect: 'addHitMultiplier' }>),
    hitIndex: Math.max(0, hitOneBased - 1),
  }
}

// the target-side selectable options for a skill modifier, given the resonator's
// skills and skill tabs.
export function skillMatchOptions(
  modifier: SkillMod,
  skillOptions: SkillMatchOption[],
  tabOptions: SkillMatchOption[],
): SkillMatchOption[] {
  if (modifier.matchMode === 'skillId') {
    return [{ value: '', label: 'Select skill' }, ...skillOptions]
  }
  if (modifier.matchMode === 'tab') {
    return tabOptions.length > 0 ? tabOptions : [{ value: 'normalAttack', label: 'Normal Attack' }]
  }
  return ADV_SKILL_TYPES
}

function skillTargetValue(modifier: SkillMod): string {
  if (modifier.matchMode === 'skillId') {
    return modifier.skillId ?? ''
  }
  if (modifier.matchMode === 'tab') {
    return modifier.tab ?? ''
  }
  return modifier.skillType ?? 'all'
}

// one-line summary of what a modifier does, for row headers.
export function modSummary(
  modifier: MnlMod,
  ctx: { skillOptions: SkillMatchOption[]; tabOptions: SkillMatchOption[] },
): string {
  if (modifier.scope === 'baseStat') {
    return `${optLabel(DVNCBASESTAT, modifier.stat)} · ${optLabel(DVNCBASESTuv, modifier.field)}`
  }
  if (modifier.scope === 'topStat') {
    return optLabel(DVNCTOPSTATP, modifier.stat)
  }
  if (modifier.scope === 'attribute') {
    return `${optLabel(DVNCTTRBPTNS, modifier.attribute)} · ${optLabel(MOD_VL_PTNS, modifier.mod)}`
  }
  if (modifier.scope === 'skillType') {
    return `${optLabel(ADV_SKILL_TYPES, modifier.skillType)} · ${optLabel(MOD_VL_PTNS, modifier.mod)}`
  }
  if (modifier.scope === 'negativeEffect') {
    return `${optLabel(NEG_EFFECT_OPTS, modifier.negativeEffect)} · ${optLabel(NEG_EFFECT_MODS, modifier.mod)}`
  }

  const target = optLabel(
    skillMatchOptions(modifier, ctx.skillOptions, ctx.tabOptions),
    skillTargetValue(modifier),
  )

  if (modifier.effect === 'mod') {
    return `${target} · ${optLabel(MOD_VL_PTNS, modifier.mod)}`
  }
  if (modifier.effect === 'scalar') {
    return `${target} · ${optLabel(SKLLSCLRPTNS, modifier.field)}`
  }
  if (modifier.effect === 'addHitMultiplier') {
    return `${target} · Hit ${modifier.hitIndex + 1} MV`
  }
  return `${target} · ${optLabel(SKLLMODPTNS, modifier.effect)}`
}
