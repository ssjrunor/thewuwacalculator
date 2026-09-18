/*
  Author: Runor Ewhro
  Description: resolves runtime skill visibility and level-scaled values,
               expands hit tables into concrete hit entries, and applies
               manual skill modifiers before the skill is used elsewhere.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import type { EffectScope } from '@/domain/gameData/contracts'
import { makeTeamComp } from '@/domain/gameData/teamComposition'
import {
  getNegFfctCm,
  getNegFfctqf,
  getNegFfctEn,
  isNegFfctVsb,
} from '@/domain/gameData/negativeEffects'
import type { SkillDef } from '@/domain/entities/stats'
import { evalCond } from '@/engine/effects/evaluator'
import { applyMnlSkll } from '@/engine/manualBuffs'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'

const rtSkllEvalSc = new WeakMap<ResRuntime, EffectScope>()
export type SkillConditionEvaluator = (condition: NonNullable<SkillDef['visibleWhen']>) => boolean

/** Compatibility evaluation for skills not present when a numeric team was compiled. */
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
  Which variant a skill takes is a condition outcome, so it is resolved as an
  index. The patched skill for one index never changes, so it is built once and
  shared: the resolution cache below keys on the index, not on the object.
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
): boolean {
  if (skill.visible === false) {
    return false
  }

  const negFfctCmbtK = skill.tab === 'negativeEffect'
      ? getNegFfctCm(skill.archetype)
      : null

  if (negFfctCmbtK && !isNegFfctVsb(runtime, negFfctCmbtK, runtimesById)) {
    return false
  }

  if (!skill.visibleWhen) {
    return true
  }

  return evaluate(skill.visibleWhen)
}

/*
  Resolving a skill expands its hit table, resolves level scaling, and applies
  manual overrides, which allocates a skill and a row per hit. None of that
  depends on anything but the runtime, the skill, and the three condition
  outcomes below, so it is built once per distinct combination.

  Rotation execution resolves a skill on every feature node, hundreds of times
  per run, almost always reaching the same combination it reached last time.
  The conditions are still evaluated on every call, because rotation state
  writes can change them mid-run; only the construction is reused.
*/
const resolvedSkillCache = new WeakMap<ResRuntime, WeakMap<SkillDef, Map<string, SkillDef>>>()
const resolvedTeamSkillCache = new WeakMap<
  ResRuntime,
  WeakMap<Readonly<Record<string, ResRuntime>>, WeakMap<SkillDef, Map<string, SkillDef>>>
>()

// resolve one skill into its runtime-ready form
// this applies visibility, level-scaled multiplier/flat/fixed values,
// expands hit tables if present, and finally applies manual skill overrides
export function resolveSkill(
    runtime: ResRuntime,
    skill: SkillDef,
    evaluate: SkillConditionEvaluator = (condition) => evalRuntimeSkillCondition(runtime, condition),
    runtimesById?: Readonly<Record<string, ResRuntime>>,
): SkillDef {
  const variantIndex = pickSkllVrntI(skill, evaluate)
  const rslvSkll = skllVrntAt(skill, variantIndex)
  const visible = isSkllVsbl(runtime, rslvSkll, evaluate, runtimesById)
  const skillTypeIndex = pickSkllTypeI(rslvSkll, evaluate)

  let bySkill: WeakMap<SkillDef, Map<string, SkillDef>>
  if (runtimesById) {
    let byTeam = resolvedTeamSkillCache.get(runtime)
    if (!byTeam) {
      byTeam = new WeakMap()
      resolvedTeamSkillCache.set(runtime, byTeam)
    }
    bySkill = byTeam.get(runtimesById) ?? new WeakMap()
    byTeam.set(runtimesById, bySkill)
  } else {
    bySkill = resolvedSkillCache.get(runtime) ?? new WeakMap()
    resolvedSkillCache.set(runtime, bySkill)
  }
  let bySignature = bySkill.get(skill)
  if (!bySignature) {
    bySignature = new Map()
    bySkill.set(skill, bySignature)
  }
  const signature = `${variantIndex}|${visible ? 1 : 0}|${skillTypeIndex}`
  const cached = bySignature.get(signature)
  if (cached) {
    return cached
  }

  const resolved = buildResolvedSkill(
    runtime,
    rslvSkll,
    visible,
    skllTypeAt(rslvSkll, skillTypeIndex),
    runtimesById,
  )
  bySignature.set(signature, resolved)
  return resolved
}

function buildResolvedSkill(
    runtime: ResRuntime,
    rslvSkll: SkillDef,
    visible: boolean,
    skillType: SkillDef['skillType'],
    runtimesById?: Readonly<Record<string, ResRuntime>>,
): SkillDef {
  const levelIndex = resLvlNdx(runtime, rslvSkll)
  const stackKey = rslvSkll.stackMode === 'fixedMax' ? getNegFfctCm(rslvSkll.archetype) : null
  const stackMax = stackKey ? getNegFfctEn(runtime, stackKey, runtimesById)?.max : undefined
  const negFfctKey = rslvSkll.tab === 'negativeEffect' ? getNegFfctCm(rslvSkll.archetype) : null
  const label = negFfctKey
    ? (() => {
      const rslvLbl = getNegFfctEn(runtime, negFfctKey, runtimesById)?.label
      if (!rslvLbl) {
        return rslvSkll.label
      }

      // Preserve authored named skills like "Fine Snow: Glacio Bite" and only
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
    }, runtime.state.manualBuffs)
  }

  // otherwise expand every hit row into its resolved multiplier for this level
  const hits = rslvSkll.hitTable.map((hit) => ({
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
    stackMax,
  }, runtime.state.manualBuffs)
}
