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
  baselineDamage: number
  benchDamage: number
  perfectDamage: number
  /** generated rotation hash for each reference build. */
  programs: { baseline: string; bench: string; perfect: string }
}

/** rulesets/<id>/refs.json, written by the offline reference step. */
export interface RulesetRefsFile {
  schema: 2
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
    /** the fixed teammate builds (scripts/leaderboard/data/teammate-builds.json). */
    teammates: string
    /** null until the offline reference search completes. */
    refs: string | null
    /** folder of offline anchors, one file per scenario (anchors/<resonator>/<team>-<weapon>.json); absent or null when
            the ruleset has none and every score searches its own anchors. */
    anchors?: string | null
    /** the package's unit hashes (scripts/anchorgen/deps/units.mjs), written with the anchors. */
    units?: string | null
    /** snapshot of the game data the ruleset was built against. */
    gameData: string
    /** character interpretation facts/rules and gear parameter snapshots. */
    interpreter: string
  }
  /** every packaged file except manifest.json; SHA-256 is over its exact stored bytes. */
  hashes: Record<string, { sha256: string; bytes: number }>
  scenarios: ScenarioDef[]
}

/** one energy regen state of a scenario and sequence: the three anchors a build there is scored against. */
export interface AnchorState {
  /** the reference builds' final energy regen; null when energy regen is not a requirement. */
  er: number | null
  baseline: number
  bench: number
  perfect: number
  /** false when the formula behind it missed its engine checks; such a state is not used. */
  exact: boolean
}

/** anchors/<resonator>/<team>-<weapon>.json, written by scripts/anchorgen. */
export interface ScenarioAnchorsFile {
  schema: 1
  /** the scenario id without its ruleset: <resonator>:<team>:<weapon>. */
  scenario: string
  /** need: one state per 0.4% of final energy regen in the team's range; search and none: one state. */
  mode: 'need' | 'search' | 'none'
  sequences: Record<string, {
    states: AnchorState[]
    /** search: the minimum final energy regen of the reference builds (anchorgen `--needs`); absent in rulesets packaged
            before it was recorded, and for need (its lowest state) and none. */
    floor?: number | null
  }>
}
