/*
  Author: Runor Ewhro
  Description: derives a resonator's "build" stats: base stats, equipped gear,
               and every effect whose activation is fixed by that concrete
               build. Toggleable combat state, stacks, active targeting, manual
               inputs, and enemy state remain excluded. Not evaluation-specific.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import type { EffectContext, EffectDef } from '@/domain/gameData/contracts.ts'
import type { FinalStats, ResBaseStats } from '@/domain/entities/stats'
import { isBuildBoundEffect } from '@/domain/gameData/effectActivation.ts'
import { getGameData } from '@/data/gameData/index.ts'
import { evalCond } from '@/engine/effects/evaluator.ts'
import { calcFinalStats } from '@/engine/formulas/finalStats.ts'
import { applyRtDataF } from '@/engine/effects/dataEffects.ts'
import { mkRtBaseBuff } from '@/engine/pipeline/buildCombatContext'
import { makeCombatState, makeCustomBuff, makeEnemy } from '@/engine/runtime/defaults'
import { wpnAtkAt } from '@/engine/runtime/weaponState.ts'

// Clear toggleable inputs as a second line of defense. The effect classifier
// keeps control-driven effects out entirely; neutral state also prevents an
// accidentally admitted condition from inheriting the live combat setup.
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

function includeBuildEffect(effect: EffectDef, context: EffectContext): boolean {
  const owner = effect.ownerKey ? getGameData().ownersByKey[effect.ownerKey] : undefined
  if (!isBuildBoundEffect(effect, owner)) return false

  const scope = {
    sourceRuntime: context.sourceRuntime,
    sourceFinalStats: context.sourceFinalStats,
    targetRuntime: context.targetRuntime,
    activeRuntime: context.activeRuntime,
    context,
    pool: context.pool,
    baseStats: context.baseStats,
    finalStats: context.finalStats,
  }
  return evalCond(owner?.unlockWhen, scope) && evalCond(owner?.visibleWhen, scope)
}

export function getBuildStats(runtime: ResRuntime, baseStats: ResBaseStats): FinalStats {
  const neutral = neutralizeRuntime(runtime)
  const weaponAttack = wpnAtkAt(runtime.build.weapon.id, runtime.build.weapon.level)
  const pool = mkRtBaseBuff(neutral)
  const options = {
    teamRuntime: neutral,
    actResId: neutral.id,
    baseStats,
    enemy: makeEnemy(),
    includeEchoSets: true,
  }

  const preStatsPool = applyRtDataF(
    neutral,
    pool,
    options,
    'preStats',
    undefined,
    includeBuildEffect,
  )
  const preStats = calcFinalStats(baseStats, preStatsPool, weaponAttack)
  const postStatsPool = applyRtDataF(
    neutral,
    preStatsPool,
    { ...options, finalStats: preStats },
    'postStats',
    undefined,
    includeBuildEffect,
  )
  const postStats = calcFinalStats(baseStats, postStatsPool, weaponAttack)
  const finalStatsPool = applyRtDataF(
    neutral,
    postStatsPool,
    { ...options, finalStats: postStats },
    'finalStats',
    undefined,
    includeBuildEffect,
  )

  return calcFinalStats(baseStats, finalStatsPool, weaponAttack)
}
