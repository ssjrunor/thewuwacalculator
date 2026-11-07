/*
  Author: Runor Ewhro
  description: resolves runtime skill visibility and level-scaled values,
               expands hit tables into concrete hit entries, and applies
               manual skill modifiers before the skill is used elsewhere.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import type { ManualBuffs } from '@/domain/entities/manualBuffs'
import type { EffectScope } from '@/domain/gameData/contracts'
import { makeTeamComp } from '@/engine/gameData/teamComposition'
import {
  getNegFfctCm,
  getNegFfctqf,
  getNegFfctEn,
  isNegFfctVsb,
  type NegativeSourceEvaluator,
} from '@/engine/gameData/negativeEffects'
import type { SkillDamageEntry, SkillDef } from '@/domain/entities/stats'
import { evalCond } from '@/engine/effects/evaluator'
import { applyMnlSkll } from '@/engine/manualBuffs'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'

const rtSkllEvalSc = new WeakMap<ResRuntime, EffectScope>()
export type SkillConditionEvaluator = (condition: NonNullable<SkillDef['visibleWhen']>) => boolean

/** compatibility evaluation for skills not present when a numeric team was compiled. */
export function evalRuntimeSkillCondition(
    runtime: ResRuntime,
    condition: NonNullable<SkillDef['visibleWhen']>,
): boolean {
  return evalCond(condition, getRtSkllEva(runtime))
}

// map the skill's declared level source to a zero-based level table index
// if the skill does not scale from a runtime level source, fall back to index 0
function resLvlNdx(runtime: ResRuntime, skill: SkillDef): number {
  if (!skill.levelSource) {
    return 0
  }

  const level = runtime.base.skillLevels[skill.levelSource] ?? 1
  return Math.max(0, level - 1)
}

// collapse a hit list into one total multiplier by summing multiplier * count
// this is used when the skill has a hit table and we need one aggregate multiplier
function sumHits(skill: Pick<SkillDef, 'hits'>): number {
  return skill.hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
}

// safely read a value from a level-scaling table
// if the exact index is missing, use the last available value, then the fallback
function resTblVl(values: number[] | undefined, index: number, fallback = 0): number {
  if (!values || values.length === 0) {
    return fallback
  }

  return values[index] ?? values[values.length - 1] ?? fallback
}

function selectDamageEntries(
    skill: SkillDef,
    evaluate: SkillConditionEvaluator,
): SkillDamageEntry[] | undefined {
  const entries = skill.damageEntries
  if (!entries?.length) {
    return undefined
  }

  const baseEntries = entries
    .filter((entry) => entry.hitIndex != null && !entry.replacesEntryId)
    .sort((left, right) => left.hitIndex! - right.hitIndex!)
  if (baseEntries.length !== skill.hits.length) {
    return undefined
  }

  const selected = new Map(baseEntries.map((entry) => [entry.id, entry]))
  for (const variant of entries) {
    if (!variant.replacesEntryId || !variant.variantWhen || !evaluate(variant.variantWhen)) {
      continue
    }
    if (selected.has(variant.replacesEntryId)) {
      selected.delete(variant.replacesEntryId)
      selected.set(variant.id, variant)
    }
  }

  return [...selected.values()].sort((left, right) => left.hitIndex! - right.hitIndex!)
}

function getRtSkllEva(runtime: ResRuntime): EffectScope {
  const cached = rtSkllEvalSc.get(runtime)
  if (cached) {
    return cached
  }

  const teamMemIds = Array.from(
      new Set([runtime.id, ...runtime.build.team.filter((memberId): memberId is string => Boolean(memberId))]),
  )
  const scope = {
    context: {
      source: {
        type: 'resonator' as const,
        id: runtime.id,
      },
      sourceRuntime: runtime,
      targetRuntime: runtime,
      activeRuntime: runtime,
      targetRuntimeId: runtime.id,
      activeResonatorId: runtime.id,
      teamMemberIds: teamMemIds,
      team: makeTeamComp(teamMemIds),
      echoSetCounts: countEchoSets(runtime.build.echoes),
    },
    sourceRuntime: runtime,
    targetRuntime: runtime,
    activeRuntime: runtime,
  } satisfies EffectScope

  rtSkllEvalSc.set(runtime, scope)
  return scope
}

function pickSkllTypeI(skill: SkillDef, evaluate: SkillConditionEvaluator): number {
  const entries = skill.skillTypeWhen
  if (!entries || entries.length === 0) {
    return -1
  }

  for (let index = 0; index < entries.length; index += 1) {
    if (evaluate(entries[index]!.when)) {
      return index
    }
  }

  return -1
}

