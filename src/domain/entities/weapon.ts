/*
  Author: Runor Ewhro
  Description: Defines generated weapon catalog entities, including passive
               metadata and per-level stat progression.
*/

export interface WeaponPassive {
  name: string
  desc: string
  params: string[][]
}

export interface GeneratedWeapon {
  id: string
  name: string
  weaponType: number
  rarity: number
  icon: string
  baseAtk: number
  statKey: string
  statValue: number
  passive: WeaponPassive
  statsByLevel: Record<number, { atk: number; secondaryStatValue: number }>
}