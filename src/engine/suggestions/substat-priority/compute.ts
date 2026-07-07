/*
  Author: Runor Ewhro
  Description: measures how a single substat roll added to, removed from, or
               fully stripped out of the current build changes target damage,
               producing per-substat gain and loss figures for the priority view.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { ECHO_STAT_STRIDE } from '@/engine/optimizer/config/constants'
import { addEchoStat, encEchoRows } from '@/engine/optimizer/encode/echoes'
import { mkSuggMainEc } from '@/engine/suggestions/shared'
import type { SuggestContext } from '@/engine/suggestions/types'
import { scoreStats } from '@/data/scoring/benchmark/scoring'
import {
  aggregateSubstats,
  MAX_SUBSTAT_SLOTS_PER_KEY as MAX_SUB_SLOTS,
  substatKeysForResonator as subKeysForRes,
  substatQuality,
  substatRollBounds,
} from '@/data/scoring/substatMath'

export interface SubstatEntry {
  key: string
  rollStep: number
  present: boolean
  rollCount: number            // how many echoes carry this substat (one slot each)
  total: number                // aggregated stat amount across the build
  quality: number              // total vs the max for that many slots, as a percent
  // the actual stat amounts the add / remove columns applied, after clamping to
  // the five-slot value headroom (add) and the current total (remove)
  addAmount: number
  removeAmount: number
  // damage figures, all in the same unit the suggestion context scores in
  addRoll: number              // gain from adding the requested steps
  removeRoll: number           // loss from removing the requested steps (0 if absent)
  contribution: number         // loss from removing every current slot (0 if absent)
  contributionPerRoll: number
  // the same figures expressed against current build damage
  addRollPct: number
  removeRollPct: number
  contributionPct: number
}

// build the per-substat gain/loss table for the current equipped loadout.
// steps is how many tuning steps the add / remove columns simulate at once
// (1..n); each substat is clamped to its own value headroom rather than a hard
// step cap, so adding enough steps always reaches its ceiling and stops there.
export function calcSubPrio(
    ctx: SuggestContext,
    equipped: Array<EchoInstance | null>,
    steps = 1,
): SubstatEntry[] {
  const echoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  if (echoes.length === 0) {
    return []
  }

  const stepSpan = Math.max(1, Math.floor(steps))

  // main-echo buffs depend only on echo identity, not substats, so build once
  const mainEchoBuffs = mkSuggMainEc(ctx, equipped)
  const { stats, sets, kinds } = encEchoRows(echoes, ctx.selectedSkill, 'self')
  const comboIds = Int32Array.from(echoes.map((_, index) => index))
  const mainIndex = Math.max(0, echoes.findIndex((echo) => echo.mainEcho))

  const base = scoreStats(ctx, stats, sets, kinds, comboIds, mainEchoBuffs, mainIndex)
  const pct = (delta: number) => (base > 0 ? (delta / base) * 100 : 0)

  const { totals, counts } = aggregateSubstats(echoes)
  const keys = subKeysForRes(ctx.runtime.id)

  return keys.map((key) => {
    const bounds = substatRollBounds(key)
    const step = bounds.step
    const total = totals[key] ?? 0
    const rollCount = counts[key] ?? 0
    const present = rollCount > 0

    // best legal single value, used to express the build amount as a quality ratio
    const maxRoll = bounds.max
    const quality = substatQuality(total, rollCount, maxRoll)

    // rows are summed before the damage formula, so a row delta shifts the build
    // total by exactly that amount. adding is clamped to the remaining headroom
    // below the five-slot value ceiling, so adding more steps than fit just lands
    // exactly at the ceiling; removing is clamped to what is actually there, so an
    // absent substat loses nothing.
    const maxTotal = maxRoll * MAX_SUB_SLOTS
    const addAmount = Math.max(0, Math.min(step * stepSpan, maxTotal - total))
    let addRoll = 0
    if (addAmount > 0) {
      const up = stats.slice()
      addEchoStat(up.subarray(0, ECHO_STAT_STRIDE), key, addAmount)
      addRoll = scoreStats(ctx, up, sets, kinds, comboIds, mainEchoBuffs, mainIndex) - base
    }

    let removeRoll = 0
    let removeAmount = 0
    let contribution = 0
    if (present) {
      removeAmount = Math.min(step * stepSpan, total)
      const down1 = stats.slice()
      addEchoStat(down1.subarray(0, ECHO_STAT_STRIDE), key, -removeAmount)
      removeRoll = base - scoreStats(ctx, down1, sets, kinds, comboIds, mainEchoBuffs, mainIndex)

      const downAll = stats.slice()
      addEchoStat(downAll.subarray(0, ECHO_STAT_STRIDE), key, -total)
      contribution = base - scoreStats(ctx, downAll, sets, kinds, comboIds, mainEchoBuffs, mainIndex)
    }

    return {
      key,
      rollStep: step,
      present,
      rollCount,
      total,
      quality,
      addAmount,
      removeAmount,
      addRoll,
      removeRoll,
      contribution,
      contributionPerRoll: rollCount > 0 ? contribution / rollCount : 0,
      addRollPct: pct(addRoll),
      removeRollPct: pct(removeRoll),
      contributionPct: pct(contribution),
    }
  })
}
