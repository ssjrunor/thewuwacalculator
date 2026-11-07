/*
  Author: Runor Ewhro
  description: reads the fixed teammate builds (services/leaderboard/data/teammate-builds.json).
               each resonator lists its stat layouts once; an outfit (sets, main
               echo) on a layout names the team slots (`<team>:<seat>`)
               that wear it. a scenario looks up its two teammates here; only the
               scored seat comes from the card.
*/

export type StatKey = string

export interface TeammateEcho {
  cost: number
  main: [StatKey, number]
  substats: Record<StatKey, number>
}

export interface TeammateOutfit {
  sets: Array<[number, number]>
  mainEcho: string
  /** index of the echo that is the main echo. */
  mainSlot: number
  teams: string[]
}

export interface TeammateLayout {
  weapon: string
  rank: number
  sequence: number
  echoes: TeammateEcho[]
  outfits: TeammateOutfit[]
}

export interface TeammateBuildsFile {
  schema: 1
  source: string
  resonators: Record<string, { builds: TeammateLayout[] }>
}

export interface ResolvedTeammate {
  resonatorId: string
  weapon: { id: string; rank: number }
  sequence: number
  sets: Array<{ id: number; pieces: number }>
  mainEchoId: string
  echoes: Array<TeammateEcho & { mainEcho: boolean }>
}

export const teamSlotKey = (teamId: string, seat: number): string => `${teamId}:${seat}`

/** every team slot to its resonator, layout and outfit. throws on a slot listed twice. */
export function indexTeammateBuilds(file: TeammateBuildsFile): Map<string, ResolvedTeammate> {
  const index = new Map<string, ResolvedTeammate>()
  for (const [resonatorId, entry] of Object.entries(file.resonators)) {
    for (const layout of entry.builds) {
      for (const outfit of layout.outfits) {
        const resolved: ResolvedTeammate = {
          resonatorId,
          weapon: { id: layout.weapon, rank: layout.rank },
          sequence: layout.sequence,
          sets: outfit.sets.map(([id, pieces]) => ({ id, pieces })),
          mainEchoId: outfit.mainEcho,
          echoes: layout.echoes.map((echo, slot) => ({ ...echo, mainEcho: slot === outfit.mainSlot })),
        }
        for (const team of outfit.teams) {
          if (index.has(team)) throw new Error(`Team slot ${team} has two teammate builds`)
          index.set(team, resolved)
        }
      }
    }
  }
  return index
}
