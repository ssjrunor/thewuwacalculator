/*
  Author: Runor Ewhro
  Description: shared team-target selection helpers for calculator combat
               views and teammate configuration flows.
*/

import type { ResonatorRuntimeState } from '@/domain/entities/runtime'

// project the active routing choices to each active team member id
export function buildSelectedTargetsByResonatorId(
  team: ResonatorRuntimeState['build']['team'],
  selectedTargetsByOwnerKey: Record<string, string | null>,
): Record<string, Record<string, string | null>> {
  const resonatorIds = Array.from(new Set(team.filter((memberId): memberId is string => Boolean(memberId))))
  return Object.fromEntries(
    resonatorIds.map((resonatorId) => [resonatorId, selectedTargetsByOwnerKey]),
  )
}