function skllTypeAt(skill: SkillDef, index: number): SkillDef['skillType'] {
  return index < 0 ? skill.skillType : skill.skillTypeWhen![index]!.skillType
}

/*
  a condition outcome selects the skill variant by index. build one immutable
  patched skill per index and share it through the resolution cache.
*/
const variantSkillCache = new WeakMap<SkillDef, Map<number, SkillDef>>()

function pickSkllVrntI(skill: SkillDef, evaluate: SkillConditionEvaluator): number {
  const variants = skill.skillVariantWhen
  if (!variants || variants.length === 0) {
    return -1
  }

  for (let index = 0; index < variants.length; index += 1) {
    if (evaluate(variants[index]!.when)) {
      return index
    }
  }

  return -1
}

function skllVrntAt(skill: SkillDef, index: number): SkillDef {
  if (index < 0) {
    return skill
  }

  let byIndex = variantSkillCache.get(skill)
  if (!byIndex) {
    byIndex = new Map()
    variantSkillCache.set(skill, byIndex)
  }

  const cached = byIndex.get(index)
  if (cached) {
    return cached
  }

  const variant: SkillDef = { ...skill, ...skill.skillVariantWhen![index]!.patch }
  byIndex.set(index, variant)
  return variant
}

// determine whether a skill should be exposed for the current runtime state
// this respects both a hard visible=false flag and an optional visibleWhen condition
export function isSkllVsbl(
    runtime: ResRuntime,
    skill: SkillDef,
    evaluate: SkillConditionEvaluator = (condition) => evalRuntimeSkillCondition(runtime, condition),
    runtimesById?: Readonly<Record<string, ResRuntime>>,
    evaluateNegative?: NegativeSourceEvaluator,
): boolean {
  if (skill.visible === false) {
    return false
  }

  const negFfctCmbtK = skill.tab === 'negativeEffect'
      ? getNegFfctCm(skill.archetype)
      : null

  if (negFfctCmbtK && !isNegFfctVsb(runtime, negFfctCmbtK, runtimesById, evaluateNegative)) {
    return false
  }

  if (!skill.visibleWhen) {
    return true
  }

  return evaluate(skill.visibleWhen)
}

/* cache hit expansion, scaling, and manual overrides by runtime, skill, and
   condition outcomes; evaluate conditions on every call because rotation
   writes can change them. */
const resolvedSkillCache = new WeakMap<SkillDef, Map<string, SkillDef>>()
const manualSkillSignatures = new WeakMap<ManualBuffs['modifiers'], string>()

function manualSkillSignature(modifiers: ManualBuffs['modifiers']): string {
  let signature = manualSkillSignatures.get(modifiers)
  if (signature === undefined) {
    signature = JSON.stringify(modifiers.filter((modifier) => modifier.scope === 'skill'))
    manualSkillSignatures.set(modifiers, signature)
  }
  return signature
}

// resolve one skill into its runtime-ready form
// this applies visibility, level-scaled multiplier/flat/fixed values,
// expands hit tables if present, and finally applies manual skill overrides
export function resolveSkill(
    runtime: ResRuntime,
    skill: SkillDef,
    evaluate: SkillConditionEvaluator = (condition) => evalRuntimeSkillCondition(runtime, condition),
    runtimesById?: Readonly<Record<string, ResRuntime>>,
    evaluateNegative?: NegativeSourceEvaluator,
): SkillDef {
  const variantIndex = pickSkllVrntI(skill, evaluate)
  const rslvSkll = skllVrntAt(skill, variantIndex)
  const visible = isSkllVsbl(runtime, rslvSkll, evaluate, runtimesById, evaluateNegative)
  const skillTypeIndex = pickSkllTypeI(rslvSkll, evaluate)
  const damageEntries = selectDamageEntries(rslvSkll, evaluate)

  let bySignature = resolvedSkillCache.get(skill)
  if (!bySignature) {
    bySignature = new Map()
    resolvedSkillCache.set(skill, bySignature)
  }
  const negativeKey = rslvSkll.stackMode === 'fixedMax' || rslvSkll.tab === 'negativeEffect'
    ? getNegFfctCm(rslvSkll.archetype)
    : null
  const negative = negativeKey ? getNegFfctEn(runtime, negativeKey, runtimesById, evaluateNegative) : null
  const damageEntrySignature = damageEntries?.map((entry) => entry.id).join(',') ?? ''
  // overlay writes and candidate graphs have different runtime identities.
  // construction depends only on these resolved inputs, so keep sharing the
  // immutable skill (and its lowered damage record) across those identities.
  const signature = JSON.stringify([
    resLvlNdx(runtime, rslvSkll), variantIndex, visible, skillTypeIndex,
    damageEntrySignature, negative?.max, negative?.label, negative?.stackMode,
    manualSkillSignature(runtime.state.manualBuffs.modifiers),
  ])
  const cached = bySignature.get(signature)
  if (cached) {
    return cached
  }

  const resolved = buildResolvedSkill(
    runtime,
    rslvSkll,
    visible,
    skllTypeAt(rslvSkll, skillTypeIndex),
    damageEntries,
    runtimesById,
    evaluateNegative,
  )
  if (bySignature.size >= 256) bySignature.delete(bySignature.keys().next().value!)
  bySignature.set(signature, resolved)
  return resolved
}

