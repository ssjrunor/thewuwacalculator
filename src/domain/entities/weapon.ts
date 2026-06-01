/*
  Author: Runor Ewhro
  Description: Defines generated weapon catalog entities, including passive
               metadata and per-level stat progression.
*/

export interface WpnPssv {
  name: string
  desc: string
  params: string[][]
}

export interface GenWpn {
  id: string
  name: string
  weaponType: number
  rarity: number
  icon: string
  baseAtk: number
  statKey: string
  statValue: number
  passive: WpnPssv
  statsByLevel: Record<number, { atk: number; secondaryStatValue: number }>
}

export const STD_WEAPON_IDS = [
  '21010015',
  '21010045',
  '21020015',
  '21020045',
  '21030015',
  '21030045',
  '21040015',
  '21040045',
  '21050015',
  '21050045',
] as const

const STD_WEAPON_SET = new Set<string>(STD_WEAPON_IDS)

export function isStdWpn(weaponId: string): boolean {
  return STD_WEAPON_SET.has(weaponId)
}
