/*
  Author: Runor Ewhro
  Description: Provides weapon catalog lookup helpers for listing weapons
               by type and resolving weapons by id.
*/

import { getWeapons, getWeaponsById } from '@/data/gameData/weapons/weaponDataStore'
import type { GeneratedWeapon } from '@/domain/entities/weapon'

// list all weapons for a given weapon type
export function listWeaponsByType(weaponType: number): GeneratedWeapon[] {
  return getWeapons()
      .filter((weapon) => weapon.weaponType === weaponType)
      .sort((a, b) => b.rarity - a.rarity || a.id.localeCompare(b.id))
}

// get one weapon by id
export function getWeaponById(weaponId: string): GeneratedWeapon | null {
  return getWeaponsById()[weaponId] ?? null
}