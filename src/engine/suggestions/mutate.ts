/*
  Author: Runor Ewhro
  Description: Builds, mutates, and validates suggestion echo loadouts,
               including main-stat filtering, set-plan application,
               random loadout generation, and Energy Regen injection.
*/

import type { EchoDefinition } from '@/domain/entities/catalog'
import type { RandomGeneratorSetPreference } from '@/domain/entities/suggestions'
import type { EchoInstance } from '@/domain/entities/runtime'
import { createEchoUid } from '@/domain/entities/runtime'
import { getEchoById, getEchoSets, listEchoes, listEchoesByCost } from '@/domain/services/echoCatalogService'
import {
  ECHO_PRIMARY_STATS,
  ECHO_SECONDARY_STATS,
  ECHO_SUBSTAT_KEYS,
  getSubstatStepOptions,
} from '@/data/gameData/catalog/echoStats'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import type { OptimizerStatWeightMap } from '@/engine/optimizer/rebuild/filter'
import type { SetPlanEntry } from '@/engine/suggestions/types'
import { getRandomSubstat, randomSubValue } from '@/engine/suggestions/randomEchoes/lib/substats'
import { MAIN_STAT_FILTER_ORDER } from '@/engine/suggestions/MAIN_STAT_FILTER_ORDER.ts'

// elemental bonus main stats are handled as a grouped "bonus" filter,
// but we still need to know the individual keys when resolving the best one.
const ELEMENT_KEYS = new Set(['aero', 'glacio', 'fusion', 'spectro', 'havoc', 'electro'])

// 3-piece sets behave differently from normal 2/5-piece sets when checking
// whether accidental extra set activations need to be broken up.
const THREE_PIECE_SET_IDS = new Set(
    ECHO_SET_DEFS.filter((entry) => entry.setMax === 3).map((entry) => entry.id),
)

// cached copy of valid substat keys used for randomized substat generation
const RANDOM_SUBSTAT_KEYS = [...ECHO_SUBSTAT_KEYS]

export type SuggestionMainStatFilterKey = (typeof MAIN_STAT_FILTER_ORDER)[number]

export interface SuggestionMainStatConfig {
  allowedFilters: Set<SuggestionMainStatFilterKey>
  selectedBonus: string | null
}

// resolve the catalog cost for a runtime echo instance
function getEchoCost(echo: EchoInstance | null | undefined): number | null {
  if (!echo) {
    return null
  }

  return getEchoById(echo.id)?.cost ?? null
}

// clone an echo and assign a fresh uid so suggestion outputs remain distinct
function cloneEchoWithUid(echo: EchoInstance, slotIndex: number): EchoInstance {
  return {
    uid: createEchoUid(),
    id: echo.id,
    set: echo.set,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: { ...echo.mainStats.primary },
      secondary: { ...echo.mainStats.secondary },
    },
    substats: { ...echo.substats },
  }
}

// build a brand-new echo instance from a catalog definition,
// while allowing the caller to force set, primary stat, and substats
function createEchoInstanceFromDefinition(
    definition: EchoDefinition,
    options: {
      slotIndex: number
      setId?: number | null
      primaryKey: string
      substats?: Record<string, number>
    },
): EchoInstance {
  const secondary = ECHO_SECONDARY_STATS[definition.cost]

  return {
    uid: createEchoUid(),
    id: definition.id,
    set: options.setId && definition.sets.includes(options.setId)
        ? options.setId
        : definition.sets[0] ?? 0,
    mainEcho: options.slotIndex === 0,
    mainStats: {
      primary: {
        key: options.primaryKey,
        value: ECHO_PRIMARY_STATS[definition.cost]?.[options.primaryKey] ?? 0,
      },
      secondary: {
        key: secondary?.key ?? 'atkFlat',
        value: secondary?.value ?? 0,
      },
    },
    substats: { ...(options.substats ?? {}) },
  }
}

