/*
  Author: Runor Ewhro
  Description: Builds randomized Echo objects for a cost and main-stat plan by
               assigning fixed secondary stats and distinct sampled substats.
*/

import { ECHO_MAIN_STATS, ECHO_SIDE_STATS, SUBSTAT_KEYS } from '@/data/gameData/catalog/echoStats'
import type { OptStatWeight } from '@/engine/optimizer/search/filtering.ts'
import { getRandSbst, randSubVl } from './substats'

// Zero stays outside the authored set-id range until a plan assigns a real set.
const NO_SET = 255

export interface RandGenEcho {
  cost: number
  setId: number
  primaryKey: string
  primaryValue: number
  secondaryKey: string
  scndVl: number
  substats: Record<string, number>
  mainEcho: boolean
}

export function mkEchoSetFor(params: {
  combination: string[]
  costPlan: number[]
  bias: number
  rollQuality: number
  statWeight: OptStatWeight
}): RandGenEcho[] {
  const { combination, costPlan, bias, rollQuality, statWeight } = params
  const echoes: RandGenEcho[] = []

  const maxSubs = 5
  const allSubKeys = SUBSTAT_KEYS.length

  for (let i = 0; i < costPlan.length; i++) {
    const cost = costPlan[i]
    const primaryKey = combination[i]

    const primaryValue = ECHO_MAIN_STATS[cost]?.[primaryKey] ?? 0

    const secondary = ECHO_SIDE_STATS[cost]

    const substats: Record<string, number> = {}

    // Stop at the normal cap or when no distinct substat key remains.
    while (
        Object.keys(substats).length < maxSubs &&
        Object.keys(substats).length < allSubKeys
        ) {
      const key = getRandSbst(bias, false, statWeight)

      if (!substats[key]) {
        substats[key] = randSubVl(key, rollQuality)
      }
    }

    echoes.push({
      cost,
      setId: NO_SET,
      primaryKey,
      primaryValue,
      secondaryKey: secondary?.key ?? 'atkFlat',
      scndVl: secondary?.value ?? 0,
      substats,
      mainEcho: i === 0,
    })
  }

  return echoes
}
