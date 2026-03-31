/*
  Author: Runor Ewhro
  Description: Provides helpers for reading, selecting, and mutating enemy
               profiles, including tower mode, presets, and resistances.
*/

import type { EnemyProfile, EnemyResistanceIndex } from '@/domain/entities/appState'
import type { EnemyCatalogEntry, EnemyClassId, EnemyElementId, EnemyPresetDefinition } from '@/domain/entities/enemy'
import {
  applyTowerOfAdversityResistances,
  buildEnemyProfileFromCatalog,
  ENEMY_ELEMENT_ATTRIBUTE_KEYS,
  ENEMY_ELEMENT_LABELS,
  getEnemyResistanceTable,
  isEnemyClassId,
  removeTowerOfAdversityResistances,
} from '@/domain/entities/enemy'

// clamp a number into a bounded range
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export interface EnemyResistanceRow {
  elementId: EnemyElementId
  label: string
  attributeKey: string
  value: number
}

// check whether an enemy profile is custom
export function isCustomEnemyProfile(profile: EnemyProfile): boolean {
  return profile.source === 'custom'
}

// read tune strain from an enemy profile with a safe fallback
export function getEnemyTuneStrain(profile: EnemyProfile): number {
  return profile.status?.tuneStrain ?? 0
}

// resolve a valid enemy class from a profile
export function getResolvedEnemyClass(profile: EnemyProfile): EnemyClassId {
  return isEnemyClassId(profile.class) ? profile.class : 1
}

// build display rows for enemy resistances
export function getEnemyResistanceRows(
    profile: EnemyProfile,
    elementOptions: EnemyElementId[],
): EnemyResistanceRow[] {
  return elementOptions.map((elementId) => ({
    elementId,
    label: ENEMY_ELEMENT_LABELS[elementId],
    attributeKey: ENEMY_ELEMENT_ATTRIBUTE_KEYS[elementId],
    value: profile.res[elementId],
  }))
}

// remap custom enemy resistances when toggling tower mode
export function remapCustomEnemyResistances(profile: EnemyProfile, nextToa: boolean): EnemyProfile['res'] {
  if (profile.toa === nextToa) {
    return profile.res
  }

  return nextToa
      ? applyTowerOfAdversityResistances(profile.res)
      : removeTowerOfAdversityResistances(profile.res)
}

// select a catalog enemy while preserving useful current profile context
export function selectCatalogEnemyProfile(
    currentProfile: EnemyProfile,
    selectedEnemy: EnemyCatalogEntry,
): EnemyProfile {
  return buildEnemyProfileFromCatalog(selectedEnemy, {
    previousProfile: {
      ...currentProfile,
      source: 'catalog',
    },
  })
}

// select a preset enemy profile while preserving current tune strain
export function selectEnemyPreset(profile: EnemyProfile, preset: EnemyPresetDefinition): EnemyProfile {
  return {
    ...preset.profile,
    toa: preset.profile.toa,
    status: {
      tuneStrain: getEnemyTuneStrain(profile),
    },
  }
}

// toggle tower mode for the current enemy profile
export function toggleEnemyTowerMode(
    profile: EnemyProfile,
    selectedEnemy: EnemyCatalogEntry | null,
    nextToa: boolean,
): EnemyProfile {
  const nextLevel = profile.level > 0 ? profile.level : nextToa ? 100 : 90
  const customMode = isCustomEnemyProfile(profile)

  return {
    ...profile,
    toa: nextToa,
    level: clamp(nextLevel, 1, 150),
    res: customMode
        ? remapCustomEnemyResistances(profile, nextToa)
        : selectedEnemy
            ? getEnemyResistanceTable(selectedEnemy, nextToa)
            : profile.res,
  }
}

// set enemy level with bounds applied
export function setEnemyLevel(profile: EnemyProfile, value: number): EnemyProfile {
  return {
    ...profile,
    level: clamp(Math.round(value), 1, 150),
  }
}

// set enemy class
export function setEnemyClass(profile: EnemyProfile, enemyClass: EnemyClassId): EnemyProfile {
  return {
    ...profile,
    class: enemyClass,
  }
}

// set one enemy resistance value with bounds applied
export function setEnemyResistance(
    profile: EnemyProfile,
    resistanceIndex: EnemyResistanceIndex,
    value: number,
): EnemyProfile {
  return {
    ...profile,
    res: {
      ...profile.res,
      [resistanceIndex]: clamp(value, -100, 200),
    },
  }
}

// set enemy tune strain with bounds applied
export function setEnemyTuneStrain(profile: EnemyProfile, value: number): EnemyProfile {
  return {
    ...profile,
    status: {
      tuneStrain: clamp(value, 0, 10),
    },
  }
}