function buildResolvedSkill(
    runtime: ResRuntime,
    rslvSkll: SkillDef,
    visible: boolean,
    skillType: SkillDef['skillType'],
    damageEntries: SkillDamageEntry[] | undefined,
    runtimesById?: Readonly<Record<string, ResRuntime>>,
    evaluateNegative?: NegativeSourceEvaluator,
): SkillDef {
  const levelIndex = resLvlNdx(runtime, rslvSkll)
  /*
    a team-wide fixed-max rule, such as Hiyuki converting Glacio Chafe to
    Glacio Bite, applies to every matching negative-effect skill. resolve its
    final stack cap here so all calculation paths use the same fixed count.
  */
  const tabKey = rslvSkll.tab === 'negativeEffect' ? getNegFfctCm(rslvSkll.archetype) : null
  const fixedByTeam = tabKey
    ? getNegFfctEn(runtime, tabKey, runtimesById, evaluateNegative)?.stackMode === 'fixedMax'
    : false
  const stackMode = rslvSkll.stackMode === 'fixedMax' || fixedByTeam ? 'fixedMax' as const : rslvSkll.stackMode
  const stackKey = stackMode === 'fixedMax' ? getNegFfctCm(rslvSkll.archetype) : null
  const stackMax = stackKey ? getNegFfctEn(runtime, stackKey, runtimesById, evaluateNegative)?.max : undefined
  const negFfctKey = rslvSkll.tab === 'negativeEffect' ? getNegFfctCm(rslvSkll.archetype) : null
  const label = negFfctKey
    ? (() => {
      const rslvLbl = getNegFfctEn(runtime, negFfctKey, runtimesById, evaluateNegative)?.label
      if (!rslvLbl) {
        return rslvSkll.label
      }

      // preserve authored named skills like "Fine Snow: Glacio Bite" and only
      // relabel the generic catalog placeholder skill such as "Glacio Chafe".
      return rslvSkll.label === getNegFfctqf(negFfctKey)
        ? rslvLbl
        : rslvSkll.label
    })()
    : rslvSkll.label

  // resolve scalar values from their level tables, falling back to base values
  const multiplier = resTblVl(rslvSkll.multiplierValues, levelIndex, rslvSkll.multiplier)
  const flat = resTblVl(rslvSkll.flatValues, levelIndex, rslvSkll.flat)
  const fixedDmg = resTblVl(rslvSkll.fixedDmgValues, levelIndex, rslvSkll.fixedDmg ?? 0)

  // if the skill has no hit table, keep the resolved scalar values directly
  if (!rslvSkll.hitTable || rslvSkll.hitTable.length === 0) {
    return applyMnlSkll({
      ...rslvSkll,
      label,
      visible,
      skillType,
      multiplier,
      flat,
      fixedDmg,
      stackMax,
      ...(stackMode ? { stackMode } : {}),
    }, runtime.state.manualBuffs)
  }

  // otherwise expand every hit row into its resolved multiplier for this level
  const hits = damageEntries?.length
    ? damageEntries.map((entry) => ({
      label: entry.label,
      count: entry.count,
      multiplier: resTblVl(entry.values, levelIndex, entry.multiplier),
    }))
    : rslvSkll.hitTable.map((hit) => ({
      label: hit.label,
      count: hit.count,
      multiplier: hit.values[levelIndex] ?? hit.values[hit.values.length - 1] ?? 0,
    }))

  // recompute the aggregate multiplier from the resolved hit entries
  return applyMnlSkll({
    ...rslvSkll,
    label,
    visible,
    skillType,
    flat,
    fixedDmg,
    multiplier: sumHits({ hits }),
    hits,
    ...(damageEntries ? { damageEntries } : {}),
    stackMax,
    ...(stackMode ? { stackMode } : {}),
  }, runtime.state.manualBuffs)
}
