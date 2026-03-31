/*
  Author: Runor Ewhro
  Description: Builds cached team composition summaries with member,
               attribute, and weapon-type counts for team-based logic.
*/

import type { AttributeKey } from '@/domain/entities/stats'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'

const ATTRIBUTE_KEYS: AttributeKey[] = [
  'aero',
  'glacio',
  'spectro',
  'fusion',
  'electro',
  'havoc',
  'physical',
]

export interface TeamCompositionMemberInfo {
  id: string
  attribute: AttributeKey
  weaponType: number
}

export interface TeamCompositionInfo {
  ids: string[]
  size: number
  presenceById: Record<string, boolean>
  membersById: Record<string, TeamCompositionMemberInfo>
  attributeCounts: Record<AttributeKey, number>
  weaponTypeCounts: Record<string, number>
}

// cache computed team composition summaries by team signature
const teamCompositionCache = new Map<string, TeamCompositionInfo>()
const MAX_TEAM_COMPOSITION_CACHE_ENTRIES = 64

function touchTeamCompositionCache(signature: string, info: TeamCompositionInfo): void {
  if (teamCompositionCache.has(signature)) {
    teamCompositionCache.delete(signature)
  }

  teamCompositionCache.set(signature, info)

  while (teamCompositionCache.size > MAX_TEAM_COMPOSITION_CACHE_ENTRIES) {
    const oldestKey = teamCompositionCache.keys().next().value
    if (oldestKey == null) {
      break
    }

    teamCompositionCache.delete(oldestKey)
  }
}

// build a normalized team composition summary from member ids
export function buildTeamCompositionInfo(memberIds: string[]): TeamCompositionInfo {
  const ids = Array.from(new Set(memberIds.filter(Boolean)))
  const signature = ids.join('|')
  const cached = teamCompositionCache.get(signature)

  if (cached) {
    return cached
  }

  const presenceById = Object.fromEntries(ids.map((id) => [id, true])) as Record<string, boolean>
  const membersById: Record<string, TeamCompositionMemberInfo> = {}
  const attributeCounts = Object.fromEntries(
      ATTRIBUTE_KEYS.map((attribute) => [attribute, 0]),
  ) as Record<AttributeKey, number>
  const weaponTypeCounts: Record<string, number> = {}

  for (const id of ids) {
    const resonator = getResonatorSeedById(id)
    if (!resonator) {
      continue
    }

    membersById[id] = {
      id,
      attribute: resonator.attribute,
      weaponType: resonator.weaponType,
    }
    attributeCounts[resonator.attribute] += 1
    weaponTypeCounts[String(resonator.weaponType)] = (weaponTypeCounts[String(resonator.weaponType)] ?? 0) + 1
  }

  const info = {
    ids,
    size: ids.length,
    presenceById,
    membersById,
    attributeCounts,
    weaponTypeCounts,
  }

  touchTeamCompositionCache(signature, info)
  return info
}