// generic weighted random picker with a tiny minimum floor on weights
// so candidates with near-zero priority still remain possible.
function weightedRandomPick<T>(
    items: T[],
    getWeight: (item: T) => number,
): T {
  if (items.length === 0) {
    throw new Error('Cannot pick from an empty collection')
  }

  const weights = items.map((item) => Math.max(0.0001, getWeight(item)))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)

  let roll = Math.random() * totalWeight
  for (let index = 0; index < items.length; index += 1) {
    roll -= weights[index]
    if (roll <= 0) {
      return items[index]
    }
  }

  return items[items.length - 1]
}

// convert internal stat keys into main-stat filter labels
function mapWeightKeyToFilterKey(
    key: string,
): SuggestionMainStatFilterKey | null {
  if (key === 'atkPercent') return 'atk%'
  if (key === 'hpPercent') return 'hp%'
  if (key === 'defPercent') return 'def%'
  if (key === 'energyRegen') return 'er'
  if (key === 'critRate') return 'cr'
  if (key === 'critDmg') return 'cd'
  if (key === 'healingBonus') return 'healing'
  if (ELEMENT_KEYS.has(key)) return 'bonus'
  return null
}

// derive the allowed main-stat filter set from optimizer weights.
// elemental bonuses are collapsed into a single filter, but the strongest
// element is still remembered so later picks can favor the correct one.
export function deriveSuggestionMainStatConfig(
    weights: OptimizerStatWeightMap,
    resonatorId: string,
): SuggestionMainStatConfig {
  const allowedFilters = new Set<SuggestionMainStatFilterKey>()
  let selectedBonus: string | null = null
  let bestBonusWeight = 0

  for (const [key, value] of Object.entries(weights)) {
    if ((value ?? 0) <= 0) {
      continue
    }

    const filterKey = mapWeightKeyToFilterKey(key)
    if (filterKey) {
      allowedFilters.add(filterKey)
    }

    // among all element bonus keys, keep the one with the largest weight
    if (ELEMENT_KEYS.has(key) && (value ?? 0) > bestBonusWeight) {
      bestBonusWeight = value ?? 0
      selectedBonus = key
    }
  }

  // special-case characters that often want ER in the option pool
  const numericId = Number.parseInt(resonatorId, 10)
  if (numericId === 1206 || numericId === 1209 || numericId === 1412) {
    allowedFilters.add('er')
  }

  return {
    allowedFilters,
    selectedBonus,
  }
}

// build the valid primary main-stat choices for a given echo cost,
// filtered by the current suggestion config if one exists.
export function buildMainStatOptionsForCost(
    cost: number,
    config: SuggestionMainStatConfig,
): Array<{ key: string; value: number }> {
  const valid = ECHO_PRIMARY_STATS[cost] ?? {}
  const entries = Object.entries(valid)

  // no filter means every valid main stat for this cost is allowed
  if (config.allowedFilters.size === 0) {
    return entries.map(([key, value]) => ({ key, value }))
  }

  const filtered = entries.filter(([key]) => {
    const filterKey = mapWeightKeyToFilterKey(key)
    if (!filterKey || !config.allowedFilters.has(filterKey)) {
      return false
    }

    // when bonus is selected, only keep the strongest chosen element
    if (filterKey === 'bonus' && config.selectedBonus) {
      return key === config.selectedBonus
    }

    return true
  })

  // if filtering becomes too strict, fall back to all valid options
  return (filtered.length > 0 ? filtered : entries).map(([key, value]) => ({ key, value }))
}

