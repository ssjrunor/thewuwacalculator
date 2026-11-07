/*
  Author: Runor Ewhro
  description: the ruleset documents stored in LB_DATA under rulesets/<id>/.
               a ruleset is immutable once live; any change makes a new one.
*/

export type WeaponRole = 'signature' | 'primary' | 'alternative' | 'standard'

export interface ScenarioMember {
  slot: 0 | 1 | 2
  resonatorId: string
  /** resonance mode this seat plays in; null when the kit has none. */
  mode: string | null
  /** key into teammates.json (`<team>:<seat>`); null for the scored resonator. */
  teamSlot: string | null
  isContext: boolean
}

export interface ScenarioDef {
  /** '<ruleset>:<resonator>:<team>:<weapon>' */
  id: string
  resonatorId: string
  teamId: string
  /** sha-256 of the team's rotation recipe. */
  recipeSha256: string
  /** sorted member ids joined by '-'. */
  teamKey: string
  teamRank: number
  members: ScenarioMember[]
  weapon: {
    id: string
    rank: number
    role: WeaponRole
  }
}

export interface ScenarioRefs {
  scenarioId: string
  sequence: number
  status: 'ok' | 'unsupported'
  baselineDps: number
  benchDps: number
  perfectDps: number
  /** generated rotation hash for each reference build. */
  programs: { baseline: string; bench: string; perfect: string }
}

/** rulesets/<id>/refs.json, written by the offline reference step. */
export interface RulesetRefsFile {
  schema: 1
  refs: ScenarioRefs[]
}

/** rulesets/<id>/manifest.json */
export interface RulesetManifest {
  schema: 1
  id: string
  gameVer: string
  engineVer: string
  rotationVer: string
  dataMode: 'live' | 'beta'
  /** LB_DATA keys, relative to rulesets/<id>/. */
  files: {
    /** team action plans keyed by team id. */
    recipes: string
    /** authored team seats, modes and scenario selections. */
    scenarios: string
    /** the fixed teammate builds (services/leaderboard/data/teammate-builds.json). */
    teammates: string
    /** null until the offline reference search completes. */
    refs: string | null
    /** snapshot of the game data the ruleset was built against. */
    gameData: string
    /** character interpretation facts/rules and gear parameter snapshots. */
    interpreter: string
  }
  /** every packaged file except manifest.json; SHA-256 is over its exact stored bytes. */
  hashes: Record<string, { sha256: string; bytes: number }>
  scenarios: ScenarioDef[]
}
