/*
  Author: Runor Ewhro
  Description: Builds cached team composition summaries with member,
               attribute, and weapon-type counts for team-based logic.
*/

import type { AttributeKey } from '@/domain/entities/stats'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'

const ATTR_KEYS: AttributeKey[] = [
  'aero',
  'glacio',
  'spectro',
  'fusion',
  'electro',
  'havoc',
  'physical',
]

export interface TeamCmpsMemI {
  id: string
  attribute: AttributeKey
  weaponType: number
}

export interface TeamCmpsInfo {
  ids: string[]
  size: number
  presenceById: Record<string, boolean>
  membersById: Record<string, TeamCmpsMemI>
  attributeCounts: Record<AttributeKey, number>
  weaponTypeCounts: Record<string, number>
}

// cache computed team composition summaries by team signature
const teamCmpsCch = new Map<string, TeamCmpsInfo>()
const MAX_TEAM_COMPS = 64

function tchTeamCmpsC(signature: string, info: TeamCmpsInfo): void {
  if (teamCmpsCch.has(signature)) {
    teamCmpsCch.delete(signature)
  }

  teamCmpsCch.set(signature, info)

  while (teamCmpsCch.size > MAX_TEAM_COMPS) {
    const oldestKey = teamCmpsCch.keys().next().value
    if (oldestKey == null) {
      break
    }

    teamCmpsCch.delete(oldestKey)
  }
}

// build a normalized team composition summary from member ids
export function makeTeamComp(memberIds: string[]): TeamCmpsInfo {
  const ids = Array.from(new Set(memberIds.filter(Boolean)))
  const signature = ids.join('|')
  const cached = teamCmpsCch.get(signature)

  if (cached) {
    return cached
  }

  const presenceById = Object.fromEntries(ids.map((id) => [id, true])) as Record<string, boolean>
  const membersById: Record<string, TeamCmpsMemI> = {}
  const ttrbCnts = Object.fromEntries(
      ATTR_KEYS.map((attribute) => [attribute, 0]),
  ) as Record<AttributeKey, number>
  const wpnTypeCnts: Record<string, number> = {}

  for (const id of ids) {
    const resonator = getResSeedBy(id)
    if (!resonator) {
      continue
    }

    membersById[id] = {
      id,
      attribute: resonator.attribute,
      weaponType: resonator.weaponType,
    }
    ttrbCnts[resonator.attribute] += 1
    wpnTypeCnts[String(resonator.weaponType)] = (wpnTypeCnts[String(resonator.weaponType)] ?? 0) + 1
  }

  const info = {
    ids,
    size: ids.length,
    presenceById,
    membersById,
    attributeCounts: ttrbCnts,
    weaponTypeCounts: wpnTypeCnts,
  }

  tchTeamCmpsC(signature, info)
  return info
}
