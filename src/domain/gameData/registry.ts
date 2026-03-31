/*
  Author: Runor Ewhro
  Description: Builds and queries the game data registry used to organize
               sources, owners, states, effects, skills, features, and rotations.
*/

import type {
  ConditionDefinition,
  DataSourceRef,
  EffectDefinition,
  FeatureDefinition,
  GameDataRegistry,
  RotationDefinition,
  SourceOwnerDefinition,
  SourcePackage,
  SourceStateDefinition,
} from '@/domain/gameData/contracts'
import type { SkillDefinition } from '@/domain/entities/stats'

const EMPTY_OWNERS: SourceOwnerDefinition[] = []
const EMPTY_EFFECTS: EffectDefinition[] = []
const EMPTY_STATES: SourceStateDefinition[] = []
const EMPTY_CONDITIONS: ConditionDefinition[] = []
const EMPTY_FEATURES: FeatureDefinition[] = []
const EMPTY_ROTATIONS: RotationDefinition[] = []
const EMPTY_SKILLS: SkillDefinition[] = []

// create a stable registry key for a source
export function makeSourceKey(source: DataSourceRef): string {
  return `${source.type}:${source.id}`
}

// build the full game data registry from source packages
export function buildGameDataRegistry(sources: SourcePackage[]): GameDataRegistry {
  const sourcesByKey: Record<string, SourcePackage> = {}
  const ownersBySourceKey: Record<string, SourceOwnerDefinition[]> = {}
  const ownersByKey: Record<string, SourceOwnerDefinition> = {}
  const effectsBySourceKey: Record<string, EffectDefinition[]> = {}
  const effectsByOwnerKey: Record<string, EffectDefinition[]> = {}
  const statesBySourceKey: Record<string, SourceStateDefinition[]> = {}
  const statesByOwnerKey: Record<string, SourceStateDefinition[]> = {}
  const statesByControlKey: Record<string, SourceStateDefinition> = {}
  const conditionsBySourceKey: Record<string, ConditionDefinition[]> = {}
  const conditionsByOwnerKey: Record<string, ConditionDefinition[]> = {}
  const featuresBySourceKey: Record<string, FeatureDefinition[]> = {}
  const rotationsBySourceKey: Record<string, RotationDefinition[]> = {}
  const skillsBySourceKey: Record<string, SkillDefinition[]> = {}
  const resonatorSkillsById: Record<string, SkillDefinition[]> = {}
  const resonatorFeaturesById: Record<string, FeatureDefinition[]> = {}
  const resonatorRotationsById: Record<string, RotationDefinition[]> = {}

  for (const source of sources) {
    const key = makeSourceKey(source.source)

    if (sourcesByKey[key]) {
      throw new Error(`duplicate game-data source: ${key}`)
    }

    sourcesByKey[key] = source
    ownersBySourceKey[key] = source.owners ?? EMPTY_OWNERS
    effectsBySourceKey[key] = source.effects ?? EMPTY_EFFECTS
    statesBySourceKey[key] = source.states ?? EMPTY_STATES
    conditionsBySourceKey[key] = source.conditions ?? EMPTY_CONDITIONS
    featuresBySourceKey[key] = source.features ?? EMPTY_FEATURES
    rotationsBySourceKey[key] = source.rotations ?? EMPTY_ROTATIONS
    skillsBySourceKey[key] = source.skills ?? EMPTY_SKILLS

    if (source.source.type === 'resonator') {
      resonatorSkillsById[source.source.id] = source.skills ?? EMPTY_SKILLS
      resonatorFeaturesById[source.source.id] = source.features ?? EMPTY_FEATURES
      resonatorRotationsById[source.source.id] = source.rotations ?? EMPTY_ROTATIONS
    }
  }

  for (const source of sources) {
    for (const owner of source.owners ?? []) {
      if (ownersByKey[owner.ownerKey]) {
        throw new Error(`duplicate source owner key: ${owner.ownerKey}`)
      }

      ownersByKey[owner.ownerKey] = owner
    }
  }

  for (const source of sources) {
    for (const state of source.states ?? []) {
      if (!ownersByKey[state.ownerKey]) {
        throw new Error(`unknown state owner key: ${state.ownerKey}`)
      }

      if (statesByControlKey[state.controlKey]) {
        throw new Error(`duplicate state control key: ${state.controlKey}`)
      }

      statesByControlKey[state.controlKey] = state
      ;(statesByOwnerKey[state.ownerKey] ??= []).push(state)
    }

    for (const condition of source.conditions ?? []) {
      if (!condition.ownerKey) {
        continue
      }

      if (!ownersByKey[condition.ownerKey]) {
        throw new Error(`unknown condition owner key: ${condition.ownerKey}`)
      }

      ;(conditionsByOwnerKey[condition.ownerKey] ??= []).push(condition)
    }

    for (const effect of source.effects ?? []) {
      if (!effect.ownerKey) {
        continue
      }

      if (!ownersByKey[effect.ownerKey]) {
        throw new Error(`unknown effect owner key: ${effect.ownerKey}`)
      }

      ;(effectsByOwnerKey[effect.ownerKey] ??= []).push(effect)
    }
  }

  return {
    sourcesByKey,
    ownersBySourceKey,
    ownersByKey,
    effectsBySourceKey,
    effectsByOwnerKey,
    statesBySourceKey,
    statesByOwnerKey,
    statesByControlKey,
    conditionsBySourceKey,
    conditionsByOwnerKey,
    featuresBySourceKey,
    rotationsBySourceKey,
    skillsBySourceKey,
    resonatorSkillsById,
    resonatorFeaturesById,
    resonatorRotationsById,
  }
}

