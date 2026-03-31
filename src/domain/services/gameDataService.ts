/*
  Author: Runor Ewhro
  Description: Provides convenient game data service helpers for listing
               skills, effects, states, owners, features, rotations, and sources.
*/

import { getGameData } from '@/data/gameData'
import {
  getSourceOwnerByKey,
  getStateByControlKey,
  getResonatorFeatures,
  getResonatorRotations,
  listConditionsByOwnerKey,
  listSourceConditions,
  listSourceEffects,
  listSourceFeatures,
  listSourceOwners,
  listSourceRotations,
  listSourceSkills,
  listSourceStates,
  listEffectsByOwnerKey,
  listStatesByOwnerKey,
} from '@/domain/gameData/registry'
import type {
  ConditionDefinition,
  DataSourceRef,
  DataSourceType,
  EffectDefinition,
  FeatureDefinition,
  RotationDefinition,
  SourceOwnerDefinition,
  SourceStateDefinition,
} from '@/domain/gameData/contracts'
import type { SkillDefinition } from '@/domain/entities/stats'

// list all skills for a given source
export function listSkillsForSource(
    sourceType: DataSourceType,
    sourceId: string,
): SkillDefinition[] {
  return listSourceSkills(getGameData(), {
    type: sourceType,
    id: sourceId,
  })
}

// list effects for a given source, optionally filtered by trigger
export function listEffectsForSource(
    sourceType: DataSourceType,
    sourceId: string,
    trigger?: EffectDefinition['trigger'],
): EffectDefinition[] {
  return listSourceEffects(
      getGameData(),
      {
        type: sourceType,
        id: sourceId,
      },
      trigger,
  )
}

// list conditions for a given source
export function listConditionsForSource(
    sourceType: DataSourceType,
    sourceId: string,
): ConditionDefinition[] {
  return listSourceConditions(getGameData(), {
    type: sourceType,
    id: sourceId,
  })
}

// list states for a given source
export function listStatesForSource(
    sourceType: DataSourceType,
    sourceId: string,
): SourceStateDefinition[] {
  return listSourceStates(getGameData(), {
    type: sourceType,
    id: sourceId,
  })
}

// list owners for a given source
export function listOwnersForSource(
    sourceType: DataSourceType,
    sourceId: string,
): SourceOwnerDefinition[] {
  return listSourceOwners(getGameData(), {
    type: sourceType,
    id: sourceId,
  })
}

// list features for a given source
export function listFeaturesForSource(
    sourceType: DataSourceType,
    sourceId: string,
): FeatureDefinition[] {
  return listSourceFeatures(getGameData(), {
    type: sourceType,
    id: sourceId,
  })
}

// list rotations for a given source
export function listRotationsForSource(
    sourceType: DataSourceType,
    sourceId: string,
): RotationDefinition[] {
  return listSourceRotations(getGameData(), {
    type: sourceType,
    id: sourceId,
  })
}

// list all features for a resonator
export function listResonatorFeatures(resonatorId: string): FeatureDefinition[] {
  return getResonatorFeatures(getGameData(), resonatorId)
}

// list all rotations for a resonator
export function listResonatorRotations(resonatorId: string): RotationDefinition[] {
  return getResonatorRotations(getGameData(), resonatorId)
}

// get an owner definition by owner key
export function getOwnerForKey(ownerKey: string): SourceOwnerDefinition | null {
  return getSourceOwnerByKey(getGameData(), ownerKey)
}

// list effects for an owner key
export function listEffectsForOwnerKey(ownerKey: string): EffectDefinition[] {
  return listEffectsByOwnerKey(getGameData(), ownerKey)
}

// list states for an owner key
export function listStatesForOwnerKey(ownerKey: string): SourceStateDefinition[] {
  return listStatesByOwnerKey(getGameData(), ownerKey)
}

// get a state definition by control key
export function getStateForControlKey(controlKey: string): SourceStateDefinition | null {
  return getStateByControlKey(getGameData(), controlKey)
}

// list conditions for an owner key
export function listConditionsForOwnerKey(ownerKey: string): ConditionDefinition[] {
  return listConditionsByOwnerKey(getGameData(), ownerKey)
}

// list all registered sources, optionally filtered by type
export function listSources(sourceType?: DataSourceType): DataSourceRef[] {
  const gameData = getGameData()

  return Object.values(gameData.sourcesByKey)
      .filter((source) => !sourceType || source.source.type === sourceType)
      .map((source) => source.source)
}