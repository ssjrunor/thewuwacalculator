/*
  Author: Runor Ewhro
  Description: derives default optimizer settings from the current runtime,
               selected target skill, and marginal stat weighting heuristics.
*/

import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { OptSets } from '@/domain/entities/optimizer.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { SkillDef } from '@/domain/entities/stats.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters.ts'
import { makeStatWeights } from '@/engine/optimizer/search/filtering.ts'
import { listOptTrgt } from '@/engine/optimizer/target/skills.ts'
import { makeSkillCtx, prepareSkill } from '@/engine/pipeline/prepareRuntimeSkill.ts'

const ELEMENT_KEYS = [
  'glacio',
  'fusion',
  'electro',
  'aero',
  'spectro',
  'havoc',
] as const

const MAIN_STAT_IDS = [
  'atk%',
  'hp%',
  'def%',
  'er',
  'cr',
  'cd',
  'bonus',
  'healing',
] as const satisfies ReadonlyArray<OptSets['mainStatFilter'][number]>

// map internal stat-weight keys back into user-facing main-stat filter ids
function mapWeightKey(
  key: string,
): OptSets['mainStatFilter'][number] | null {
  if (key === 'atkPercent') return 'atk%'
  if (key === 'hpPercent') return 'hp%'
  if (key === 'defPercent') return 'def%'
  if (key === 'energyRegen') return 'er'
  if (key === 'critRate') return 'cr'
  if (key === 'critDmg') return 'cd'
  if (key === 'healingBonus') return 'healing'
  if (ELEMENT_KEYS.includes(key as (typeof ELEMENT_KEYS)[number])) return 'bonus'
  return null
}

// pick the strongest elemental bonus bucket so defaults can prefer it
function pickDefaultBonus(weights: Partial<Record<string, number>>): string | null {
  let bestKey: string | null = null
  let bestWeight = 0

  for (const key of ELEMENT_KEYS) {
    const weight = weights[key] ?? 0
    if (weight > bestWeight) {
      bestWeight = weight
      bestKey = key
    }
  }

  return bestKey
}

function makeTargetSkill(params: {
  runtime: ResRuntime
  enemy: EnemyProfile
  selectedTargets?: Record<string, string | null>
}): SkillDef | null {
  const { runtime, enemy, selectedTargets } = params
  const targetSkill = listOptTrgt(runtime)[0] ?? null
  if (!targetSkill) {
    return null
  }

  const seed = getResSeedBy(runtime.id)
  if (!seed) {
    return null
  }

  const { context } = makeSkillCtx({
    runtime,
    seed,
    enemy,
    runtimesById: makeRuntimeMap(runtime),
    selectedTargets,
  })

  return prepareSkill(runtime, targetSkill.id, context)
}

// optimizer settings that are machine/ui preferences rather than
// resonator-specific build choices. these carry over when the optimizer
// context re-derives for a newly active resonator, so switching characters
// does not silently revert the user's compute backend, low-memory toggle,
// inventory/theory search mode, result-window sliders, or skill/combo target
// mode. combo mode is gated downstream; if the new resonator has no rotation
// features the optimizer surface forces skill mode regardless of what carries
// over here.
export function preserveToggles(existing?: OptSets | null): Partial<OptSets> {
  if (!existing) {
    return {}
  }

  return {
    searchMode: existing.searchMode,
    enableGpu: existing.enableGpu,
    lowMemoryMode: existing.lowMemoryMode,
    resultsLimit: existing.resultsLimit,
    keepPercent: existing.keepPercent,
    excludeEquipped: existing.excludeEquipped,
    targetMode: existing.targetMode,
    rotationMode: existing.rotationMode,
  }
}

export function deriveOptSets(params: {
  runtime: ResRuntime
  enemy: EnemyProfile
  selectedTargets?: Record<string, string | null>
}): Partial<OptSets> {
  const { runtime, enemy, selectedTargets } = params
  const targetSkill = listOptTrgt(runtime)[0] ?? null
  if (!targetSkill) {
    return {}
  }

  const preparedSkill = makeTargetSkill({
    runtime,
    enemy,
    selectedTargets,
  })
  if (!preparedSkill) {
    return {
      targetSkillId: targetSkill.id,
    }
  }

  const seed = getResSeedBy(runtime.id)
  if (!seed) {
    return {
      targetSkillId: targetSkill.id,
    }
  }

  const { context } = makeSkillCtx({
    runtime,
    seed,
    enemy,
    runtimesById: makeRuntimeMap(runtime),
    selectedTargets,
  })

  const weights = makeStatWeights({
    finalStats: context.finalStats,
    skill: preparedSkill,
    enemy,
    level: runtime.base.level,
    combat: runtime.state.combat,
  })

  const filterSet = new Set<OptSets['mainStatFilter'][number]>()
  for (const [key, value] of Object.entries(weights)) {
    if ((value ?? 0) <= 0) {
      continue
    }
    const filterKey = mapWeightKey(key)
    if (filterKey) {
      filterSet.add(filterKey)
    }
  }

  const characterId = Number.parseInt(runtime.id, 10)
  if (characterId === 1206 || characterId === 1209 || characterId === 1412) {
    filterSet.add('er')
  }

  const selectedBonus = pickDefaultBonus(weights)
  if (selectedBonus) {
    filterSet.add('bonus')
  }

  return {
    targetSkillId: targetSkill.id,
    targetMode: 'skill',
    targetComboSourceId: `live:${runtime.id}`,
    mainStatFilter: MAIN_STAT_IDS.filter((key) => filterSet.has(key)),
    selectedBonus,
  }
}
