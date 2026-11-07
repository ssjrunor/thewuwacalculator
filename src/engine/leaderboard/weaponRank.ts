/*
  Author: Runor Ewhro
  description: selects R1 for limited five-star weapons and R5 for standard or lower-rarity weapons.
*/

/** the permanent-banner 5-star weapons. */
export const STANDARD_WEAPON_IDS: ReadonlySet<string> = new Set([
  '21010015', // Lustrous Razor
  '21010045', // Radiance Cleaver
  '21020015', // Emerald of Genesis
  '21020045', // Laser Shearer
  '21030015', // Static Mist
  '21030045', // Phasic Homogenizer
  '21040015', // Abyss Surges
  '21040045', // Pulsation Bracer
  '21050015', // Cosmic Ripples
  '21050045', // Boson Astrolabe
])

export function leaderboardWeaponRank(weaponId: string, rarity: number): number {
  return rarity >= 5 && !STANDARD_WEAPON_IDS.has(String(weaponId)) ? 1 : 5
}
