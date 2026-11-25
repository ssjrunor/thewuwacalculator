/*
  Author: Runor Ewhro
  description: shares verified rotation coverage across every context and configured weapon of a team.
*/

import type { ScenarioDef } from '@/domain/leaderboard/ruleset'
import teams from '@/data/leaderboard/verifiedTeams.generated.json'

const verified = new Set(teams)

// a team id identifies the same authored composition, modes and rotation on every board
export function hasScoringData(def: Pick<ScenarioDef, 'resonatorId' | 'teamId' | 'weapon'>): boolean {
  return verified.has(def.teamId)
}
