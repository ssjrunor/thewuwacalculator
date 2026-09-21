/*
  Author: Runor Ewhro
  Description: Resolves the team-wide Tune Strain stack ceiling from resonator
               response tags while keeping the base enemy-state stack separate.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'

export const TUNE_STRAIN_RESPONSE_TAG_ID = 'H1'
export const BASE_TUNE_STRAIN_MAX = 1

export function hasTuneStrainResponseTag(resonatorId: string | null | undefined): boolean {
  if (!resonatorId) {
    return false
  }

  return Boolean(
    getResSeedBy(resonatorId)?.tags?.some((tag) => tag.id === TUNE_STRAIN_RESPONSE_TAG_ID),
  )
}

export function getTuneStrainMaxForTeam(runtime: Pick<ResRuntime, 'id' | 'build'> | null | undefined): number {
  if (!runtime) {
    return BASE_TUNE_STRAIN_MAX
  }

  const memberIds = Array.from(
    new Set([
      runtime.id,
      ...runtime.build.team.filter((memberId): memberId is string => Boolean(memberId)),
    ]),
  )

  return BASE_TUNE_STRAIN_MAX + memberIds.filter((memberId) => hasTuneStrainResponseTag(memberId)).length
}
