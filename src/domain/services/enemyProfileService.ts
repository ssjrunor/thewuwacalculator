/*
  Author: Runor Ewhro
  Description: Provides helpers for reading, selecting, and mutating enemy
               profiles, including tower mode, presets, and resistances.
*/

import type { EnemyProfile, EnemyResistN, EnemyStateValue } from '@/domain/entities/appState'
import type { EnemyCatEnt, EnemyClassId, EnemyElemId, EnemyPrstDef } from '@/domain/entities/enemy'
import {
  applyTwrOfDv,
  makeEnemyProf,
  ENEMY_ELEM_ATTR,
  ENEMY_ELEM_TXT,
  getEnemyResi,
  isEnemyClssI,
  rmTwrOfDvrsR,
} from '@/domain/entities/enemy'

// clamp a number into a bounded range
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export interface EnemyResistR {
  elementId: EnemyElemId
  label: string
  attributeKey: string
  value: number
}

// check whether an enemy profile is custom
export function isCustEnemyP(profile: EnemyProfile): boolean {
  return profile.source === 'custom'
}

// read tune strain from an enemy profile with a safe fallback
export function getEnemyTune(profile: EnemyProfile): number {
  return profile.status?.tuneStrain ?? 0
}

// resolve a valid enemy class from a profile
export function getRslvEnemy(profile: EnemyProfile): EnemyClassId {
  return isEnemyClssI(profile.class) ? profile.class : 1
}

// build display rows for enemy resistances
export function getEnemyReys(
    profile: EnemyProfile,
    elemPtns: EnemyElemId[],
): EnemyResistR[] {
  return elemPtns.map((elementId) => ({
    elementId,
    label: ENEMY_ELEM_TXT[elementId],
    attributeKey: ENEMY_ELEM_ATTR[elementId],
    value: profile.res[elementId],
  }))
}

// remap custom enemy resistances when toggling tower mode
export function rmpCustEnemy(profile: EnemyProfile, nextToa: boolean): EnemyProfile['res'] {
  if (profile.toa === nextToa) {
    return profile.res
  }

  return nextToa
      ? applyTwrOfDv(profile.res)
      : rmTwrOfDvrsR(profile.res)
}

// select a catalog enemy while preserving useful current profile context
export function selCatEnemyP(
    curProf: EnemyProfile,
    selEnemy: EnemyCatEnt,
): EnemyProfile {
  return makeEnemyProf(selEnemy, {
    previousProfile: {
      ...curProf,
      source: 'catalog',
    },
  })
}

// select a preset enemy profile while preserving current tune strain
export function selEnemyPrst(profile: EnemyProfile, preset: EnemyPrstDef): EnemyProfile {
  return {
    ...preset.profile,
    toa: preset.profile.toa,
    status: {
      tuneStrain: getEnemyTune(profile),
    },
  }
}

// toggle tower mode for the current enemy profile
export function tglEnemyTwrM(
    profile: EnemyProfile,
    selEnemy: EnemyCatEnt | null,
    nextToa: boolean,
): EnemyProfile {
  const nextLevel = profile.level > 0 ? profile.level : nextToa ? 100 : 90
  const customMode = isCustEnemyP(profile)

  return {
    ...profile,
    toa: nextToa,
    level: clamp(nextLevel, 1, 150),
    res: customMode
        ? rmpCustEnemy(profile, nextToa)
        : selEnemy
            ? getEnemyResi(selEnemy, nextToa)
            : profile.res,
  }
}

// set enemy level with bounds applied
export function setEnemyLvl(profile: EnemyProfile, value: number): EnemyProfile {
  return {
    ...profile,
    level: clamp(Math.round(value), 1, 150),
  }
}

// set enemy class
export function setEnemyClss(profile: EnemyProfile, enemyClass: EnemyClassId): EnemyProfile {
  return {
    ...profile,
    class: enemyClass,
  }
}

// set one enemy resistance value with bounds applied
export function setEnemyResi(
    profile: EnemyProfile,
    resistNdx: EnemyResistN,
    value: number,
): EnemyProfile {
  return {
    ...profile,
    res: {
      ...profile.res,
      [resistNdx]: clamp(value, -100, 200),
    },
  }
}

// set enemy tune strain with bounds applied, preserving other state fields
export function setEnemyTune(profile: EnemyProfile, value: number): EnemyProfile {
  return {
    ...profile,
    status: {
      ...(profile.status ?? { tuneStrain: 0 }),
      tuneStrain: clamp(value, 0, 10),
    },
  }
}

// read an arbitrary enemy debuff-state value (toggle/stack/select) with a safe fallback
export function getEnemyState(
  profile: EnemyProfile,
  field: string,
): EnemyStateValue | undefined {
  return profile.status?.[field]
}

// set an arbitrary enemy debuff-state value, preserving tuneStrain and other fields
export function setEnemyState(
  profile: EnemyProfile,
  field: string,
  value: EnemyStateValue,
): EnemyProfile {
  return {
    ...profile,
    status: {
      tuneStrain: 0,
      ...(profile.status ?? {}),
      [field]: value,
    },
  }
}