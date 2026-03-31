/*
  Author: Runor Ewhro
  Description: resolves runtime skill visibility and level-scaled values,
               expands hit tables into concrete hit entries, and applies
               manual skill modifiers before the skill is used elsewhere.
*/

import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import { buildTeamCompositionInfo } from '@/domain/gameData/teamComposition'
import type { SkillDefinition } from '@/domain/entities/stats'
import { evaluateCondition } from '@/engine/effects/evaluator'
import { applyManualSkillModifiers } from '@/engine/manualBuffs'
import { computeEchoSetCounts } from '@/engine/pipeline/buildCombatContext'

// map the skill's declared level source to a zero-based level table index
// if the skill does not scale from a runtime level source, fall back to index 0
function resolveLevelIndex(runtime: ResonatorRuntimeState, skill: SkillDefinition): number {
  if (!skill.levelSource) {
    return 0
  }

  const level = runtime.base.skillLevels[skill.levelSource] ?? 1
  return Math.max(0, level - 1)
}

// collapse a hit list into one total multiplier by summing multiplier * count
// this is used when the skill has a hit table and we need one aggregate multiplier
function sumHits(skill: Pick<SkillDefinition, 'hits'>): number {
  return skill.hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
}

// safely read a value from a level-scaling table
// if the exact index is missing, use the last available value, then the fallback
function resolveTableValue(values: number[] | undefined, index: number, fallback = 0): number {
  if (!values || values.length === 0) {
    return fallback
  }

  return values[index] ?? values[values.length - 1] ?? fallback
}

// determine whether a skill should be exposed for the current runtime state
// this respects both a hard visible=false flag and an optional visibleWhen condition
export function isSkillVisible(runtime: ResonatorRuntimeState, skill: SkillDefinition): boolean {
  if (skill.visible === false) {
    return false
  }

  if (!skill.visibleWhen) {
    return true
  }

  // build the team context expected by the condition evaluator
  const teamMemberIds = Array.from(
      new Set([runtime.id, ...runtime.build.team.filter((memberId): memberId is string => Boolean(memberId))]),
  )

  return evaluateCondition(skill.visibleWhen, {
    context: {
      source: {
        type: 'resonator',
        id: runtime.id,
      },
      sourceRuntime: runtime,
      targetRuntime: runtime,
      activeRuntime: runtime,
      targetRuntimeId: runtime.id,
      activeResonatorId: runtime.id,
      teamMemberIds,
      team: buildTeamCompositionInfo(teamMemberIds),
      echoSetCounts: computeEchoSetCounts(runtime.build.echoes),
    },
    sourceRuntime: runtime,
    targetRuntime: runtime,
    activeRuntime: runtime,
  })
}

// resolve one skill into its runtime-ready form
// this applies visibility, level-scaled multiplier/flat/fixed values,
// expands hit tables if present, and finally applies manual skill overrides
export function resolveSkill(runtime: ResonatorRuntimeState, skill: SkillDefinition): SkillDefinition {
  const visible = isSkillVisible(runtime, skill)
  const levelIndex = resolveLevelIndex(runtime, skill)

  // resolve scalar values from their level tables, falling back to base values
  const multiplier = resolveTableValue(skill.multiplierValues, levelIndex, skill.multiplier)
  const flat = resolveTableValue(skill.flatValues, levelIndex, skill.flat)
  const fixedDmg = resolveTableValue(skill.fixedDmgValues, levelIndex, skill.fixedDmg ?? 0)

  // if the skill has no hit table, keep the resolved scalar values directly
  if (!skill.hitTable || skill.hitTable.length === 0) {
    return applyManualSkillModifiers({
      ...skill,
      visible,
      multiplier,
      flat,
      fixedDmg,
    }, runtime.state.manualBuffs)
  }

  // otherwise expand every hit row into its resolved multiplier for this level
  const hits = skill.hitTable.map((hit) => ({
    label: hit.label,
    count: hit.count,
    multiplier: hit.values[levelIndex] ?? hit.values[hit.values.length - 1] ?? 0,
  }))

  // recompute the aggregate multiplier from the resolved hit entries
  return applyManualSkillModifiers({
    ...skill,
    visible,
    flat,
    fixedDmg,
    multiplier: sumHits({ hits }),
    hits,
  }, runtime.state.manualBuffs)
}