// apply a chosen primary main-stat layout onto already-equipped echoes
// while preserving their identities, sets, and substats where possible.
export function applyMainStatChoicesToEchoes(
    equippedEchoes: Array<EchoInstance | null>,
    primaryKeysBySlot: Array<string | null>,
): Array<EchoInstance | null> {
  return equippedEchoes.map((echo, slotIndex) => {
    if (!echo) {
      return null
    }

    const key = primaryKeysBySlot[slotIndex]
    if (!key) {
      return cloneEchoWithUid(echo, slotIndex)
    }

    const definition = getEchoById(echo.id)
    const cost = definition?.cost ?? getEchoCost(echo)
    if (!cost) {
      return cloneEchoWithUid(echo, slotIndex)
    }

    return {
      ...cloneEchoWithUid(echo, slotIndex),
      mainStats: {
        primary: {
          key,
          value: ECHO_PRIMARY_STATS[cost]?.[key] ?? echo.mainStats.primary.value,
        },
        secondary: {
          ...ECHO_SECONDARY_STATS[cost],
        },
      },
    }
  })
}

// expand a compact set plan like [{setId: 4, pieces: 2}] into a slot-aligned
// list of target set ids, attempting to keep the main echo inside a compatible
// planned set whenever possible.
function expandSetPlanToSlots(
    setPlan: SetPlanEntry[],
    equippedEchoes: Array<EchoInstance | null>,
    mainIndex = 0,
): Array<number | null> {
  const targets = new Array<number | null>(equippedEchoes.length).fill(null)
  if (setPlan.length === 0) {
    return targets
  }

  // flatten the requested piece counts into a simple ordered pool
  const pieces: number[] = []
  for (const entry of setPlan) {
    for (let index = 0; index < Math.max(0, entry.pieces); index += 1) {
      pieces.push(entry.setId)
    }
  }

  if (pieces.length === 0) {
    return targets
  }

  const nonNullSlots = equippedEchoes
      .map((echo, index) => (echo ? index : -1))
      .filter((index) => index >= 0)

  if (nonNullSlots.length === 0) {
    return targets
  }

  const mainEcho = equippedEchoes[mainIndex]
  const mainSet = mainEcho?.set ?? null

  // if the main echo can naturally support one of the requested sets,
  // try to reserve that set for slot 0 first.
  const mainSupportedPlanSet = setPlan.find((entry) => (
      mainEcho && getEchoSets(mainEcho.id).includes(entry.setId) && entry.pieces > 0
  ))?.setId ?? null

  const mainIsInPlan = mainSet != null && setPlan.some((entry) => entry.setId === mainSet)

  // if the main set is already part of the plan, or the plan fills all slots,
  // the main echo must be included in the final assignment.
  const mustUseMain = mainIsInPlan || pieces.length >= nonNullSlots.length
  const remainingPieces = [...pieces]
  const preferredIndices: number[] = []

  if (mustUseMain && nonNullSlots.includes(mainIndex)) {
    preferredIndices.push(mainIndex)

    if (mainSupportedPlanSet != null) {
      const removeIndex = remainingPieces.indexOf(mainSupportedPlanSet)
      if (removeIndex >= 0) {
        targets[mainIndex] = mainSupportedPlanSet
        remainingPieces.splice(removeIndex, 1)
      }
    }
  }

  // after slot 0, fill remaining live slots in order
  for (const index of nonNullSlots) {
    if (index !== mainIndex) {
      preferredIndices.push(index)
    }
  }

  let pieceIndex = 0
  for (const slotIndex of preferredIndices) {
    if (targets[slotIndex] != null) {
      continue
    }
    if (pieceIndex >= remainingPieces.length) {
      break
    }

    targets[slotIndex] = remainingPieces[pieceIndex]
    pieceIndex += 1
  }

  return targets
}

// choose a replacement echo definition that matches both set and cost if possible
function pickTemplateDefinitionForSet(
    setId: number,
    cost: number | null,
    usedIds: Set<string>,
): EchoDefinition | null {
  const candidates = (cost ? listEchoesByCost(cost) : listEchoes())
      .filter((entry) => entry.sets.includes(setId))

  const unused = candidates.filter((entry) => !usedIds.has(entry.id))
  const pool = unused.length > 0 ? unused : candidates

  return pool[0] ?? null
}

