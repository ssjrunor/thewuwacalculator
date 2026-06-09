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

function resCondSkllT(runtime: ResRuntime, skill: SkillDef): SkillDef['skillType'] {
  if (!skill.skillTypeWhen || skill.skillTypeWhen.length === 0) {
    return skill.skillType
  }

  const scope = getRtSkllEva(runtime)

  for (const entry of skill.skillTypeWhen) {
    if (evalCond(entry.when, scope)) {
      return entry.skillType
    }
  }

  return skill.skillType
}

function resSkllVrnt(runtime: ResRuntime, skill: SkillDef): SkillDef {
  if (!skill.skillVariantWhen || skill.skillVariantWhen.length === 0) {
    return skill
  }

  const scope = getRtSkllEva(runtime)

  for (const entry of skill.skillVariantWhen) {
    if (evalCond(entry.when, scope)) {
      return {
        ...skill,
        ...entry.patch,
      }
    }
  }

  return skill
}

// determine whether a skill should be exposed for the current runtime state
// this respects both a hard visible=false flag and an optional visibleWhen condition
export function isSkllVsbl(runtime: ResRuntime, skill: SkillDef): boolean {
  if (skill.visible === false) {
    return false
  }

  const negFfctCmbtK = skill.tab === 'negativeEffect'
      ? getNegFfctCm(skill.archetype)
      : null

  if (negFfctCmbtK && !isNegFfctVsb(runtime, negFfctCmbtK)) {
    return false
  }

  if (!skill.visibleWhen) {
    return true
  }

  return evalCond(skill.visibleWhen, getRtSkllEva(runtime))
}

// resolve one skill into its runtime-ready form
// this applies visibility, level-scaled multiplier/flat/fixed values,
// expands hit tables if present, and finally applies manual skill overrides
export function resolveSkill(runtime: ResRuntime, skill: SkillDef): SkillDef {
  const rslvSkll = resSkllVrnt(runtime, skill)
  const visible = isSkllVsbl(runtime, rslvSkll)
  const skillType = resCondSkllT(runtime, rslvSkll)
  const levelIndex = resLvlNdx(runtime, rslvSkll)
  const stackKey = rslvSkll.stackMode === 'fixedMax' ? getNegFfctCm(rslvSkll.archetype) : null
  const stackMax = stackKey ? getNegFfctEn(runtime, stackKey)?.max : undefined
  const negFfctKey = rslvSkll.tab === 'negativeEffect' ? getNegFfctCm(rslvSkll.archetype) : null
  const label = negFfctKey
    ? (() => {
      const rslvLbl = getNegFfctEn(runtime, negFfctKey)?.label
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
