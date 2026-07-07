/*
  Author: Runor Ewhro
  Description: benchmarks a build's substats against an optimally rolled set of
               25 substats for the active target, evaluated at floor and ceiling
               roll values, while preserving the build's energy regen investment.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { ECHO_STAT_STRIDE } from '@/engine/optimizer/config/constants'
import { addEchoStat, encEchoRows } from '@/engine/optimizer/encode/echoes'
import { mkSuggMainEc } from '@/engine/suggestions/shared'
import type { SuggestContext } from '@/engine/suggestions/types'
import { scoreStats } from '@/data/scoring/benchmark/scoring'
import {
  aggregateSubstats,
  allSubstatRollBounds,
  ENERGY_REGEN,
  IDEAL_SUBSTAT_SLOTS,
  MAX_SUBSTAT_SLOTS_PER_KEY as MAX_SUB_SLOTS,
  substatKeysForResonator as subKeysForRes,
} from '@/data/scoring/substatMath'

export interface SubstatBenchRow {
  id: 'base' | 'floor' | 'ceiling'
  label: string
  damage: number             // total build damage (reference)
  substatDmg: number         // damage this build's substats contribute over no substats
  substatPct: number         // that contribution as a percent of the build's total damage
  vsBaseSubPct: number       // substat contribution relative to the current build's substats
}

export interface SubstatIdealEntry {
  key: string
  count: number
  min: number
  max: number
}

export interface SubstatBenchmark {
  rows: SubstatBenchRow[]
  ideal: SubstatIdealEntry[]
  slots: number              // total ideal rolls actually allocated (<= 25)
  reservedEr: number         // ER rolls preserved from the current build
}

// benchmark the current build against a build wearing the optimal 25 substats
// evaluated at their lowest and highest roll values.
export function calcSubBench(
    ctx: SuggestContext,
    equipped: Array<EchoInstance | null>,
): SubstatBenchmark | null {
  const echoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  if (echoes.length === 0) {
    return null
  }

  const mainEchoBuffs = mkSuggMainEc(ctx, equipped)
  const { stats, sets, kinds } = encEchoRows(echoes, ctx.selectedSkill, 'self')
  const comboIds = Int32Array.from(echoes.map((_, index) => index))
  const mainIndex = Math.max(0, echoes.findIndex((echo) => echo.mainEcho))
  const score = (buffer: Float32Array) =>
      scoreStats(ctx, buffer, sets, kinds, comboIds, mainEchoBuffs, mainIndex)

  const baseDamage = score(stats)

  // strip every current substat to get the build's main-stat-only baseline,
  // the common reference every substat contribution is measured against.
  const { totals } = aggregateSubstats(echoes)
  const mainOnly = stats.slice()
  for (const [key, value] of Object.entries(totals)) {
    addEchoStat(mainOnly.subarray(0, ECHO_STAT_STRIDE), key, -value)
  }
  const mainOnlyDamage = score(mainOnly)

  const bounds = allSubstatRollBounds()
  const usefulKeys = subKeysForRes(ctx.runtime.id)

  // build the damage-optimal 25 substats at a fixed roll quality. floor and
  // ceiling are optimized independently because the best mix shifts with roll
  // size (e.g. more crit rate fits before the cap at low rolls, and energy regen
  // needs more low rolls to hit its target). energy regen earns ~0 damage, so we
  // reserve just enough rolls at this quality to cover the build's ER first.
  const buildOptimal = (rollOf: (key: string) => number) => {
    const counts: Record<string, number> = {}
    const working = mainOnly.slice()

    const erRoll = rollOf(ENERGY_REGEN)
    const erTarget = usefulKeys.includes(ENERGY_REGEN) ? (totals[ENERGY_REGEN] ?? 0) : 0
    const reservedEr = erRoll > 0
        ? Math.min(Math.ceil(erTarget / erRoll), MAX_SUB_SLOTS)
        : 0
    if (reservedEr > 0) {
      counts[ENERGY_REGEN] = reservedEr
      addEchoStat(working.subarray(0, ECHO_STAT_STRIDE), ENERGY_REGEN, erRoll * reservedEr)
    }
    let workingDamage = score(working)

    // each step adds the roll with the highest current marginal damage, re-scored
    // every time so crit-cap and crit coupling stay accurate at this roll size.
    for (let slot = reservedEr; slot < IDEAL_SUBSTAT_SLOTS; slot += 1) {
      let bestKey: string | null = null
      let bestGain = 0
      for (const key of usefulKeys) {
        const roll = rollOf(key)
        if ((counts[key] ?? 0) >= MAX_SUB_SLOTS || roll <= 0) {
          continue
        }
        const trial = working.slice()
        addEchoStat(trial.subarray(0, ECHO_STAT_STRIDE), key, roll)
        const gain = score(trial) - workingDamage
        if (gain > bestGain) {
          bestGain = gain
          bestKey = key
        }
      }
      if (!bestKey) {
        break
      }
      counts[bestKey] = (counts[bestKey] ?? 0) + 1
      addEchoStat(working.subarray(0, ECHO_STAT_STRIDE), bestKey, rollOf(bestKey))
      workingDamage += bestGain
    }

    return { damage: score(working), counts, reservedEr }
  }

  const floorBuild = buildOptimal((key) => bounds[key].min)
  const ceilBuild = buildOptimal((key) => bounds[key].max)

  const baseSub = baseDamage - mainOnlyDamage
  const mkRow = (id: SubstatBenchRow['id'], label: string, damage: number): SubstatBenchRow => {
    const substatDmg = damage - mainOnlyDamage
    return {
      id,
      label,
      damage,
      substatDmg,
      substatPct: damage > 0 ? (substatDmg / damage) * 100 : 0,
      vsBaseSubPct: baseSub > 0 ? (substatDmg / baseSub - 1) * 100 : 0,
    }
  }

  // the max-roll build is the realistic target you farm toward, so its
  // distribution is the one surfaced as the ideal set.
  const ideal = Object.entries(ceilBuild.counts)
      .map(([key, count]) => ({ key, count, min: bounds[key].min, max: bounds[key].max }))
      .sort((left, right) => right.count - left.count || right.max - left.max)

  return {
    rows: [
      mkRow('base', 'Current build', baseDamage),
      mkRow('floor', 'Ideal · min values', floorBuild.damage),
      mkRow('ceiling', 'Ideal · max values', ceilBuild.damage),
    ],
    ideal,
    slots: Object.values(ceilBuild.counts).reduce((sum, count) => sum + count, 0),
    reservedEr: ceilBuild.reservedEr,
  }
}
