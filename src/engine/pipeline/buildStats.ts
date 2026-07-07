/*
  Author: Runor Ewhro
  Description: derives a resonator's "build" stats: the values that come purely
               from the equipped build: base stats, trace nodes, the weapon's
               secondary stat, equipped echo main/sub stats, and the always-on
               (unsettable) echo set + main echo buffs. Every toggleable combat
               state, stack, manual input, and resonator kit (skill/forte/
               sequence) buff is excluded, so this reads as the gear baseline
               beneath the live combat stats. Not benchmark-specific.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import type { DataSrcRef } from '@/domain/gameData/contracts'
import type { FinalStats, ResBaseStats } from '@/domain/entities/stats'
import { calcFinalStats } from '@/engine/formulas/finalStats'
import { applyRtDataF } from '@/engine/effects/dataEffects'
import { mkRtBaseBuff } from '@/engine/pipeline/buildCombatContext'
import { wpnAtkAt } from '@/domain/state/weaponState'
import { makeCombatState, makeCustomBuff } from '@/domain/state/defaults'

// the only buff sources that count toward build stats: echo set sonatas and
// the main echo's own passives. Resonator/weapon-effect sources are excluded.
function isEchoBuffSource(source: DataSrcRef): boolean {
  return source.type === 'echoSet' || source.type === 'echo'
}

// clear every toggleable input so only unconditional buffs survive condition
// evaluation. Stack/input-driven buffs collapse to their zero default and drop
// out; always-on buffs still apply.
function neutralizeRuntime(runtime: ResRuntime): ResRuntime {
  return {
    ...runtime,
    state: {
      ...runtime.state,
      controls: {},
      manualBuffs: makeCustomBuff(),
      combat: makeCombatState(),
    },
  }
}

export function getBuildStats(runtime: ResRuntime, baseStats: ResBaseStats): FinalStats {
  const neutral = neutralizeRuntime(runtime)
  const wpnAtk = wpnAtkAt(runtime.build.weapon.id, runtime.build.weapon.level)

  // base + trace nodes + weapon secondary stat + echo main/sub stats
  // (manual buffs and combat-state derived effects neutralize to nothing).
  const pool = mkRtBaseBuff(neutral)

  const options = {
    teamRuntime: neutral,
    actResId: neutral.id,
    baseStats,
    includeEchoSets: true,
  }

  // layer in only the unsettable echo set + main echo buffs, across both
  // effect stages exactly like the live pipeline.
  const preStatsPool = applyRtDataF(neutral, pool, options, 'preStats', isEchoBuffSource)
  const preStats = calcFinalStats(baseStats, preStatsPool, wpnAtk)
  const postStatsPool = applyRtDataF(
    neutral,
    preStatsPool,
    { ...options, finalStats: preStats },
    'postStats',
    isEchoBuffSource,
  )

  return calcFinalStats(baseStats, postStatsPool, wpnAtk)
}
