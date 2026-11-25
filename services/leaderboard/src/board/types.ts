/*
  Author: Runor Ewhro
  description: board inputs and outputs: write inputs, write results and the
               outbox ops sent to D1. everything here crosses a Durable Object
               RPC, so it is plain structured-clone-safe data with no classes.
*/

import type { PageRow } from './reads.ts'

export type Lane = 'interactive' | 'bulk'

/** player fields a board stores; D1 stores the player, and `ver` orders the copies. */
export interface PlayerFacts {
  uid: number
  name: string | null
  /** the uid's server digit (5-9), or null. */
  region: number | null
  hideUid: boolean
  /** anonymous or a setup filler: shown as anon, region only. */
  masked: boolean
  /** opted out or banned: none of their builds is listed. */
  unlisted: boolean
  ver: number
}

/** one scenario of a resonator on a ruleset, as the catalog numbers it. */
export interface CellDef {
  cell: number
  /** the scenario id without its ruleset prefix: '<resonator>:<team>:<weapon>'. */
  key: string
  teamId: string
  teamKey: string
  teamRank: number
  weaponId: number
  weaponRank: number
  weaponRole: string
  members: string[]
  /** a rollout may offer this cell's old score (true unless its sample check found it scores differently now), or
      'program': only where the build's program is the one it had (the new scorer changed only the generator). */
  reuse?: boolean | 'program'
}

export interface RulesetInstall {
  rs: number
  id: string
  cells: CellDef[]
  /** for a rollout: the ruleset whose scores the fan-out offers the scorer to keep (scorer/reuse.ts), or none. */
  reuseFrom?: number | null
}

/** a build's score on a rollout's source ruleset, offered to the scorer to keep. */
export interface OldCell {
  /** the scenario key ('<resonator>:<team>:<weapon>'), the same on both rulesets. */
  key: string
  status: 'ok' | 'unsupported'
  score: number | null
  damage: number | null
  dpr: number | null
  flags: number
  reason: string | null
  /** the scored seat's stats with the scenario weapon (lib/statsPack.ts), or null. */
  stats: Uint8Array | null
  /** kept only where the build's program is unchanged (CellDef.reuse 'program'). */
  program?: true
}

/** a fan-out order the scorer first tries to answer from the old ruleset's scores. */
export interface ReuseOffer {
  from: number
  fromId: string
  /** the ruleset whose detail object has the old job's detail: fromId, or the earlier ruleset fromId kept it from. */
  detailId: string
  old: OldCell[]
}

/** a scoring order from the board: these cells of this build on this ruleset. */
export interface JobOrder {
  rs: number
  rulesetId: string
  local: number
  gen: number
  lane: Lane
  cells: Array<{ cell: number; key: string }>
  /** for a rollout's fan-out: old scores the scorer may keep without scoring. */
  reuse?: ReuseOffer
}

/** one group message's worth of staged bulk work: builds sharing a scenario cell and a program key. */
export interface GroupOrder {
  rs: number
  rulesetId: string
  cell: number
  key: string
  /** cs: the scorer also measures the card's own stats (the live ruleset's first cell of the job). */
  builds: Array<{ local: number; gen: number; cs: boolean }>
}

/** job cells a reuse message did not keep, returned to the board for group scoring. */
export interface RescoreRequest {
  rs: number
  local: number
  gen: number
  cells: number[]
}

export interface PlaceInput {
  uid: number
  player: PlayerFacts
  /** the card's id (registry), kept for status and history. */
  card: string
  /** the packed snapshot (lib/snapshotPack.ts). */
  snap: Uint8Array
  /** hex sha256 of the snapshot's scoring fields (ingest.ts snapshotHash). */
  snapHash: string
  seq: number
  drawnAt: number
  /** the submitter proved control of this uid. */
  owner: boolean
  /** the uid was a setup filler until this submission: a build already stored counts as uploaded now. */
  claimSetup?: boolean
  now: number
}

export interface Placement {
  local: number
  /** whether it is kept (every kept build is ranked as itself). */
  active: boolean
  /** the same snapshot was already stored; only last_seen_at moved. */
  repeated: boolean
  claimed?: boolean
}

export interface PlaceResult {
  placement: Placement
  /** scoring to send now. */
  jobs: JobOrder[]
}

export type CellStatus = 'ok' | 'unsupported' | 'error'

/** one scored cell, as the scorer reports it. */
export interface CellResult {
  rs: number
  local: number
  gen: number
  cell: number
  status: CellStatus
  score: number | null
  damage: number | null
  dpr: number | null
  flags: number
  reason: string | null
  /** the scenario weapon's id and the scored seat's stats with it (packed, lib/statsPack.ts). */
  weapon: number
  stats: Uint8Array | null
  /** the build's own card stats, sent with its first result. */
  cardStats?: Uint8Array | null
  /** the cell's detail, as json text: contribution, seat, anchors, deps, program (detail.ts). */
  detail: string | null
  /** set when a rollout kept every cell of the job: the job has no detail and reads this ruleset's object. */
  detailFrom?: string
  timing?: CellTiming
}

export interface CellTiming {
  lane: Lane
  runner: string
  ms: number
  wallMs: number | null
  stages: string | null
  anchorSource: string | null
}

export type RecordAck = 'counted' | 'upgraded' | 'kept' | 'stale'

export interface RecordResult {
  acks: RecordAck[]
  /** jobs that finished in this call and whose detail object is to be written. */
  finished: Array<{ rs: number; local: number; gen: number }>
}

/** a board's first row in D1's boards index (`boards.head`): a page row with base64 packed stats. */
export type HeadRow = Omit<PageRow, 'stats'> & { stats: string | null }

/** a board's change for D1 to apply (src/api/projections.ts), in order, once. */
export type OutboxOp =
  | { op: 'player_board'; uid: number; standing: number; active: number | null; listed: number | null; listedAt: number | null; seq: number | null }
  | { op: 'upload'; gbid: number; uid: number; at: number; shown: boolean }
  | { op: 'board'; rulesetId: string; total: number; top: number[]; topQ: number | null; head: HeadRow | null; at: number }
  | { op: 'notify'; kind: 'dethroned' | 'scored'; uid: number; subject: number; build: number; actorUid: number | null
      data: Record<string, unknown>; at: number }
  | { op: 'build_gone'; gbid: number }

/** one seeded build (test data, api/moderation/seed.ts), at a local in its batch's range. */
export interface SeedBuild {
  local: number
  uid: number
  seq: number
  card: string
  snap: Uint8Array
  snapHash: string
  drawnAt: number
  at: number
  /** written mode on the live ruleset: every cell's modelled score by scenario key; null for scorer scoring. */
  scores: Array<{ key: string; score: number; damage: number; dpr: number }> | null
  /** the best cell's stats with its weapon (packed, lib/statsPack.ts), or null. */
  stats: Uint8Array | null
}

export interface SeedInput {
  /** the batch's locals: every build is one of them. */
  range: [number, number]
  players: PlayerFacts[]
  builds: SeedBuild[]
  now: number
}

/** D1 rows of a seeded chunk, written by the seed route directly (batches of millions would overload the outbox). */
export interface SeedPlaced {
  inserted: number
  players: Array<Omit<Extract<OutboxOp, { op: 'player_board' }>, 'op'>>
  uploads: Array<Omit<Extract<OutboxOp, { op: 'upload' }>, 'op'>>
  /** scoring to send now (builds without scores). */
  orders: JobOrder[]
}

export interface SeedPurged {
  builds: number
  players: number
  /** builds of the range whose detail objects are in R2, by ruleset id. */
  detail: Array<{ rulesetId: string; local: number }>
}
