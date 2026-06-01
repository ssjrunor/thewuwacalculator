/*
  Author: Runor Ewhro
  Description: Module-level cache for weapon data, populated by
               initializeGameData() before the app renders.
*/

import type { GenWpn } from '@/domain/entities/weapon'

let weaponsCache: GenWpn[] = []
let wpnsByIdCch: Record<string, GenWpn> = {}

export function initWpnData(weapons: GenWpn[]): void {
  weaponsCache = weapons
  wpnsByIdCch = Object.fromEntries(weapons.map((w) => [w.id, w]))
}

export function getWeapons(): GenWpn[] {
  return weaponsCache
}

export function getWpnsById(): Record<string, GenWpn> {
  return wpnsByIdCch
}