// choose a replacement echo definition that avoids activating forbidden sets
function pickReplacementDefinition(
    cost: number | null,
    avoidSetIds: Set<number>,
    usedIds: Set<string>,
): EchoDefinition | null {
  const candidates = (cost ? listEchoesByCost(cost) : listEchoes())
      .filter((entry) => entry.sets.every((setId) => !avoidSetIds.has(setId)))

  const unused = candidates.filter((entry) => !usedIds.has(entry.id))
  const pool = unused.length > 0 ? unused : candidates

  return pool[0] ?? null
}

// after applying a plan, remove accidental over-activation of planned or unplanned sets
function normalizeSetSelections(
    echoes: Array<EchoInstance | null>,
    setPlan: SetPlanEntry[],
    usedIds: Set<string>,
): Array<EchoInstance | null> {
  const planCounts = new Map(setPlan.map((entry) => [entry.setId, entry.pieces]))
  const result = echoes.map((echo, slotIndex) => (
      echo ? cloneEchoWithUid(echo, slotIndex) : null
  ))

  const countIndicesBySet = () => {
    const setMap = new Map<number, number[]>()

    result.forEach((echo, index) => {
      if (!echo) {
        return
      }

      const indices = setMap.get(echo.set) ?? []
      indices.push(index)
      setMap.set(echo.set, indices)
    })

    return setMap
  }

  // replace one echo in a problematic set with a same-cost echo
  // that avoids all currently planned sets plus the set being broken.
  const replaceAtIndex = (setIdToBreak: number, index: number) => {
    const original = result[index]
    if (!original) {
      return
    }

    const replacementDef = pickReplacementDefinition(
        getEchoCost(original),
        new Set([...planCounts.keys(), setIdToBreak]),
        usedIds,
    )

    if (!replacementDef) {
      return
    }

    usedIds.add(replacementDef.id)

    result[index] = {
      ...createEchoInstanceFromDefinition(replacementDef, {
        slotIndex: index,
        setId: replacementDef.sets[0] ?? 0,
        primaryKey: original.mainStats.primary.key,
        substats: original.substats,
      }),
      mainStats: {
        primary: { ...original.mainStats.primary },
        secondary: { ...original.mainStats.secondary },
      },
    }
  }

  let counts = countIndicesBySet()

  // first enforce exact or capped counts for sets explicitly in the plan
  for (const [setId, desired] of planCounts.entries()) {
    const indices = counts.get(setId) ?? []
    if (indices.length <= desired) {
      continue
    }

    let toRemove = indices.length - desired

    // prefer replacing non-main slots first
    for (const index of [...indices].sort((left, right) => Number(left === 0) - Number(right === 0))) {
      if (toRemove <= 0) {
        break
      }

      if (index === 0 && indices.length > 1) {
        continue
      }

      replaceAtIndex(setId, index)
      toRemove -= 1
    }
  }

  counts = countIndicesBySet()

  // then break any accidental set activation for sets not in the plan
  for (const [setId, indices] of counts.entries()) {
    if (planCounts.has(setId)) {
      continue
    }

    const threshold = THREE_PIECE_SET_IDS.has(setId) ? 3 : 2
    const allowedMax = threshold - 1

    if (indices.length <= allowedMax) {
      continue
    }

    let toFix = indices.length - allowedMax

    for (const index of [...indices].sort((left, right) => Number(left === 0) - Number(right === 0))) {
      if (toFix <= 0) {
        break
      }

      if (index === 0 && indices.length > 1) {
        continue
      }

      replaceAtIndex(setId, index)
      toFix -= 1
    }
  }

  return result
}

