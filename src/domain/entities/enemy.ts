/*
  Author: Runor Ewhro
  Description: Defines enemy catalog types, default profiles, resistance
               helpers, and preset enemy profile builders.
*/

import type { EnemyProfile, EnemyResistN, EnemyResistT } from '@/domain/entities/appState'

export type EnemyElemId = EnemyResistN
export type EnemyClassId = 1 | 2 | 3 | 4
export const DEF_ENEMY_ID = '340000240'

export interface EnemyCatEnt {
  id: string
  name: string
  description: string
  descriptionOpen: string
  class: EnemyClassId
  element: EnemyElemId | null
  elementArray: EnemyElemId[]
  icon: string | null
  resistances: Partial<EnemyResistT>
}

// default tower-style enemy resistances
export const DEF_ENEMY_RES: EnemyResistT = {
  0: 20,
  1: 60,
  2: 20,
  3: 20,
  4: 20,
  5: 20,
  6: 20,
}

// standard non-tower enemy resistances
export const STD_ENEMY_RES: EnemyResistT = {
  0: 10,
  1: 40,
  2: 10,
  3: 10,
  4: 10,
  5: 10,
  6: 10,
}

// display labels for enemy elements
export const ENEMY_ELEM_TXT: Record<EnemyElemId, string> = {
  0: 'Physical',
  1: 'Glacio',
  2: 'Fusion',
  3: 'Electro',
  4: 'Aero',
  5: 'Spectro',
  6: 'Havoc',
}

// attribute keys for enemy elements
export const ENEMY_ELEM_ATTR: Record<EnemyElemId, string> = {
  0: 'physical',
  1: 'glacio',
  2: 'fusion',
  3: 'electro',
  4: 'aero',
  5: 'spectro',
  6: 'havoc',
}

// display labels for enemy classes
export const ENEMY_CLASS_TXT: Record<EnemyClassId, string> = {
  1: 'Common',
  2: 'Elite',
  3: 'Overlord',
  4: 'Calamity',
}

export interface EnemyPrstDef {
  id: string
  label: string
  caption: string
  profile: EnemyProfile
}

// resolve an enemy icon path from a numeric enemy id
export function getEnemyIcon(enemyId: string | null | undefined): string | null {
  if (!enemyId) {
    return null
  }

  return /^\d+$/.test(enemyId) ? `/assets/enemies/${enemyId}.webp` : null
}

// built-in quick enemy presets
export const ENEMY_PRST: EnemyPrstDef[] = [
  {
    id: 'custom:tower-boss',
    label: 'Tower Boss Lv.100',
    caption: 'Overlord class · all RES 20%',
    profile: {
      id: 'custom:tower-boss',
      level: 100,
      class: 3,
      toa: true,
      source: 'custom',
      status: {
        tuneStrain: 0,
      },
      res: {
        0: 20,
        1: 20,
        2: 20,
        3: 20,
        4: 20,
        5: 20,
        6: 20,
      },
    },
  },
  {
    id: 'custom:basic-elite',
    label: 'Basic Elite Lv.90',
    caption: 'Elite class · all RES 10%',
    profile: {
      id: 'custom:basic-elite',
      level: 90,
      class: 2,
      toa: false,
      source: 'custom',
      status: {
        tuneStrain: 0,
      },
      res: {
        0: 10,
        1: 10,
        2: 10,
        3: 10,
        4: 10,
        5: 10,
        6: 10,
      },
    },
  },
]

// default selected enemy profile
export const DEF_ENEMY_PROF: EnemyProfile = {
  id: DEF_ENEMY_ID,
  level: 90,
  class: 4,
  toa: false,
  source: 'catalog',
  status: {
    tuneStrain: 0,
  },
  res: {
    0: 10,
    1: 10,
    2: 10,
    3: 10,
    4: 10,
    5: 10,
    6: 10,
  },
}

// type guard for enemy class ids
export function isEnemyClssI(value: number): value is EnemyClassId {
  return value === 1 || value === 2 || value === 3 || value === 4
}

// normalize a partial resistance table into a full one
export function normEnemyRes(
    resistances?: Partial<Record<EnemyResistN, number>> | Partial<Record<`${EnemyResistN}`, number>>,
    fallback: EnemyResistT = DEF_ENEMY_RES,
): EnemyResistT {
  const raw = resistances as Record<string, number> | undefined

  return {
    0: typeof raw?.['0'] === 'number' ? raw['0'] : fallback[0],
    1: typeof raw?.['1'] === 'number' ? raw['1'] : fallback[1],
    2: typeof raw?.['2'] === 'number' ? raw['2'] : fallback[2],
    3: typeof raw?.['3'] === 'number' ? raw['3'] : fallback[3],
    4: typeof raw?.['4'] === 'number' ? raw['4'] : fallback[4],
    5: typeof raw?.['5'] === 'number' ? raw['5'] : fallback[5],
    6: typeof raw?.['6'] === 'number' ? raw['6'] : fallback[6],
  }
}

// convert standard resistances to tower of adversity values
export function applyTwrOfDv(resistances: EnemyResistT): EnemyResistT {
  const mapped = { ...resistances }
  const indices: EnemyResistN[] = [0, 1, 2, 3, 4, 5, 6]

  for (const key of indices) {
    const value = mapped[key]
    if (value === 10) {
      mapped[key] = 20
      continue
    }

    if (value === 40) {
      mapped[key] = 60
    }
  }

  return mapped
}

// convert tower of adversity resistances back to standard values
export function rmTwrOfDvrsR(resistances: EnemyResistT): EnemyResistT {
  const mapped = { ...resistances }
  const indices: EnemyResistN[] = [0, 1, 2, 3, 4, 5, 6]

  for (const key of indices) {
    const value = mapped[key]
    if (value === 20) {
      mapped[key] = 10
      continue
    }

    if (value === 60) {
      mapped[key] = 40
    }
  }

  return mapped
}

// get a resolved resistance table for a catalog enemy
export function getEnemyResi(enemy: EnemyCatEnt | null, toa: boolean): EnemyResistT {
  const baseTable = normEnemyRes(
      enemy?.resistances,
      toa ? DEF_ENEMY_RES : STD_ENEMY_RES,
  )

  return toa ? applyTwrOfDv(baseTable) : baseTable
}

// build a live enemy profile from a catalog entry
export function makeEnemyProf(
    enemy: EnemyCatEnt,
    options?: {
      previousProfile?: EnemyProfile
      toa?: boolean
      level?: number
    },
): EnemyProfile {
  const toa = options?.toa ?? options?.previousProfile?.toa ?? false
  const previousLevel = options?.previousProfile?.level ?? 0
  const resolvedLevel = options?.level ?? (previousLevel || (toa ? 100 : 90))

  return {
    id: enemy.id,
    level: Math.max(1, Math.min(150, resolvedLevel)),
    class: enemy.class,
    toa,
    source: 'catalog',
    status: options?.previousProfile?.status ?? {
      tuneStrain: 0,
    },
    res: getEnemyResi(enemy, toa),
  }
}