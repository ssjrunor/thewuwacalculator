/*
  Author: Runor Ewhro
  Description: shared suggestions view helpers for signatures, diff labels,
               random-set normalization, and echo preview summaries.
*/

import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { cloneSntSet, type SntSetConds } from '@/domain/entities/sonataSetConditionals.ts'
import type { RandGnrtSets, RandGnrtSetP, WeaponPlanSet } from '@/domain/entities/suggestions.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects.ts'
import { runtimeSig } from '@/domain/state/runtimeSignature.ts'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat-suggestion/utils.ts'
import { formatCompactNum, formatStatKeyLabel, formatStatKeyValue } from '@/modules/calculator/model/statsView.ts'
import { getQppdEchoC, sortByCost } from '@/modules/calculator/features/echoes/lib/echoes.ts'

export type { SuggsViewMod } from '@/domain/entities/suggestions.ts'
export { runtimeSig } from '@/domain/state/runtimeSignature.ts'

export const ROT_TGT_VL = '__rotation__'

export const DEFRANDSETS: RandGnrtSets = {
  bias: 0.5,
  rollQuality: 0.3,
  targetEnergyRegen: 0,
  setPreferences: [],
  mainEchoId: null,
}

export const DEFWPNSETS: WeaponPlanSet = {
  mode: 'both',
  target: 'max',
  ranks: {
    '5': 1,
    '4': 5,
    '3': 5,
    '2': 5,
    '1': 5,
  },
  stdRank: 1,
  visible: {
    '5': true,
    '4': true,
    '3': false,
    '2': false,
    '1': false,
  },
  states: {},
}

export const DEFAULT_SUGG = {
  settings: {
    targetFeatureId: null,
    rotationMode: false,
  },
  random: DEFRANDSETS,
} as const

export interface SetPlanSmmrE {
  setId: number
  pieces: number
}

// format a damage total with the calculator's compact number style
export function formatDamage(value: number): string {
  return `${formatCompactNum(value)} dmg`
}

// compare a suggestion against the current baseline
export function percentDiff(damage: number, baseDamage: number): number {
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

// keep the current-entry desc distinct from percentage deltas
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
export function mkEchoFullSi(echoes: Array<EchoInstance | null>): string {
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
export function strnSrtdRcrd(record: Record<string, unknown>): string {
  return Object.entries(record)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => (
      `${key}:${typeof value === 'object' && value != null ? JSON.stringify(value) : String(value)}`
    ))
    .join('||')
}

// serialize enemy settings that affect the suggestion engine
export function mkEnemySig(enemy: EnemyProfile): string {
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
export function memberSig(
  runtimesById: Record<string, ResRuntime>,
): string {
  return Object.entries(runtimesById)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resonatorId, runtime]) => `${resonatorId}:${runtimeSig(runtime)}`)
    .join('##')
}

// serialize random-generator settings for result caching
export function randomSig(settings: RandGnrtSets): string {
  return JSON.stringify({
    bias: settings.bias,
    rollQuality: settings.rollQuality,
    targetEnergyRegen: settings.targetEnergyRegen,
    mainEchoId: settings.mainEchoId,
    setPreferences: [...settings.setPreferences].sort((left, right) => left.setId - right.setId || left.count - right.count),
  })
}

// serialize weapon suggestion settings for result caching
export function wpnSig(settings: WeaponPlanSet): string {
  const states = Object.fromEntries(
      Object.entries(settings.states)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([weaponId, cfg]) => [
            weaponId,
            Object.entries(cfg).sort(([left], [right]) => left.localeCompare(right)),
          ]),
  )

  return JSON.stringify({
    mode: settings.mode,
    target: settings.target,
    ranks: Object.entries(settings.ranks).sort(([left], [right]) => left.localeCompare(right)),
    stdRank: settings.stdRank,
    visible: Object.entries(settings.visible).sort(([left], [right]) => left.localeCompare(right)),
    states,
  })
}

export function setsSig(setConds?: SntSetConds): string {
  if (!setConds) {
    return 'null'
  }

  return JSON.stringify(cloneSntSet(setConds))
}