// apply a set plan onto the current equipped echoes, preserving
// originals when compatible and swapping in matching templates when needed.
export function applySetPlanToEchoes(
    setPlan: SetPlanEntry[],
    equippedEchoes: Array<EchoInstance | null>,
): Array<EchoInstance | null> {
  const targetSets = expandSetPlanToSlots(setPlan, equippedEchoes)
  const usedIds = new Set<string>()
  const result: Array<EchoInstance | null> = []

  for (let slotIndex = 0; slotIndex < equippedEchoes.length; slotIndex += 1) {
    const original = equippedEchoes[slotIndex]
    const targetSet = targetSets[slotIndex]

    if (!original) {
      result.push(null)
      continue
    }

    // no set assignment for this slot means keep the original echo body
    if (targetSet == null) {
      result.push(cloneEchoWithUid(original, slotIndex))
      usedIds.add(original.id)
      continue
    }

    const originalSets = getEchoSets(original.id)

    // if the original echo already supports the target set and hasn't been reused,
    // keep it and just rewrite the active set id.
    if (originalSets.includes(targetSet) && !usedIds.has(original.id)) {
      result.push({
        ...cloneEchoWithUid(original, slotIndex),
        set: targetSet,
      })
      usedIds.add(original.id)
      continue
    }

    // otherwise swap in a compatible template of the same cost if possible
    const replacementDef = pickTemplateDefinitionForSet(targetSet, getEchoCost(original), usedIds)
    if (!replacementDef) {
      // final fallback: keep the original echo and force the set id anyway
      result.push({
        ...cloneEchoWithUid(original, slotIndex),
        set: targetSet,
      })
      continue
    }

    usedIds.add(replacementDef.id)
    result.push({
      ...createEchoInstanceFromDefinition(replacementDef, {
        slotIndex,
        setId: targetSet,
        primaryKey: original.mainStats.primary.key,
        substats: original.substats,
      }),
      mainStats: {
        primary: { ...original.mainStats.primary },
        secondary: { ...original.mainStats.secondary },
      },
    })
  }

  return normalizeSetSelections(result, setPlan, usedIds)
}

// verify whether a set plan can actually be realized on the current
// slot-count and catalog/cost constraints.
export function isSetPlanFeasible(
    setPlan: SetPlanEntry[],
    equippedEchoes: Array<EchoInstance | null>,
): boolean {
  if (setPlan.length === 0) {
    return false
  }

  const slots = Array.isArray(equippedEchoes) ? equippedEchoes : []
  const slotCount = slots.length
  if (slotCount === 0) {
    return false
  }

  const totalPieces = setPlan.reduce((sum, entry) => sum + Math.max(0, entry.pieces), 0)
  if (totalPieces > slotCount) {
    return false
  }

  // count how many slots of each cost are currently available
  const slotsByCost = new Map<number, number>()
  for (const echo of slots) {
    const cost = getEchoCost(echo)
    if (!cost) {
      continue
    }
    slotsByCost.set(cost, (slotsByCost.get(cost) ?? 0) + 1)
  }

  // for each set id and cost, collect all distinct echo ids that could satisfy it
  const availableBySetAndCost = new Map<number, Map<number, Set<string>>>()

  const addEchoSource = (entries: Array<EchoInstance | EchoDefinition | null>) => {
    for (const entry of entries) {
      if (!entry) {
        continue
      }

      const cost = 'cost' in entry ? entry.cost : (getEchoById(entry.id)?.cost ?? 0)
      if (!cost) {
        continue
      }

      const sets = 'sets' in entry ? entry.sets : getEchoSets(entry.id)

      for (const setId of sets) {
        const byCost = availableBySetAndCost.get(setId) ?? new Map<number, Set<string>>()
        const ids = byCost.get(cost) ?? new Set<string>()
        ids.add(entry.id)
        byCost.set(cost, ids)
        availableBySetAndCost.set(setId, byCost)
      }
    }
  }

  // include both equipped echoes and full catalog availability
  addEchoSource(slots)
  addEchoSource(listEchoes())

  // each requested set must have enough distinct capacity across matching costs
  for (const entry of setPlan) {
    const costMap = availableBySetAndCost.get(entry.setId)
    if (!costMap) {
      return false
    }

    let capacity = 0
    for (const [cost, ids] of costMap.entries()) {
      capacity += Math.min(slotsByCost.get(cost) ?? 0, ids.size)
    }

    if (capacity < entry.pieces) {
      return false
    }
  }

  return true
}

