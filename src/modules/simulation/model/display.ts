/*
  Author: Runor Ewhro
  Description: Shared display metadata for Simulation-facing catalog labels,
               colors, and weapon type text.
*/

import type { EnemyElemId } from '@/domain/entities/enemy'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay'

export { ATTR_COLORS } from '@/domain/gameData/attributeDisplay'

export type WeaponTypeId = 1 | 2 | 3 | 4 | 5
export type RarityId = 1 | 2 | 3 | 4 | 5

export const RARITY_COLORS: Record<RarityId, string> = {
  1: 'rgb(153, 153, 153)',
  2: 'rgb(98, 147, 124)',
  3: 'rgb(96, 147, 185)',
  4: 'rgb(132, 72, 168)',
  5: 'rgb(255, 183, 0)',
}

export function getRarityColor(rarity: number | null | undefined): string | undefined {
  return RARITY_COLORS[rarity as RarityId]
}

// Contrast ink is keyed with rarity color so all consumers use the same pairing.
export const RARITY_INKS: Record<RarityId, string> = {
  1: '#15151a',
  2: '#f4fbf7',
  3: '#f4faff',
  4: '#fbf6ff',
  5: '#17110a',
}

export function getRarityInk(rarity: number | null | undefined): string | undefined {
  return RARITY_INKS[rarity as RarityId]
}

export function rarityVars(
  rarity: number | null | undefined,
  bisOrVars: boolean | string | string[] = false,
  vars: string | string[] = '--picker-rarity-color',
): Record<string, string> | undefined {
  const bis = typeof bisOrVars === 'boolean' ? bisOrVars : false
  const rslvVars = typeof bisOrVars === 'boolean' ? vars : bisOrVars
  const color = bis ? '#BDD7F9' : getRarityColor(rarity)
  if (!color) return undefined

  const keys = Array.isArray(rslvVars) ? rslvVars : [rslvVars]
  return Object.fromEntries(keys.map((key) => [key, color]))
}

export const ATTR_ID_COLORS: Record<EnemyElemId, string> = {
  0: ATTR_COLORS.physical,
  1: ATTR_COLORS.glacio,
  2: ATTR_COLORS.fusion,
  3: ATTR_COLORS.electro,
  4: ATTR_COLORS.aero,
  5: ATTR_COLORS.spectro,
  6: ATTR_COLORS.havoc,
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
  // Preserve unknown ids in the label so partial or newly ingested data remains identifiable.
  return WPNTYPELBLS[weaponType] ?? `Weapon ${weaponType}`
}
