/*
  Author: Runor Ewhro
  description: the BuildSnapshot document: exactly what a kuro card shows,
               stored per read. nothing is maxed or derived here; scoring
               normalizes later, so a new scoring rule never needs a re-read.
*/

/** a stat as printed on the card, keyed by the app's canonical stat keys. */
export interface SnapshotStat {
  key: string
  value: number
}

export interface SnapshotEcho {
  /** card position 0-4. */
  slot: number
  id: string
  /** sonata set id. */
  set: number
  mainEcho: boolean
  main: {
    primary: SnapshotStat
    secondary: SnapshotStat
  }
  /** substat key to displayed value, as in EchoInstance.substats. */
  substats: Record<string, number>
}

export interface BuildSnapshotV1 {
  v: 1
  /** game data version the parser resolved ids against. */
  gameVer: string
  uid: string
  name: string | null
  resonator: {
    id: string
    /** null when unreadable; scoring maxes levels, so it never blocks a read. */
    level: number | null
    sequence: number
    /** core skill levels as read; display only, scoring maxes them. */
    skillLevels: Record<string, number | null>
  }
  /** stored for display; scenarios replace it when scoring. the card does not
      show refinement, so there is no rank. */
  weapon: {
    id: string
    level: number | null
  }
  echoes: SnapshotEcho[]
}

/** every stored version; readers switch on `v` and never rewrite old rows. */
export type BuildSnapshot = BuildSnapshotV1