// enumerate all simple set-plan candidates allowed by the current slot count
export function buildSetPlanCandidates(slotCount: number): SetPlanEntry[][] {
  const fivePieceSetIds = ECHO_SET_DEFS
      .filter((entry) => entry.setMax === 5)
      .map((entry) => entry.id)

  const threePieceSetIds = ECHO_SET_DEFS
      .filter((entry) => entry.setMax === 3)
      .map((entry) => entry.id)

  const plans: SetPlanEntry[][] = []

  // standalone 2pc / 5pc plans
  for (const setId of fivePieceSetIds) {
    if (slotCount >= 2) {
      plans.push([{ setId, pieces: 2 }])
    }
    if (slotCount >= 5) {
      plans.push([{ setId, pieces: 5 }])
    }
  }

  // standalone 3pc plans
  for (const setId of threePieceSetIds) {
    if (slotCount >= 3) {
      plans.push([{ setId, pieces: 3 }])
    }
  }

  // two different 2pc plans
  for (let left = 0; left < fivePieceSetIds.length; left += 1) {
    for (let right = left + 1; right < fivePieceSetIds.length; right += 1) {
      if (slotCount >= 4) {
        plans.push([
          { setId: fivePieceSetIds[left], pieces: 2 },
          { setId: fivePieceSetIds[right], pieces: 2 },
        ])
      }
    }
  }

  // mixed 2pc + 3pc plans
  for (const fiveSetId of fivePieceSetIds) {
    for (const threeSetId of threePieceSetIds) {
      if (slotCount >= 5) {
        plans.push([
          { setId: fiveSetId, pieces: 2 },
          { setId: threeSetId, pieces: 3 },
        ])
      }
    }
  }

  return plans
}

// expand random set preferences into a slot-aligned target set list,
// again preferring to keep the requested main echo compatible with slot 0.
function buildRandomSetTargets(
    slotCount: number,
    mainEchoDefinition: EchoDefinition | null,
    preferences: RandomGeneratorSetPreference[],
): Array<number | null> {
  const targets = new Array<number | null>(slotCount).fill(null)

  const pieces = preferences
      .filter((entry) => entry.count > 0)
      .flatMap((entry) => Array.from({ length: entry.count }, () => entry.setId))

  if (pieces.length === 0) {
    return targets
  }

  // reserve a compatible preferred set for the main echo when possible
  if (mainEchoDefinition) {
    const preferredMainSet = pieces.find((setId) => mainEchoDefinition.sets.includes(setId))
    if (preferredMainSet != null) {
      targets[0] = preferredMainSet
      pieces.splice(pieces.indexOf(preferredMainSet), 1)
    }
  }

  let pieceIndex = 0
  for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
    if (targets[slotIndex] != null) {
      continue
    }
    if (pieceIndex >= pieces.length) {
      break
    }

    targets[slotIndex] = pieces[pieceIndex]
    pieceIndex += 1
  }

  return targets
}

// choose a primary key from allowed options using optimizer weights,
// while heavily de-prioritizing non-selected elemental bonus stats.
function buildWeightedPrimaryKeyPicker(
    options: Array<{ key: string; value: number }>,
    weights: OptimizerStatWeightMap,
    selectedBonus: string | null,
): string {
  return weightedRandomPick(options, ({ key }) => {
    if (ELEMENT_KEYS.has(key) && selectedBonus && key !== selectedBonus) {
      return 0.01
    }

    return (weights[key] ?? 0) + 0.05
  }).key
}

