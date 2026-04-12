import type { ResonatorRuntimeState, TeamMemberRuntime } from '@/domain/entities/runtime'
import { cloneEchoLoadout } from '@/domain/entities/inventoryStorage'
import { cloneManualBuffs } from '@/domain/state/runtimeCloning'

// compacts a materialized teammate runtime back into the lightweight optimizer form.
export function compactTeamMemberRuntime(runtime: ResonatorRuntimeState): TeamMemberRuntime {
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
      echoes: cloneEchoLoadout(runtime.build.echoes),
    },
    manualBuffs: cloneManualBuffs(runtime.state.manualBuffs),
  }
}

// rewrites the namespaced teammate controls after that teammate runtime changes.
export function buildTeammateControls(
  prevControls: Record<string, boolean | number | string>,
  memberIdsToClear: string[],
  nextMemberId: string,
  nextRuntime: ResonatorRuntimeState,
): Record<string, boolean | number | string> {
  const nextControls: Record<string, boolean | number | string> = {}

  for (const [key, value] of Object.entries(prevControls)) {
    const shouldClear = memberIdsToClear.some((memberId) => key.startsWith(`team:${memberId}:`))
    if (!shouldClear) {
      nextControls[key] = value
    }
  }

  for (const [key, value] of Object.entries(nextRuntime.state.controls)) {
    nextControls[`team:${nextMemberId}:${key}`] = value
  }

  return nextControls
}
