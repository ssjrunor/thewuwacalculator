/*
  Author: Runor Ewhro
  description: defines Lily's Energy Regen conversions and packed state
               for candidate scoring.
*/

export function isLilyErCritSkill(characterId: number, skillId: string): boolean {
  return characterId === 1512 && ['1512015', '1512016', '1512023'].includes(skillId)
}

export function lilyExcessEr(finalEr: number): number {
  return Math.min(Math.max(0, finalEr - 100), 160)
}

export function lilySupportEr(finalEr: number): number {
  return Math.min(Math.max(0, finalEr - 190), 70)
}

export const LILY_AROMA_SHIFT = 1
export const LILY_AROMA_MASK = 7
export const LILY_SILVERED_BIT = 1 << 4

export function lilyAromaStacks(toggles: number): number {
  return (toggles >>> LILY_AROMA_SHIFT) & LILY_AROMA_MASK
}
