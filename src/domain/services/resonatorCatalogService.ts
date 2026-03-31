/*
  Author: Runor Ewhro
  Description: Provides resonator catalog lookup helpers by combining seed,
               generated detail, and game data registry information.
*/

import { getResonatorDetailsById } from '@/data/gameData/resonators/resonatorDataStore'
import type { Resonator } from '@/domain/entities/resonator'
import { getResonatorSeedById, listResonatorSeeds } from '@/domain/services/resonatorSeedService'
import {
  listConditionsForSource,
  listEffectsForSource,
  listFeaturesForSource,
  listOwnersForSource,
  listResonatorRotations,
  listSkillsForSource,
  listStatesForSource,
} from '@/domain/services/gameDataService'

const resonatorGameDataCache = new Map<string, Resonator>()
let resonatorsCache: Resonator[] | null = null

// get full resonator game data by id
export function getResonatorGameDataById(resonatorId: string): Resonator | null {
  const cached = resonatorGameDataCache.get(resonatorId)
  if (cached) {
    return cached
  }

  const catalog = getResonatorSeedById(resonatorId)
  const details = getResonatorDetailsById()[resonatorId]
  if (!catalog || !details) {
    return null
  }

  const sourceSkills = listSkillsForSource('resonator', resonatorId)
  const resonator: Resonator = {
    ...catalog,
    rarity: catalog.rarity ?? 4,
    profile: catalog.profile ?? '',
    sprite: catalog.sprite ?? '',
    traceNodes: catalog.traceNodes ?? details.traceNodes,
    skillsByTab: details.skillsByTab,
    statePanels: details.statePanels,
    inherentSkills: details.inherentSkills,
    resonanceChains: details.resonanceChains,
    descriptionKeywords: details.descriptionKeywords,
    owners: listOwnersForSource('resonator', resonatorId),
    states: listStatesForSource('resonator', resonatorId),
    conditions: listConditionsForSource('resonator', resonatorId),
    effects: listEffectsForSource('resonator', resonatorId),
    features: listFeaturesForSource('resonator', resonatorId),
    rotations: listResonatorRotations(resonatorId),
    skills: sourceSkills,
  }

  resonatorGameDataCache.set(resonatorId, resonator)
  return resonator
}

// get resonator data by id
export function getResonatorById(resonatorId: string): Resonator | null {
  return getResonatorGameDataById(resonatorId)
}

// list all resonators
export function listResonators(): Resonator[] {
  if (resonatorsCache) {
    return resonatorsCache
  }

  resonatorsCache = listResonatorSeeds()
      .map((resonator) => getResonatorGameDataById(resonator.id))
      .filter((resonator): resonator is Resonator => Boolean(resonator))

  return resonatorsCache
}