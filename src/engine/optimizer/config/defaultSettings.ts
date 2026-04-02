import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { OptimizerSettings } from '@/domain/entities/optimizer.ts'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime.ts'
import type { SkillDefinition } from '@/domain/entities/stats.ts'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService.ts'
import { buildRuntimeParticipantLookup } from '@/domain/state/runtimeAdapters.ts'
import { buildOptimizerStatWeightMap } from '@/engine/optimizer/search/filtering.ts'
import { listOptimizerTargets } from '@/engine/optimizer/target/skills.ts'
import { buildRuntimeSkillContext, prepareRuntimeSkillById } from '@/engine/pipeline/prepareRuntimeSkill.ts'

const ELEMENT_WEIGHT_KEYS = [
  'glacio',
  'fusion',
  'electro',
  'aero',
  'spectro',
  'havoc',
] as const

const MAIN_STAT_FILTER_ORDER = [
  'atk%',
  'hp%',
  'def%',
  'er',
  'cr',
  'cd',
  'bonus',
  'healing',
] as const satisfies ReadonlyArray<OptimizerSettings['mainStatFilter'][number]>

function mapWeightKeyToMainStatFilterKey(
  key: string,
): OptimizerSettings['mainStatFilter'][number] | null {
  if (key === 'atkPercent') return 'atk%'
  if (key === 'hpPercent') return 'hp%'
  if (key === 'defPercent') return 'def%'
  if (key === 'energyRegen') return 'er'
  if (key === 'critRate') return 'cr'
  if (key === 'critDmg') return 'cd'
  if (key === 'healingBonus') return 'healing'
  if (ELEMENT_WEIGHT_KEYS.includes(key as (typeof ELEMENT_WEIGHT_KEYS)[number])) return 'bonus'
  return null
}

function pickDefaultBonus(weights: Partial<Record<string, number>>): string | null {
  let bestKey: string | null = null
  let bestWeight = 0

  for (const key of ELEMENT_WEIGHT_KEYS) {
    const weight = weights[key] ?? 0
    if (weight > bestWeight) {
      bestWeight = weight
      bestKey = key
    }
  }

  return bestKey
}

function buildPreparedTargetSkill(params: {
  runtime: ResonatorRuntimeState
  enemy: EnemyProfile
  selectedTargetsByOwnerKey?: Record<string, string | null>
}): SkillDefinition | null {
  const { runtime, enemy, selectedTargetsByOwnerKey } = params
  const targetSkill = listOptimizerTargets(runtime)[0] ?? null
  if (!targetSkill) {
    return null
  }

  const seed = getResonatorSeedById(runtime.id)
  if (!seed) {
    return null
  }

  const { context } = buildRuntimeSkillContext({
    runtime,
    seed,
    enemy,
    runtimesById: buildRuntimeParticipantLookup(runtime),
    selectedTargetsByOwnerKey,
  })

  return prepareRuntimeSkillById(runtime, targetSkill.id, context)
}

export function deriveInitialOptimizerSettings(params: {
  runtime: ResonatorRuntimeState
  enemy: EnemyProfile
  selectedTargetsByOwnerKey?: Record<string, string | null>
}): Partial<OptimizerSettings> {
  const { runtime, enemy, selectedTargetsByOwnerKey } = params
  const targetSkill = listOptimizerTargets(runtime)[0] ?? null
  if (!targetSkill) {
    return {}
  }

  const preparedSkill = buildPreparedTargetSkill({
    runtime,
    enemy,
    selectedTargetsByOwnerKey,
  })
  if (!preparedSkill) {
    return {
      targetSkillId: targetSkill.id,
    }
  }

  const seed = getResonatorSeedById(runtime.id)
  if (!seed) {
    return {
      targetSkillId: targetSkill.id,
    }
  }

  const { context } = buildRuntimeSkillContext({
    runtime,
    seed,
    enemy,
    runtimesById: buildRuntimeParticipantLookup(runtime),
    selectedTargetsByOwnerKey,
  })

  const weights = buildOptimizerStatWeightMap({
    finalStats: context.finalStats,
    skill: preparedSkill,
    enemy,
    level: runtime.base.level,
    combat: runtime.state.combat,
  })

  const filterSet = new Set<OptimizerSettings['mainStatFilter'][number]>()
  for (const [key, value] of Object.entries(weights)) {
    if ((value ?? 0) <= 0) {
      continue
    }
    const filterKey = mapWeightKeyToMainStatFilterKey(key)
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
    mainStatFilter: MAIN_STAT_FILTER_ORDER.filter((key) => filterSet.has(key)),
    selectedBonus,
  }
}
