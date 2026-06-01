/*
  Author: Runor Ewhro
  Description: Shared display metadata for calculator-facing catalog labels,
               colors, and weapon type text.
*/

import type { AttributeKey } from '@/domain/entities/stats'
import type {EnemyElemId} from "@/domain/entities/enemy.ts";

export type WeaponTypeId = 1 | 2 | 3 | 4 | 5

// attribute colors are reused anywhere an element needs a quick ui accent.
export const ATTR_COLORS: Record<AttributeKey, string> = {
  aero: '#51ffb3',
  glacio: '#40aefa',
  spectro: '#f8e56c',
  fusion: '#f0734d',
  electro: '#b46aff',
  havoc: '#e649a6',
  physical: '#8c8c8c'
}

export const ATTR_ID_COLORS: Record<EnemyElemId, string> = {
  0: '#8c8c8c',
  1: '#3ebde3',
  2: '#c5344f',
  3: '#a70dd1',
  4: '#0fcda0',
  5: '#d0b33f',
  6: '#ac0960'
}

export const WPNTYPELBLS: Record<number, string> = {
  1: 'Broadblade',
  2: 'Sword',
  3: 'Pistols',
  4: 'Gauntlets',
  5: 'Rectifier',
}

export const WPNTYPETOKEY: Record<number, string> = {
  1: 'broadblade',
  2: 'sword',
  3: 'pistols',
  4: 'gauntlets',
  5: 'rectifier',
}

export const WPNTYPEPTNS: Array<{ key: string; label: string }> = [
  { key: 'broadblade', label: 'Broadblade' },
  { key: 'sword', label: 'Sword' },
  { key: 'pistols', label: 'Pistols' },
  { key: 'gauntlets', label: 'Gauntlets' },
  { key: 'rectifier', label: 'Rectifier' },
]

export function getWpnTypeLb(weaponType: number): string {
  // unknown ids should still render something readable during ingest drift or
  // partial data migration instead of failing the ui outright.
  return WPNTYPELBLS[weaponType] ?? `Weapon ${weaponType}`
}
