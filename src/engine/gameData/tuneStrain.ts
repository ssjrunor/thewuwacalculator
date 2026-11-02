/*
  Author: Runor Ewhro
  description: resolves the tune strain stack ceiling from team response tags
               and intrinsic enemy stack-limit increases.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import type { EnemyProfile } from '@/domain/entities/appState'
import { getGameData } from '@/data/gameData'

// catalog tag identifying a team member with a tune strain response.
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

export function getTuneStrainMaxForTeam(
  runtime: Pick<ResRuntime, 'id' | 'build'> | null | undefined,
  enemy?: Pick<EnemyProfile, 'id'> | null,
): number {
  const enemyBonus = enemy ? getGameData().sourcesByKey[`enemy:${enemy.id}`]?.tuneStrainMaxBonus ?? 0 : 0
  if (!runtime) {
    return BASE_TUNE_STRAIN_MAX + enemyBonus
  }

  // count each team member once, including the active runtime when it is also
  // listed in the team slots; add the enemy's intrinsic limit separately.
  const memberIds = Array.from(
    new Set([
      runtime.id,
      ...runtime.build.team.filter((memberId): memberId is string => Boolean(memberId)),
    ]),
  )

  return BASE_TUNE_STRAIN_MAX + memberIds.filter((memberId) => hasTuneStrainResponseTag(memberId)).length + enemyBonus
}
