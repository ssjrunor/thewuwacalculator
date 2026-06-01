/*
  Author: Runor Ewhro
  Description: shared team-target selection helpers for calculator combat
               views and teammate configuration flows.
*/

import type { ResRuntime } from '@/domain/entities/runtime'

// project the active routing choices to each active team member id
export function mkSelTrgtByR(
  team: ResRuntime['build']['team'],
  selTrgtByOwn: Record<string, string | null>,
): Record<string, Record<string, string | null>> {
  // duplicate teammate ids should still share one routing map entry, so reduce
  // through a unique resonator id list before building the lookup object.
  const resonatorIds = Array.from(new Set(team.filter((memberId): memberId is string => Boolean(memberId))))
  return Object.fromEntries(
    resonatorIds.map((resonatorId) => [resonatorId, selTrgtByOwn]),
  )
}
