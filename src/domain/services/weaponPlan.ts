/*
  Author: Runor Ewhro
  Description: shared weapon-plan resolution used by both the weapon suggestion
               engine and the optimizer's weapon search: rarity visibility,
               refinement rank, and level-scaled stats for a candidate weapon
               under a weapon plan.
*/

import type { GenWpn } from '@/domain/entities/weapon.ts'
import { isStdWpn } from '@/domain/entities/weapon.ts'
import type { WeaponPlanSet } from '@/domain/entities/suggestions.ts'

// rarities searched when no plan is supplied (4★ and 5★).
const DEFAULT_RARITIES = new Set([4, 5])

// is this weapon's rarity in the search space? the plan's per-rarity visibility
// wins when supplied, otherwise the built-in 4★/5★ default.
export function weaponRarityVisible(wpn: GenWpn, plan?: WeaponPlanSet): boolean {
  if (plan) {
    return plan.visible[String(wpn.rarity)] ?? false
  }
  return DEFAULT_RARITIES.has(wpn.rarity)
}

// the refinement rank for a candidate: standard-weapon rank wins over rarity
// rank, falling back to 5★→R1 / else R5. clamped to 1..5.
export function resolveWeaponRank(wpn: GenWpn, plan?: WeaponPlanSet): number {
  const fallback = wpn.rarity === 5 ? 1 : 5
  if (!plan) {
    return Math.max(1, Math.min(5, fallback))
  }
  const raw = isStdWpn(wpn.id)
      ? plan.stdRank ?? fallback
      : plan.ranks[String(wpn.rarity)] ?? fallback
  return Math.max(1, Math.min(5, Math.round(raw)))
}

// level-scaled weapon base atk + secondary stat value, with a nearest-level
// fallback when the exact level is missing.
export function weaponStatsAt(wpn: GenWpn, level: number): { atk: number; statVal: number } {
  const hit = wpn.statsByLevel[level]
  if (hit) {
    return { atk: hit.atk, statVal: hit.secondaryStatValue }
  }

  const levels = Object.keys(wpn.statsByLevel)
      .map(Number)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
  const near = levels.reduce(
      (prev, cur) => (Math.abs(cur - level) < Math.abs(prev - level) ? cur : prev),
      levels[0] ?? level,
  )
  const fb = wpn.statsByLevel[near]

  return {
    atk: fb?.atk ?? wpn.baseAtk,
    statVal: fb?.secondaryStatValue ?? wpn.statValue,
  }
}
