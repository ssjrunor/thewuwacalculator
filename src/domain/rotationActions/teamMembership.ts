/*
  Author: Runor Ewhro
  description: lists the teams a resonator can be scored on from the authored
               team plans.
*/

import { canonicalResonatorId } from './identities.ts'

/** the authored ranked teams first, then every other team seating this member, in numeric order. */
export function teamsForResonator(
  resonatorId: string,
  ranked: readonly string[],
  teams: Record<string, readonly { resonatorId: string }[]>,
): string[] {
  const id = canonicalResonatorId(resonatorId)
  const seatsMember = (team: string) => teams[team]?.some(seat => canonicalResonatorId(seat.resonatorId) === id)
  for (const team of ranked) if (!seatsMember(team)) throw new Error(`${team} does not seat ${resonatorId}`)
  return [...new Set([...ranked, ...Object.keys(teams).filter(seatsMember)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))])]
}
