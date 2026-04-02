/*
  Author: Runor Ewhro
  Description: shared suggestions view helpers for signatures, diff labels,
               random-set normalization, and echo preview summaries.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { EchoInstance, ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { SonataSetConditionals } from '@/domain/entities/sonataSetConditionals'
import type { RandomGeneratorSettings, RandomGeneratorSetPreference } from '@/domain/entities/suggestions'
import { ECHO_PRIMARY_STATS, ECHO_SECONDARY_STATS } from '@/data/gameData/catalog/echoStats'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat-suggestion/utils'
import { formatCompactNumber, formatStatKeyLabel, formatStatKeyValue } from '@/modules/calculator/model/overviewStats'
import { getEquippedEchoCost, sortEchoesByCostDescending } from '@/modules/calculator/model/echoes'

export type SuggestionsViewMode = 'mainStats' | 'setPlans' | 'random'

export const ROTATION_TARGET_VALUE = '__rotation__'

export const DEFAULT_RANDOM_SETTINGS: RandomGeneratorSettings = {
  bias: 0.5,
  rollQuality: 0.3,
  targetEnergyRegen: 0,
  setPreferences: [],
  mainEchoId: null,
}

export const DEFAULT_SUGGESTIONS_STATE = {
  settings: {
    targetFeatureId: null,
    rotationMode: false,
  },
  random: DEFAULT_RANDOM_SETTINGS,
} as const

export interface SetPlanSummaryEntry {
  setId: number
  pieces: number
}

// format a damage total with the calculator's compact number style
export function formatDamage(value: number): string {
  return `${formatCompactNumber(value)} dmg`
}

// compare a suggestion against the current baseline
export function computeDiffPercent(damage: number, baseDamage: number): number {
  if (baseDamage <= 0) {
    return 0
  }

  return Number((((damage / baseDamage) - 1) * 100).toFixed(2))
}

// pick the correct ui tone for a percentage diff
export function getDiffTone(diffPercent: number): 'positive' | 'negative' | 'zero' {
  if (diffPercent > 0) {
    return 'positive'
  }

  if (diffPercent < 0) {
    return 'negative'
  }

  return 'zero'
}

// keep the current-entry label distinct from percentage deltas
export function getDiffLabel(diffPercent: number, isCurrent: boolean): string {
  if (isCurrent) {
    return 'Current'
  }

  return `${Math.abs(diffPercent).toFixed(2)}%`
}

// decorate percentage diffs with an arrow only when they move
export function getDiffArrow(diffPercent: number): string {
  if (diffPercent > 0) {
    return '⬆'
  }

  if (diffPercent < 0) {
    return '⬇'
  }

  return ''
}

// capture an exact equipped-echo signature for cache keys and equality checks
export function buildEchoFullSignature(echoes: Array<EchoInstance | null>): string {
  return echoes
    .filter((echo): echo is EchoInstance => echo != null)
    .map((echo) => [
      echo.id,
      echo.set,
      `${echo.mainStats.primary.key}:${echo.mainStats.primary.value}`,
      ...Object.entries(echo.substats)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}:${value}`),
    ].join('::'))
    .sort()
    .join('||')
}

// turn an object into a stable string form for cache signatures
export function stringifySortedRecord(record: Record<string, unknown>): string {
  return Object.entries(record)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => (
      `${key}:${typeof value === 'object' && value != null ? JSON.stringify(value) : String(value)}`
    ))
    .join('||')
}

// serialize the active runtime fields that affect suggestion output
export function buildRuntimeSuggestionSignature(runtime: ResonatorRuntimeState): string {
  return JSON.stringify({
    id: runtime.id,
    base: runtime.base,
    build: {
      weapon: runtime.build.weapon,
      team: runtime.build.team,
      echoes: runtime.build.echoes.map((echo) => (
        echo
          ? {
            uid: echo.uid,
            id: echo.id,
            set: echo.set,
            mainEcho: echo.mainEcho,
            mainStats: echo.mainStats,
            substats: Object.entries(echo.substats).sort(([left], [right]) => left.localeCompare(right)),
          }
          : null
      )),
    },
    state: {
      controls: Object.entries(runtime.state.controls).sort(([left], [right]) => left.localeCompare(right)),
      manualBuffs: runtime.state.manualBuffs,
      combat: runtime.state.combat,
    },
    rotation: runtime.rotation,
    teamRuntimes: runtime.teamRuntimes,
  })
}

// serialize enemy settings that affect the suggestion engine
export function buildEnemySignature(enemy: EnemyProfile): string {
  return JSON.stringify({
    id: enemy.id,
    level: enemy.level,
    class: enemy.class,
    toa: enemy.toa,
    source: enemy.source ?? null,
    status: enemy.status ?? null,
    res: enemy.res,
  })
}

// serialize the participant runtime bag in a stable resonator-id order
export function buildParticipantRuntimeSignature(
  runtimesById: Record<string, ResonatorRuntimeState>,
): string {
  return Object.entries(runtimesById)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resonatorId, runtime]) => `${resonatorId}:${buildRuntimeSuggestionSignature(runtime)}`)
    .join('##')
}

// serialize random-generator settings for result caching
export function buildRandomSettingsSignature(settings: RandomGeneratorSettings): string {
  return JSON.stringify({
    bias: settings.bias,
    rollQuality: settings.rollQuality,
    targetEnergyRegen: settings.targetEnergyRegen,
    mainEchoId: settings.mainEchoId,
    setPreferences: [...settings.setPreferences].sort((left, right) => left.setId - right.setId || left.count - right.count),
  })
}

export function buildSetConditionalsSignature(setConditionals?: SonataSetConditionals): string {
  if (!setConditionals) {
    return 'null'
  }

  return JSON.stringify({
    version: setConditionals.version,
    encoding: setConditionals.encoding,
    keys: setConditionals.keys,
    setIds: setConditionals.setIds,
    wordsPerSet: setConditionals.wordsPerSet,
    masks: setConditionals.masks,
  })
}

// build a stable cache/input signature from all direct-suggestion inputs
export function buildSuggestionInputSignature(options: {
  runtime: ResonatorRuntimeState
  enemyProfile: EnemyProfile
  participantRuntimesById: Record<string, ResonatorRuntimeState>
  selectedTargetsByOwnerKey: Record<string, string | null>
  setConditionals?: SonataSetConditionals
  targetFeatureId: string | null
  rotationMode: boolean
}) {
  const {
    enemyProfile,
    participantRuntimesById,
    rotationMode,
    runtime,
    selectedTargetsByOwnerKey,
    setConditionals,
    targetFeatureId,
  } = options

  return JSON.stringify({
    runtime: buildRuntimeSuggestionSignature(runtime),
    enemy: buildEnemySignature(enemyProfile),
    participants: buildParticipantRuntimeSignature(participantRuntimesById),
    selectedTargetsByOwnerKey: stringifySortedRecord(selectedTargetsByOwnerKey),
    setConditionals: buildSetConditionalsSignature(setConditionals),
    targetFeatureId,
    rotationMode,
  })
}

// order echoes by cost for modal preview displays
export function sortEchoesForDisplay(echoes: Array<EchoInstance | null>): EchoInstance[] {
  return sortEchoesByCostDescending(echoes)
}

// capture the full recipe layout so identical suggestions can be compared cheaply
export function buildMainStatRecipeSignature(recipes: MainStatRecipe[]): string {
  return recipes
    .map((recipe) => [
      recipe.cost,
      recipe.primaryKey,
      ECHO_PRIMARY_STATS[recipe.cost]?.[recipe.primaryKey] ?? 0,
      ECHO_SECONDARY_STATS[recipe.cost]?.key ?? 'atkFlat',
      ECHO_SECONDARY_STATS[recipe.cost]?.value ?? 0,
    ].join('::'))
    .sort()
    .join('||')
}

// keep higher-cost recipes first in the ui
export function sortMainStatRecipesForDisplay(recipes: MainStatRecipe[]): MainStatRecipe[] {
  return [...recipes].sort((left, right) => right.cost - left.cost)
}

// derive the currently active set bonuses from equipped echoes
export function summarizeCurrentSetPlan(echoes: Array<EchoInstance | null>): SetPlanSummaryEntry[] {
  const counts = new Map<number, number>()
  for (const echo of echoes) {
    if (!echo) {
      continue
    }

    counts.set(echo.set, (counts.get(echo.set) ?? 0) + 1)
  }

  return [...counts.entries()]
    .flatMap(([setId, count]) => {
      const definition = ECHO_SET_DEFS.find((entry) => entry.id === setId)
      if (!definition) {
        return []
      }

      if (definition.setMax === 3) {
        return count >= 3 ? [{ setId, pieces: 3 }] : []
      }

      if (count >= 5) {
        return [{ setId, pieces: 5 }]
      }

      if (count >= 2) {
        return [{ setId, pieces: 2 }]
      }

      return []
    })
    .sort((left, right) => left.setId - right.setId)
}

// compare set plans after normalizing their order
export function setPlansEqual(
  left: SetPlanSummaryEntry[],
  right: SetPlanSummaryEntry[],
): boolean {
  const sortedLeft = [...left].sort((a, b) => a.setId - b.setId || a.pieces - b.pieces)
  const sortedRight = [...right].sort((a, b) => a.setId - b.setId || a.pieces - b.pieces)

  if (sortedLeft.length !== sortedRight.length) {
    return false
  }

  return sortedLeft.every((entry, index) => (
    entry.setId === sortedRight[index]?.setId &&
    entry.pieces === sortedRight[index]?.pieces
  ))
}

// summarize the current cost layout for preview labels
export function buildCostSignature(echoes: Array<EchoInstance | null>): string {
  return echoes
    .filter((echo): echo is EchoInstance => echo != null)
    .map((echo) => getEquippedEchoCost(echo))
    .sort((left, right) => right - left)
    .join(' • ')
}

// summarize only recipe costs for main-stat suggestions
export function buildMainStatCostSignature(recipes: MainStatRecipe[]): string {
  return recipes
    .map((recipe) => recipe.cost)
    .sort((left, right) => right - left)
    .join(' • ')
}

// aggregate substats into a display-ready list for random suggestions
export function buildGroupedSubstats(echoes: Array<EchoInstance | null>) {
  const totals = new Map<string, number>()
  for (const echo of echoes) {
    if (!echo) {
      continue
    }

    for (const [key, value] of Object.entries(echo.substats)) {
      totals.set(key, (totals.get(key) ?? 0) + value)
    }
  }

  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key, value]) => ({
      key,
      label: formatStatKeyLabel(key),
      value: formatStatKeyValue(key, value),
    }))
}

// list valid piece counts for a set in random-generation constraints
export function getRandomSetCountOptions(setId: number): number[] {
  const definition = ECHO_SET_DEFS.find((entry) => entry.id === setId)
  if (!definition) {
    return []
  }

  return definition.setMax === 3 ? [3] : [2, 5]
}

// coerce a requested count to the nearest valid set-piece option
export function normalizeRandomSetPreferenceCount(setId: number, count: number): number {
  const options = getRandomSetCountOptions(setId)
  if (options.length === 0) {
    return 0
  }

  const numeric = Number(count)
  if (!Number.isFinite(numeric)) {
    return options[0]
  }

  return options.reduce((closest, current) => (
    Math.abs(current - numeric) < Math.abs(closest - numeric) ? current : closest
  ))
}

// sanitize random-set preferences down to the supported two-set constraint model
export function trimRandomSetPreferences(
  preferences: RandomGeneratorSetPreference[],
): RandomGeneratorSetPreference[] {
  let next = preferences
    .filter((entry, index, array) => (
      entry.count > 0 &&
      getRandomSetCountOptions(entry.setId).length > 0 &&
      array.findIndex((candidate) => candidate.setId === entry.setId) === index
    ))
    .map((entry) => ({
      setId: entry.setId,
      count: normalizeRandomSetPreferenceCount(entry.setId, entry.count),
    }))

  if (next.length > 2) {
    next = next.slice(0, 2)
  }

  let total = next.reduce((sum, entry) => sum + entry.count, 0)
  while (total > 5 && next.length > 0) {
    next = next.slice(0, -1)
    total = next.reduce((sum, entry) => sum + entry.count, 0)
  }

  return next
}
