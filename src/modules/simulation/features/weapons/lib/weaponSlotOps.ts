/*
  Author: Runor Ewhro
  Description: the writes a weapon slot takes: picking a weapon, and setting its
               syntonize rank. The pane and the weapon console both stand on
               this, so a pick means the same thing wherever it is made.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { GenWpn } from '@/domain/entities/weapon.ts'
import { initWpnStts, maxWpnRt } from '@/domain/state/sourceStateInit.ts'
import { weaponStatsAt } from '@/modules/simulation/features/weapons/lib/weapon.ts'
import { clampNumber } from '@/shared/lib/number.ts'

export const WPN_RANK_MIN = 1
export const WPN_RANK_MAX = 5

/*
  a picked weapon lands at rank one, and either at the level the slot already
  held or at the ceiling when the user has asked for maxed picks. the states the
  old weapon owned leave with it, which is what initWpnStts/maxWpnRt settle.
*/
export function applyWpnSel(
  runtime: ResRuntime,
  weapon: GenWpn,
  options: { maxOnInit: boolean; level: number },
): ResRuntime {
  const nextLevel = options.maxOnInit ? 90 : options.level
  const stats = weaponStatsAt(weapon, nextLevel)
  const prevWpnId = runtime.build.weapon.id

  const nextRuntime: ResRuntime = {
    ...runtime,
    build: {
      ...runtime.build,
      weapon: {
        ...runtime.build.weapon,
        id: weapon.id,
        level: nextLevel,
        baseAtk: stats.atk,
        rank: WPN_RANK_MIN,
      },
    },
  }

  return options.maxOnInit
    ? maxWpnRt(nextRuntime, { targetRank: WPN_RANK_MIN, prevWpnId })
    : initWpnStts(nextRuntime, { weaponId: weapon.id, prevWpnId, maxed: false })
}

export function setWpnRank(runtime: ResRuntime, rank: number): ResRuntime {
  const nextRank = clampNumber(Math.round(rank), WPN_RANK_MIN, WPN_RANK_MAX)
  if (nextRank === runtime.build.weapon.rank) {
    return runtime
  }

  return {
    ...runtime,
    build: {
      ...runtime.build,
      weapon: { ...runtime.build.weapon, rank: nextRank },
    },
  }
}
