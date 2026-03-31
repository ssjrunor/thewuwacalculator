/*
  Author: Runor Ewhro
  Description: Module-level cache for weapon data, populated by
               initializeGameData() before the app renders.
*/

import type { GeneratedWeapon } from '@/domain/entities/weapon'

let weaponsCache: GeneratedWeapon[] = []
let weaponsByIdCache: Record<string, GeneratedWeapon> = {}

export function initWeaponData(weapons: GeneratedWeapon[]): void {
  weaponsCache = weapons
  weaponsByIdCache = Object.fromEntries(weapons.map((w) => [w.id, w]))
}

export function getWeapons(): GeneratedWeapon[] {
  return weaponsCache
}

export function getWeaponsById(): Record<string, GeneratedWeapon> {
  return weaponsByIdCache
}
