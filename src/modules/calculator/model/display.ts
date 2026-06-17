/*
  Author: Runor Ewhro
  Description: Shared display metadata for calculator-facing catalog labels,
               colors, and weapon type text.
*/

import type { EnemyElemId } from '@/domain/entities/enemy'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay'

export { ATTR_COLORS } from '@/domain/gameData/attributeDisplay'

export type WeaponTypeId = 1 | 2 | 3 | 4 | 5

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
  // unknown ids should still render something readable during ingest drift or
  // partial data migration instead of failing the ui outright.
  return WPNTYPELBLS[weaponType] ?? `Weapon ${weaponType}`
}
