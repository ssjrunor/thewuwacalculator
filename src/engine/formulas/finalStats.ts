/*
  Author: Runor Ewhro
  Description: Computes final stats from base stats, weapon base attack,
               and a unified buff pool.
*/

import type {
  ResonatorBaseStats,
  UnifiedBuffPool,
  FinalStats,
} from '@/domain/entities/stats'

// combine base stats, weapon attack, and pooled buffs into final stats
export function computeFinalStatsFromPool(
    baseStats: ResonatorBaseStats,
    pool: UnifiedBuffPool,
    weaponBaseAtk: number,
): FinalStats {
  // compute base stat totals before percentage and flat bonuses
  const atkBase = baseStats.atk + weaponBaseAtk
  const hpBase = baseStats.hp
  const defBase = baseStats.def

  // apply percent and flat bonuses to core stats
  const atkFinal = atkBase * (1 + pool.atk.percent / 100) + pool.atk.flat
  const hpFinal = hpBase * (1 + pool.hp.percent / 100) + pool.hp.flat
  const defFinal = defBase * (1 + pool.def.percent / 100) + pool.def.flat

  // return the fully assembled final stats object
  return {
    atk: { base: atkBase, final: atkFinal },
    hp: { base: hpBase, final: hpFinal },
    def: { base: defBase, final: defFinal },
    attribute: pool.attribute,
    skillType: pool.skillType,
    negativeEffect: pool.negativeEffect,
    flatDmg: pool.flatDmg,
    amplify: pool.amplify,
    critRate: baseStats.critRate + pool.critRate,
    critDmg: baseStats.critDmg + pool.critDmg,
    energyRegen: baseStats.energyRegen + pool.energyRegen,
    healingBonus: baseStats.healingBonus + pool.healingBonus,
    shieldBonus: pool.shieldBonus,
    dmgBonus: pool.dmgBonus,
    defIgnore: pool.defIgnore,
    defShred: pool.defShred,
    dmgVuln: pool.dmgVuln,
    tuneBreakBoost: baseStats.tuneBreakBoost + pool.tuneBreakBoost,
    special: pool.special,
  }
}
