/*
  author: runor ewhro
  description: shared display metadata for calculator-facing catalog labels.
*/

import type { AttributeKey } from '@/domain/entities/stats'

export type WeaponTypeId = 1 | 2 | 3 | 4 | 5

// attribute colors are reused anywhere an element needs a quick ui accent.
export const ATTRIBUTE_COLORS: Record<AttributeKey, string> = {
  aero: '#0fcda0',
  glacio: '#3ebde3',
  spectro: '#d0b33f',
  fusion: '#c5344f',
  electro: '#a70dd1',
  havoc: '#ac0960',
  physical: '#8c8c8c',
}

export const WEAPON_TYPE_LABELS: Record<number, string> = {
  1: 'Broadblade',
  2: 'Sword',
  3: 'Pistols',
  4: 'Gauntlets',
  5: 'Rectifier',
}

export const WEAPON_TYPE_TO_KEY: Record<number, string> = {
  1: 'broadblade',
  2: 'sword',
  3: 'pistols',
  4: 'gauntlets',
  5: 'rectifier',
}

export const WEAPON_TYPE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'broadblade', label: 'Broadblade' },
  { key: 'sword', label: 'Sword' },
  { key: 'pistols', label: 'Pistols' },
  { key: 'gauntlets', label: 'Gauntlets' },
  { key: 'rectifier', label: 'Rectifier' },
]

export function getWeaponTypeLabel(weaponType: number): string {
  return WEAPON_TYPE_LABELS[weaponType] ?? `Weapon ${weaponType}`
}
