/*
  Author: Runor Ewhro
  description: builds scenario definitions for each scored resonator, team, weapon, and seat mode.
*/

import type { ScenarioDef, ScenarioMember, WeaponRole } from '@/domain/leaderboard/ruleset'
import { canonicalResonatorId } from './scenarioInput'
import { teamSlotKey } from './teammateBuilds'

/** services/leaderboard/data/scenarios.json */
export interface ScenariosFile {
  schema: 1
  /** team id -> its seats in rotation order. */
  teams: Record<string, Array<{ resonatorId: string; mode: string | null }>>
  /** scored resonator -> its teams (best first) and the weapons it is scored with. */
  resonators: Record<string, {
    teams: string[]
    weapons: Array<{ id: string; rank: number; role: WeaponRole }>
  }>
}

export interface ScenarioDefsInput {
  rulesetId: string
  scenarios: ScenariosFile
  /** sha-256 of each team's rotation recipe. */
  recipeHashes: Record<string, string>
}

export function scenarioDefs({ rulesetId, scenarios, recipeHashes }: ScenarioDefsInput): ScenarioDef[] {
  const defs: ScenarioDef[] = []
  for (const [resonatorId, entry] of Object.entries(scenarios.resonators)) {
    const scored = canonicalResonatorId(resonatorId)
    entry.teams.forEach((teamId, teamIndex) => {
      const seats = scenarios.teams[teamId]
      if (!seats) throw new Error(`Unknown team ${teamId} for ${resonatorId}`)
      const hash = recipeHashes[teamId]
      if (!hash) throw new Error(`No recipe hash for team ${teamId}`)
      const members: ScenarioMember[] = seats.map((seat, slot) => {
        const isContext = canonicalResonatorId(seat.resonatorId) === scored
        return {
          slot: slot as 0 | 1 | 2,
          resonatorId: seat.resonatorId,
          mode: seat.mode,
          teamSlot: isContext ? null : teamSlotKey(teamId, slot),
          isContext,
        }
      })
      if (members.filter((member) => member.isContext).length !== 1) {
        throw new Error(`Team ${teamId} does not seat ${resonatorId} exactly once`)
      }
      const teamKey = seats.map((seat) => canonicalResonatorId(seat.resonatorId)).sort().join('-')
      for (const weapon of entry.weapons) {
        defs.push({
          id: `${rulesetId}:${scored}:${teamId}:${weapon.id}`,
          resonatorId: scored,
          teamId,
          recipeSha256: hash,
          teamKey,
          teamRank: teamIndex + 1,
          members,
          weapon: { id: weapon.id, rank: weapon.rank, role: weapon.role },
        })
      }
    })
  }
  return defs
}
