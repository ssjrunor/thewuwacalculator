/*
  Author: Runor Ewhro
  Description: Provides shared team runtime helpers for the optimizer surface.
*/

import type { ResRuntime, TeamMemRt } from '@/domain/entities/runtime.ts'
import { cloneEchoLdt } from '@/domain/entities/inventoryStorage.ts'
import { cloneBuffs } from '@/domain/state/runtimeCloning.ts'

// compacts a materialized teammate runtime back into the lightweight optimizer form.
export function teamRuntime(runtime: ResRuntime): TeamMemRt {
  return {
    id: runtime.id,
    base: {
      sequence: runtime.base.sequence,
    },
    build: {
      weapon: {
        id: runtime.build.weapon.id,
        rank: runtime.build.weapon.rank,
        baseAtk: runtime.build.weapon.baseAtk,
      },
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
