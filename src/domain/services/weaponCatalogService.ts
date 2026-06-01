/*
  Author: Runor Ewhro
  Description: Provides weapon catalog lookup helpers for listing weapons
               by type and resolving weapons by id.
*/

import { getWeapons, getWpnsById } from '@/data/gameData/weapons/weaponDataStore'
import type { GenWpn } from '@/domain/entities/weapon'

// list all weapons for a given weapon type
export function listWpnsByTy(weaponType: number): GenWpn[] {
  return getWeapons()
      .filter((weapon) => weapon.weaponType === weaponType)
      .sort((a, b) => b.rarity - a.rarity || a.id.localeCompare(b.id))
}

// get one weapon by id
export function getWpnById(weaponId: string): GenWpn | null {
  return getWpnsById()[weaponId] ?? null
}