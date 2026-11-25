/*
  Author: Runor Ewhro
  description: lb-score messages and scoring results. a cell message is one
               cell of one build's job (a group message: one cell of many
               builds' jobs) with the sending board, the job generation and the
               build's packed snapshot, so scoring reads nothing else. delivery
               is at least once, and boards count a cell once per generation,
               which makes repeats no-ops. `lane: 'bulk'` uses lb-score-bulk
               (rescores and rollouts), which keeps new player builds ahead of
               bulk work.
*/

import type { BuildStats, ScoredContribution } from '@lb/contract/api'
import type { ScenarioInput } from '@lb/contract/scenarioInput'

export type ScoreLane = 'interactive' | 'bulk'

export interface CellMessage {
  k: 's'
  /** the board: its resonator. */
  res: number
  local: number
  gen: number
  rs: number
  /** the ruleset's id, for its package. */
  rid: string
  cell: number
  /** the scenario id without its ruleset: '<resonator>:<team>:<weapon>'. */
  key: string
  /** absent means interactive. */
  lane?: 'bulk'
  /** the packed snapshot (lib/snapshotPack.ts), base64. */
  snap: string
  /** also compute the card's own stats (set on the job's first cell). */
  cs?: 1
}

/** an old score offered for keeping (board/types.ts OldCell), its stats base64. */
export interface OldCellBody {
  key: string
  status: 'ok' | 'unsupported'
  score: number | null
  damage: number | null
  dpr: number | null
  flags: number
  reason: string | null
  stats: string | null
  /** kept only where the build's program is unchanged: the new scorer differs from the old in its generator alone. */
  program?: true
}

/** a rollout's fan-out of one build: keep scores that match the old ruleset and score the rest. */
export interface ReuseMessage {
  k: 'r'
  res: number
  local: number
  gen: number
  rs: number
  rid: string
  /** the ruleset the old scores are on, by number and id. */
  from: number
  fid: string
  /** the ruleset whose detail object has the old detail, when it is not fid's. */
  did?: string
  lane: 'bulk'
  snap: string
  /** the job's cells, costliest first. */
  cells: Array<{ cell: number; key: string }>
  old: OldCellBody[]
}

/**
 * bulk work for one scenario cell across many builds: the board groups builds sharing a program key
 * (domain/leaderboard/programKey.ts), so the scorer builds the program once and scores each build on it
 * (scoreScenarioGroup). each build is its own job, and results count per build like cell messages.
 */
export interface GroupMessage {
  k: 'g'
  res: number
  rs: number
  rid: string
  cell: number
  key: string
  lane: 'bulk'
  builds: Array<{ local: number; gen: number; snap: string; cs?: 1 }>
}

export type ScoreMessage = CellMessage | ReuseMessage | GroupMessage

const isJob = (message: CellMessage | ReuseMessage) => !!message && Number.isInteger(message.res) && Number.isInteger(message.local) &&
  Number.isInteger(message.gen) && Number.isInteger(message.rs) && typeof message.rid === 'string' && typeof message.snap === 'string'

export function isCellMessage(value: unknown): value is CellMessage {
  const message = value as CellMessage
  return isJob(message) && message.k === 's' && Number.isInteger(message.cell) && typeof message.key === 'string'
}

export function isReuseMessage(value: unknown): value is ReuseMessage {
  const message = value as ReuseMessage
  return isJob(message) && message.k === 'r' && Number.isInteger(message.from) && typeof message.fid === 'string' &&
    Array.isArray(message.cells) && Array.isArray(message.old)
}

export function isGroupMessage(value: unknown): value is GroupMessage {
  const message = value as GroupMessage
  return !!message && message.k === 'g' && Number.isInteger(message.res) && Number.isInteger(message.rs) && typeof message.rid === 'string' &&
    Number.isInteger(message.cell) && typeof message.key === 'string' && Array.isArray(message.builds) && message.builds.length > 0 &&
    message.builds.every((build) => build && Number.isInteger(build.local) && Number.isInteger(build.gen) && typeof build.snap === 'string')
}

export const isScoreMessage = (value: unknown): value is ScoreMessage => isCellMessage(value) || isReuseMessage(value) || isGroupMessage(value)

/** a group's builds as plain cell messages (a dead group's builds each end as an error row). */
export const cellMessagesOfGroup = (message: GroupMessage): CellMessage[] =>
  message.builds.map((build) => ({ k: 's', res: message.res, local: build.local, gen: build.gen, rs: message.rs, rid: message.rid,
    cell: message.cell, key: message.key, lane: 'bulk', snap: build.snap, ...(build.cs ? { cs: 1 as const } : {}) }))

/** a reuse message's cells as plain cell messages: everything scored, nothing kept. */
export const cellMessagesOf = (message: ReuseMessage, cells = message.cells): CellMessage[] =>
  cells.map((cell) => ({ k: 's', res: message.res, local: message.local, gen: message.gen, rs: message.rs, rid: message.rid,
    cell: cell.cell, key: cell.key, lane: 'bulk', snap: message.snap }))

export const scenarioIdOf = (message: Pick<CellMessage, 'rid' | 'key'>) => `${message.rid}:${message.key}`

/** contents of a cell's detail object (R2 detail/<ruleset>/<resonator>/<build>.json.gz, one per build and ruleset):
    everything about a score beyond its numbers. */
export interface CellDetail {
  contribution: ScoredContribution | null
  /** the exact team input the cell ran: the scored seat with its teammates and enemy. */
  input: ScenarioInput | null
  anchors: { baselineDamage: number; benchDamage: number; perfectDamage: number } | null
  /** the score's reads, compared by a rollout to decide reuse (reuse.ts). */
  deps: { reads: string[]; energyRegen: number | null; anchorKey: string | null; anchorSource: string | null; erRepair?: unknown } | null
  /** the generated rotation's hash. */
  program: string | null
  /** why the cell is not ok, beyond its short reason code. */
  detail?: unknown
  /** scored lean: `contribution` and the input's peaks wait until the breakdown is asked for (the board's detail fill). */
  lean?: true
}

export interface DetailObject {
  v: 1
  rulesetId: string
  buildId: string
  gen: number
  /** by scenario key ('<resonator>:<team>:<weapon>'). */
  cells: Record<string, CellDetail>
}

export const detailKey = (rulesetId: string, resonator: number | string, buildId: string) =>
  `detail/${rulesetId}/${resonator}/${buildId}.json.gz`

/** the one detail object a board's seeded builds share (api/moderation/seed.ts): a copy of a real build's. */
export const seedTemplateKey = (rulesetId: string, resonator: number | string) => `seed/${rulesetId}/${resonator}/template.json.gz`

export type { BuildStats }

export function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

export function fromBase64(text: string): Uint8Array {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}

/** gzip json, and back. */
export async function gzipJson(value: unknown): Promise<Uint8Array> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function gunzipJson<T>(bytes: ArrayBuffer | Uint8Array): Promise<T> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text()) as T
}