// build one randomized set of up to five unique substats
function buildRandomSubstats(
    weights: OptimizerStatWeightMap,
    rollQuality: number,
    bias: number,
): Record<string, number> {
  const substats: Record<string, number> = {}

  while (
      Object.keys(substats).length < RANDOM_SUBSTAT_KEYS.length &&
      Object.keys(substats).length < 5
      ) {
    const key = getRandomSubstat(bias, false, weights)

    if (!substats[key]) {
      substats[key] = randomSubValue(key, rollQuality)
    }
  }

  return substats
}

// simple weighted substat score used when deciding what ER should replace
function getSubstatScore(
    key: string,
    value: number,
    weights: OptimizerStatWeightMap,
): number {
  return (weights[key] ?? 0) * value
}

// choose an ER split across echoes that minimally exceeds the remaining target
function findBestEnergyRegenSplit(target: number, rollQuality: number, maxEchoes: number): number[] {
  const options = getSubstatStepOptions('energyRegen')

  if (target <= 0 || options.length === 0) {
    return new Array(maxEchoes).fill(0)
  }

  // narrow search around the requested roll quality
  const targetIndex = Math.round(
      Math.max(0, Math.min(1, rollQuality)) * Math.max(0, options.length - 1),
  )

  const narrowed = options.slice(
      Math.max(0, targetIndex - 1),
      Math.min(options.length, targetIndex + 2),
  )

  let bestSum = Number.POSITIVE_INFINITY
  let bestCombo = new Array(maxEchoes).fill(0)

  const stack: Array<{ combo: number[]; sum: number }> = [{ combo: [], sum: 0 }]
  const maxValue = narrowed[narrowed.length - 1] ?? 0

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    if (current.sum >= target) {
      if (current.sum < bestSum) {
        bestSum = current.sum
        bestCombo = [...current.combo, ...new Array(maxEchoes - current.combo.length).fill(0)]
      }
      continue
    }

    if (current.combo.length >= maxEchoes) {
      continue
    }

    const remainingSlots = maxEchoes - current.combo.length

    // prune paths that can no longer hit the target even with max rolls
    if (current.sum + (remainingSlots * maxValue) < target) {
      continue
    }

    for (const value of narrowed) {
      if (current.sum + value >= bestSum) {
        continue
      }

      stack.push({
        combo: [...current.combo, value],
        sum: current.sum + value,
      })
    }
  }

  return bestCombo
}

// inject enough ER into the generated loadout to satisfy the target,
// replacing the weakest substat when necessary.
function injectEnergyRegen(
    echoes: Array<EchoInstance | null>,
    targetEnergyRegen: number,
    rollQuality: number,
    weights: OptimizerStatWeightMap,
): Array<EchoInstance | null> {
  if (targetEnergyRegen <= 0) {
    return echoes
  }

  const existingEnergyRegen = echoes.reduce((sum, echo) => (
      echo
          ? sum
          + (echo.mainStats.primary.key === 'energyRegen' ? echo.mainStats.primary.value : 0)
          + (echo.substats.energyRegen ?? 0)
          : sum
  ), 0)

  const remainingTarget = Math.max(0, targetEnergyRegen - existingEnergyRegen)
  if (remainingTarget <= 0) {
    return echoes
  }

  const erPlan = findBestEnergyRegenSplit(remainingTarget, rollQuality, echoes.length)

  return echoes.map((echo, slotIndex) => {
    if (!echo) {
      return null
    }

    const erValue = erPlan[slotIndex] ?? 0
    if (erValue <= 0) {
      return cloneEchoWithUid(echo, slotIndex)
    }

    const next = cloneEchoWithUid(echo, slotIndex)

    // overwrite existing ER if already present
    if ('energyRegen' in next.substats) {
      next.substats.energyRegen = erValue
      return next
    }

    // add ER directly if there is still substat space
    if (Object.keys(next.substats).length < 5) {
      next.substats.energyRegen = erValue
      return next
    }

    // otherwise replace the current weakest substat
    let worstKey: string | null = null
    let worstScore = Number.POSITIVE_INFINITY

    for (const [key, value] of Object.entries(next.substats)) {
      const score = getSubstatScore(key, value, weights)
      if (score < worstScore) {
        worstScore = score
        worstKey = key
      }
    }

    if (worstKey) {
      delete next.substats[worstKey]
    }

    next.substats.energyRegen = erValue
    return next
  })
}