// build a stable cache/input signature from all direct-suggestion inputs
export function inputSig(options: {
  runtime: ResRuntime
  enemyProfile: EnemyProfile
  prtcRntmById: Record<string, ResRuntime>
  selectedTargets: Record<string, string | null>
  setConds?: SntSetConds
  setStateMode?: 'max' | 'resolved'
  tgtFeatId: string | null
  rotationMode: boolean
  includeEchoAttacks?: boolean
  fixedEchoLoadout?: boolean
}) {
  const {
    enemyProfile,
    prtcRntmById: partRntmById,
    rotationMode,
    runtime,
    selectedTargets,
    setConds: setConds,
    setStateMode = 'max',
    tgtFeatId: trgtFtrId,
    includeEchoAttacks = false,
    fixedEchoLoadout = false,
  } = options

  return JSON.stringify({
    runtime: runtimeSig(runtime),
    enemy: mkEnemySig(enemyProfile),
    participants: memberSig(partRntmById),
    selectedTargetsByOwnerKey: strnSrtdRcrd(selectedTargets),
    setConditionals: setsSig(setConds),
    setStateMode,
    targetFeatureId: trgtFtrId,
    rotationMode,
    includeEchoAttacks,
    fixedEchoLoadout,
  })
}

// order echoes by cost for modal preview displays
export function sortChsForDs(echoes: Array<EchoInstance | null>): EchoInstance[] {
  return sortByCost(echoes)
}

// capture the full recipe layout so identical suggestions can be compared cheaply
export function recipeSig(recipes: MainStatRecipe[]): string {
  return recipes
    .map((recipe) => [
      recipe.cost,
      recipe.primaryKey,
      ECHO_MAIN_STATS[recipe.cost]?.[recipe.primaryKey] ?? 0,
      ECHO_SIDE_STATS[recipe.cost]?.key ?? 'atkFlat',
      ECHO_SIDE_STATS[recipe.cost]?.value ?? 0,
    ].join('::'))
    .sort()
    .join('||')
}

// keep higher-cost recipes first in the ui
export function sortRecipes(recipes: MainStatRecipe[]): MainStatRecipe[] {
  return [...recipes].sort((left, right) => right.cost - left.cost)
}

// derive the currently active set bonuses from equipped echoes
export function smmrCurSetPl(echoes: Array<EchoInstance | null>): SetPlanSmmrE[] {
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
export function setPlnsQl(
  left: SetPlanSmmrE[],
  right: SetPlanSmmrE[],
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
export function mkCostSig(echoes: Array<EchoInstance | null>): string {
  return echoes
    .filter((echo): echo is EchoInstance => echo != null)
    .map((echo) => getQppdEchoC(echo))
    .sort((left, right) => right - left)
    .join(' • ')
}

// summarize only recipe costs for main-stat suggestions
export function costSig(recipes: MainStatRecipe[]): string {
  return recipes
    .map((recipe) => recipe.cost)
    .sort((left, right) => right - left)
    .join(' • ')
}

// aggregate substats into a display-ready list for random suggestions
export function mkGrpdSbst(echoes: Array<EchoInstance | null>) {
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
export function getRandSetCn(setId: number): number[] {
  const definition = ECHO_SET_DEFS.find((entry) => entry.id === setId)
  if (!definition) {
    return []
  }

  if (definition.setMax === 1) {
    return [1]
  }

  return definition.setMax === 3 ? [3] : [2, 5]
}

// coerce a requested count to the nearest valid set-piece option
export function normSetCount(setId: number, count: number): number {
  const options = getRandSetCn(setId)
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

// sanitize random-set preferences down to the supported three-set constraint model
export function trimRandSetP(
  preferences: RandGnrtSetP[],
): RandGnrtSetP[] {
  let next = preferences
    .filter((entry, index, array) => (
      entry.count > 0 &&
      getRandSetCn(entry.setId).length > 0 &&
      array.findIndex((candidate) => candidate.setId === entry.setId) === index
    ))
    .map((entry) => ({
      setId: entry.setId,
      count: normSetCount(entry.setId, entry.count),
    }))

  if (next.length > 3) {
    next = next.slice(0, 3)
  }

  let total = next.reduce((sum, entry) => sum + entry.count, 0)
  while (total > 5 && next.length > 0) {
    next = next.slice(0, -1)
    total = next.reduce((sum, entry) => sum + entry.count, 0)
  }

  return next
}
