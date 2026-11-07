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

// one stack per distinct member with a tune strain response, plus the enemy's
// intrinsic limit.
export function getTuneStrainMaxForMembers(
  memberIds: readonly string[],
  enemy?: Pick<EnemyProfile, 'id'> | null,
): number {
  const enemyBonus = enemy ? getGameData().sourcesByKey[`enemy:${enemy.id}`]?.tuneStrainMaxBonus ?? 0 : 0
  return BASE_TUNE_STRAIN_MAX + [...new Set(memberIds)].filter((memberId) => hasTuneStrainResponseTag(memberId)).length + enemyBonus
}

export function getTuneStrainMaxForTeam(
  runtime: Pick<ResRuntime, 'id' | 'build'> | null | undefined,
  enemy?: Pick<EnemyProfile, 'id'> | null,
): number {
  if (!runtime) {
    return getTuneStrainMaxForMembers([], enemy)
  }

  // the active runtime counts once even when it is also listed in the team slots.
  return getTuneStrainMaxForMembers([
    runtime.id,
    ...runtime.build.team.filter((memberId): memberId is string => Boolean(memberId)),
  ], enemy)
}