// build a fully randomized echo loadout from a fixed cost plan and weighted config.
// the result respects preferred main echo, set preferences, main-stat filters,
// random substats, and optional ER injection.
export function buildRandomEchoLoadout(params: {
  costPlan: readonly number[]
  weights: OptimizerStatWeightMap
  mainStatConfig: SuggestionMainStatConfig
  bias: number
  targetEnergyRegen: number
  rollQuality: number
  mainEchoId: string | null
  setPreferences: RandomGeneratorSetPreference[]
  fixedPrimaryKeys?: readonly string[]
}): Array<EchoInstance | null> {
  const {
    costPlan,
    weights,
    mainStatConfig,
    bias,
    targetEnergyRegen,
    rollQuality,
    mainEchoId,
    setPreferences,
    fixedPrimaryKeys,
  } = params

  const mainEchoDefinition = mainEchoId ? getEchoById(mainEchoId) : null
  const targetSets = buildRandomSetTargets(costPlan.length, mainEchoDefinition, setPreferences)

  const usedIds = new Set<string>()
  const echoes: Array<EchoInstance | null> = []

  for (let slotIndex = 0; slotIndex < costPlan.length; slotIndex += 1) {
    const cost = costPlan[slotIndex]
    const targetSet = targetSets[slotIndex]

    // slot 0 can be forced to use the requested main echo if costs line up
    const candidates = (
        slotIndex === 0 &&
        mainEchoDefinition &&
        mainEchoDefinition.cost === cost
    )
        ? [mainEchoDefinition]
        : listEchoesByCost(cost).filter((entry) => !usedIds.has(entry.id))

    const bySet = targetSet != null
        ? candidates.filter((entry) => entry.sets.includes(targetSet))
        : candidates

    const pool = bySet.length > 0 ? bySet : candidates

    const definition = weightedRandomPick(
        pool.length > 0 ? pool : listEchoesByCost(cost),
        (entry) => (targetSet != null && entry.sets.includes(targetSet) ? 4 : 1),
    )

    usedIds.add(definition.id)

    const fixedPrimaryKey = fixedPrimaryKeys?.[slotIndex]
    const mainStatOptions = buildMainStatOptionsForCost(cost, mainStatConfig)

    // fixed primary keys, when valid, override normal weighted main-stat selection
    const primaryKey = buildWeightedPrimaryKeyPicker(
        fixedPrimaryKey && mainStatOptions.some((option) => option.key === fixedPrimaryKey)
            ? [{ key: fixedPrimaryKey, value: ECHO_PRIMARY_STATS[cost]?.[fixedPrimaryKey] ?? 0 }]
            : mainStatOptions,
        weights,
        mainStatConfig.selectedBonus,
    )

    echoes.push(
        createEchoInstanceFromDefinition(definition, {
          slotIndex,
          setId: targetSet,
          primaryKey,
          substats: buildRandomSubstats(weights, rollQuality, bias),
        }),
    )
  }

  return injectEnergyRegen(echoes, targetEnergyRegen, rollQuality, weights)
}

// build a deterministic signature for only the main-stat layout of a loadout.
// this is useful for deduplication when only cost and main stats matter.
export function buildEchoMainStatLayoutSignature(echoes: Array<EchoInstance | null>): string {
  return echoes
      .filter((echo): echo is EchoInstance => echo != null)
      .map((echo) => [
        getEchoCost(echo) ?? 0,
        echo.mainStats.primary.key,
        echo.mainStats.primary.value,
        echo.mainStats.secondary.key,
        echo.mainStats.secondary.value,
      ].join('::'))
      .sort()
      .join('||')
}