/*
  Author: Runor Ewhro
  Description: Provides resonator catalog lookup helpers by combining seed,
               generated detail, and game data registry information.
*/

import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import type { Resonator } from '@/domain/entities/resonator'
import { getResSeedBy, listResSds } from '@/domain/services/resonatorSeedService'
import {
  listCondsFor,
  listEffectsFor,
  listFeatsFor,
  listOwnersFor,
  listResRttn,
  listSkillsFor,
  listStatesFor,
} from '@/domain/services/gameDataService'

const resGameDataC = new Map<string, Resonator>()
let rsntCch: Resonator[] | null = null

// get full resonator game data by id
export function getResGameDa(resonatorId: string): Resonator | null {
  const cached = resGameDataC.get(resonatorId)
  if (cached) {
    return cached
  }

  const catalog = getResSeedBy(resonatorId)
  const details = getResDtlsBy()[resonatorId]
  if (!catalog || !details) {
    return null
  }

  const sourceSkills = listSkillsFor('resonator', resonatorId)
  const resonator: Resonator = {
    ...catalog,
    rarity: catalog.rarity ?? 4,
    profile: catalog.profile ?? '',
    sprite: catalog.sprite ?? '',
    spriteFaceX: catalog.spriteFaceX,
    spriteFaceY: catalog.spriteFaceY,
    spriteFaceScale: catalog.spriteFaceScale,
    traceNodes: catalog.traceNodes ?? details.traceNodes,
    skillsByTab: details.skillsByTab,
    stateGraph: details.stateGraph,
    modeGroups: details.modeGroups,
    statePanels: details.statePanels,
    combatStates: details.combatStates,
    inherentSkills: details.inherentSkills,
    outroSkills: details.outroSkills,
    resonanceChains: details.resonanceChains,
    descriptionKeywords: details.descriptionKeywords,
    negativeEffectSources: details.negativeEffectSources,
    owners: listOwnersFor('resonator', resonatorId),
    states: listStatesFor('resonator', resonatorId),
    conditions: listCondsFor('resonator', resonatorId),
    effects: listEffectsFor('resonator', resonatorId),
    features: listFeatsFor('resonator', resonatorId),
    rotations: listResRttn(resonatorId),
    skills: sourceSkills,
  }

  resGameDataC.set(resonatorId, resonator)
  return resonator
}

// get resonator data by id
export function getResById(resonatorId: string): Resonator | null {
  return getResGameDa(resonatorId)
}

// list all resonators
export function listRsnt(): Resonator[] {
  if (rsntCch) {
    return rsntCch
  }

  rsntCch = listResSds()
      .map((resonator) => getResGameDa(resonator.id))
      .filter((resonator): resonator is Resonator => Boolean(resonator))

  return rsntCch
}
