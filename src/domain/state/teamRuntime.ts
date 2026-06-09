/*
  Author: Runor Ewhro
  Description: Shared helpers for compacting and namespacing teammate runtime state.
*/

import type { ResRuntime, TeamMemRt } from '@/domain/entities/runtime'
import { cloneEchoLdt } from '@/domain/entities/inventoryStorage'
import { cloneBuffs } from '@/domain/state/runtimeCloning'
import { catTmWpnAtk } from '@/domain/state/weaponState'

// compacts a materialized teammate runtime back into the lightweight persisted form.
export function teamRuntime(runtime: ResRuntime): TeamMemRt {
  return {
    id: runtime.id,
    base: {
      sequence: runtime.base.sequence,
    },
    build: {
      weapon: catTmWpnAtk(runtime.build.weapon, 90),
      echoes: cloneEchoLdt(runtime.build.echoes),
    },
    manualBuffs: cloneBuffs(runtime.state.manualBuffs),
  }
}

// rewrites the namespaced teammate controls after that teammate runtime changes.
export function mkMateCntr(
  prevControls: Record<string, boolean | number | string>,
  memberIdsClear: string[],
  nextMemberId: string,
  nextRuntime: ResRuntime,
): Record<string, boolean | number | string> {
  const nextControls: Record<string, boolean | number | string> = {}

  for (const [key, value] of Object.entries(prevControls)) {
    const shouldClear = memberIdsClear.some((memberId) => key.startsWith(`team:${memberId}:`))
    if (!shouldClear) {
      nextControls[key] = value
    }
  }

  for (const [key, value] of Object.entries(nextRuntime.state.controls)) {
    nextControls[`team:${nextMemberId}:${key}`] = value
  }

  return nextControls
}