// list effects for a source, optionally filtered by trigger
export function listSourceEffects(
    registry: GameDataRegistry,
    source: DataSourceRef,
    trigger?: EffectDefinition['trigger'],
): EffectDefinition[] {
  const effects = registry.effectsBySourceKey[makeSourceKey(source)] ?? EMPTY_EFFECTS

  if (!trigger) {
    return effects
  }

  return effects.filter((effect) => effect.trigger === trigger)
}

// list states for a source
export function listSourceStates(
    registry: GameDataRegistry,
    source: DataSourceRef,
): SourceStateDefinition[] {
  return registry.statesBySourceKey[makeSourceKey(source)] ?? EMPTY_STATES
}

// list owners for a source
export function listSourceOwners(
    registry: GameDataRegistry,
    source: DataSourceRef,
): SourceOwnerDefinition[] {
  return registry.ownersBySourceKey[makeSourceKey(source)] ?? EMPTY_OWNERS
}

// list conditions for a source
export function listSourceConditions(
    registry: GameDataRegistry,
    source: DataSourceRef,
): ConditionDefinition[] {
  return registry.conditionsBySourceKey[makeSourceKey(source)] ?? EMPTY_CONDITIONS
}

// get a source owner by owner key
export function getSourceOwnerByKey(
    registry: GameDataRegistry,
    ownerKey: string,
): SourceOwnerDefinition | null {
  return registry.ownersByKey[ownerKey] ?? null
}

// list effects attached to an owner key
export function listEffectsByOwnerKey(
    registry: GameDataRegistry,
    ownerKey: string,
): EffectDefinition[] {
  return registry.effectsByOwnerKey[ownerKey] ?? EMPTY_EFFECTS
}

// list states attached to an owner key
export function listStatesByOwnerKey(
    registry: GameDataRegistry,
    ownerKey: string,
): SourceStateDefinition[] {
  return registry.statesByOwnerKey[ownerKey] ?? EMPTY_STATES
}

// get a state definition by its control key
export function getStateByControlKey(
    registry: GameDataRegistry,
    controlKey: string,
): SourceStateDefinition | null {
  return registry.statesByControlKey[controlKey] ?? null
}

// list conditions attached to an owner key
export function listConditionsByOwnerKey(
    registry: GameDataRegistry,
    ownerKey: string,
): ConditionDefinition[] {
  return registry.conditionsByOwnerKey[ownerKey] ?? EMPTY_CONDITIONS
}

// get all resonator skills by resonator id
export function getResonatorSkills(
    registry: GameDataRegistry,
    resonatorId: string,
): SkillDefinition[] {
  return registry.resonatorSkillsById[resonatorId] ?? EMPTY_SKILLS
}

// list all skills for a source
export function listSourceSkills(
    registry: GameDataRegistry,
    source: DataSourceRef,
): SkillDefinition[] {
  return registry.skillsBySourceKey[makeSourceKey(source)] ?? EMPTY_SKILLS
}

// list all features for a source
export function listSourceFeatures(
    registry: GameDataRegistry,
    source: DataSourceRef,
): FeatureDefinition[] {
  return registry.featuresBySourceKey[makeSourceKey(source)] ?? EMPTY_FEATURES
}

// list all rotations for a source
export function listSourceRotations(
    registry: GameDataRegistry,
    source: DataSourceRef,
): RotationDefinition[] {
  return registry.rotationsBySourceKey[makeSourceKey(source)] ?? EMPTY_ROTATIONS
}

// get all resonator features by resonator id
export function getResonatorFeatures(
    registry: GameDataRegistry,
    resonatorId: string,
): FeatureDefinition[] {
  return registry.resonatorFeaturesById[resonatorId] ?? EMPTY_FEATURES
}

// get all resonator rotations by resonator id
export function getResonatorRotations(
    registry: GameDataRegistry,
    resonatorId: string,
): RotationDefinition[] {
  return registry.resonatorRotationsById[resonatorId] ?? EMPTY_ROTATIONS
}