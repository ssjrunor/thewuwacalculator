/*
  Author: Runor Ewhro
  description: test data for a local dev database: `lb seed` creates a batch of
               players, builds, accounts and their documents (profiles and
               follows), and `lb seed purge` removes a whole batch.
               creating batches is local dev only; listing and purging work
               anywhere, which covers a database copied off this machine. a
               batch takes a range of build locals shared by every board (from
               SEED_LOCAL_FLOOR up, above any real build), and its uids start
               with 0, which no game uid does. builds go into their boards in
               bulk (BoardDO.seed): written builds with the tool's modelled
               scores, finished and ranked at once, and the rest to the scorer.
               the D1 projections (player_boards, recent_uploads) are written
               here directly, skipping the outbox, which allows batches of
               millions. a purge drops each board's range (BoardDO.purgeSeeds),
               then the batch's D1 rows, in steps the tool repeats until done.

               routes: GET /admin/seed, POST /admin/seed,
               POST /admin/seed/:id/rows, POST /admin/seed/:id/finish,
               POST /admin/seed/purge.
*/

import type { BuildStats } from '@lb/contract/api'
import { DOCUMENTS } from '@lb/contract/documents'
import type { BuildSnapshot } from '@lb/contract/snapshot'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import { formatBuildId, fromGbid, parseBuildId, SEED_LOCAL_FLOOR, SEED_UID_CEILING, uidToText, uuidv7 } from '../../lib/ids.ts'
import { packSnapshot } from '../../lib/snapshotPack.ts'
import { packStats } from '../../lib/statsPack.ts'
import { liveRulesetId } from '../../db/rulesets.ts'
import { putDocumentStatement } from '../../db/documents.ts'
import { accountsOf } from '../../db/accounts.ts'
import type { SeedBuild as BoardSeedBuild } from '../../board/types.ts'
import type { PlayerRow } from '../../db/identity.ts'
import { seedTemplateKey } from '../../scorer/messages.ts'
import { factsOf } from '../players.ts'
import { snapshotHash } from '../read/ingest.ts'
import { boardOf } from '../stubs.ts'
import type { RouteContext } from '../router.ts'
import { authorize, isLocalDevAdmin, staffAudit } from '../auth/staff.ts'

export type SeedMode = 'scored' | 'written'

export interface SeedPlayer {
  // nine digits starting with 0, which no game uid uses
  uid: string
  // the server digit the player shows
  region: string
  name: string
  hideUid: boolean
  anonymous: boolean
  firstSeenAt: number
}

export interface SeedBuild {
  // its public id: its resonator and a local in the batch's range
  id: string
  uid: string
  resonatorId: string
  sequence: number
  snapshot: BuildSnapshot
  // when it was uploaded, and when kuro drew its card
  at: number
  drawnAt: number
  // written mode: each scenario's modelled score on the live ruleset; the best one includes its stats
  scores?: Array<{ scenarioId: string; score: number; damage: number; dpr: number; stats: BuildStats | null }>
}

export interface SeedAccount {
  id: string
  // the seeded uid it is linked to (by a claim)
  uid: string
  createdAt: number
  // the claim that links it; made here when not given
  claimId?: string
}

export interface SeedRows {
  players?: SeedPlayer[]
  builds?: SeedBuild[]
  accounts?: SeedAccount[]
  // a profile belongs to the account the uid is linked to
  profiles?: Array<{ uid: string; displayName?: string; bio?: string }>
  follows?: Array<{ accountId: string; kind: 'player' | 'board'; target: string; at: number }>
}

export interface SeedBatchSummary {
  id: string
  label: string
  mode: SeedMode
  createdAt: number
  players: number
  accounts: number
  builds: number
  // the uids it spans; null before it has players
  uidFrom: string | null
  uidTo: string | null
  // first build local of the batch's range, the same on every board
  localFrom: number
  localTo: number
}

interface BatchRow {
  id: string
  mode: SeedMode
  players: number
  accounts: number
  builds: number
  uid_from: string | null
  uid_to: string | null
  local_from: number
  local_to: number
  purged_boards: string | null
}

const SEED_UID = /^0\d{8}$/
// a request of rows: a chunk of a large batch runs to several MB
const MAX_BODY = 64 * 1024 * 1024
// the json bound to one statement stays under D1's string limit
const MAX_BIND = 900_000
// recent_uploads retention; maintenance prunes older uploads
const RECENT_MS = 90 * 86_400_000

// the dev-only gate: an admin, by the local dev token on this machine
async function localAdmin(context: RouteContext) {
  const who = await authorize(context, 'roles.assign')
  if (!isLocalDevAdmin(context)) throw new HttpError('forbidden', 'test data is only made on a local dev database')
  return who
}

// GET /admin/seed: every batch with its contents
export async function listSeedBatches(context: RouteContext): Promise<Response> {
  await authorize(context, 'health.read')
  const { results } = await context.env.LB.prepare(`SELECT id, label, mode, created_at AS createdAt, players, accounts, builds,
      uid_from AS uidFrom, uid_to AS uidTo, local_from AS localFrom, local_to AS localTo
    FROM seed_batches ORDER BY created_at`).all<SeedBatchSummary>()
  return json({ batches: results })
}

// POST /admin/seed { label, mode, builds }: creates a batch with room for `builds` builds and returns its local range
// and the ruleset used for modelled scores
export async function createSeedBatch(context: RouteContext): Promise<Response> {
  const who = await localAdmin(context)
  const body = await readJsonBody<{ label?: unknown; mode?: unknown; builds?: unknown }>(context.request)
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : 'seed'
  if (body.mode !== 'scored' && body.mode !== 'written') throw new HttpError('bad_request', 'mode is scored or written')
  const room = typeof body.builds === 'number' && Number.isInteger(body.builds) && body.builds > 0 ? body.builds : 0
  if (!room) throw new HttpError('bad_request', 'builds is how many builds the batch makes')
  const db = context.env.LB
  const rulesetId = await liveRulesetId(db)
  if (!rulesetId) throw new HttpError('not_found', 'no live ruleset to seed against')
  // start after every taken range with spare room; the tool's build count is an estimate
  const last = (await db.prepare('SELECT MAX(local_to) AS n FROM seed_batches').first<{ n: number | null }>())?.n ?? null
  const localFrom = Math.max(SEED_LOCAL_FLOOR, (last ?? 0) + 1)
  const localTo = localFrom + Math.max(10_000, room * 2) - 1
  const id = uuidv7(context.now)
  await db.batch([
    db.prepare('INSERT INTO seed_batches (id, label, mode, created_at, local_from, local_to) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, label, body.mode, context.now, localFrom, localTo),
    staffAudit(context, who, { action: 'seed.create', subjectKind: 'seed', subjectId: id, data: { label, mode: body.mode, localFrom, localTo } }),
  ])
  return json({ id, label, mode: body.mode, rulesetId, localFrom, localTo }, { status: 201 })
}

// `sql` reads rows from json_each(?1); one statement per slice of rows that fits MAX_BIND. more binds follow as ?2...
function bulk(db: D1Database, sql: string, rows: unknown[][], ...binds: unknown[]): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = []
  let part: string[] = [], size = 2
  const flush = () => {
    if (part.length) statements.push(db.prepare(sql).bind(`[${part.join(',')}]`, ...binds))
    part = []
    size = 2
  }
  for (const row of rows) {
    const text = JSON.stringify(row)
    if (size + text.length > MAX_BIND) flush()
    part.push(text)
    size += text.length + 1
  }
  flush()
  return statements
}

// the nth field of a json_each row
const f = (n: number) => `json_extract(value, '$[${n}]')`
const IDS = '(SELECT value FROM json_each(?1))'
const changes = (results: D1Result[], from: number, to: number) => results.slice(from, to).reduce((sum, row) => sum + (row.meta.changes ?? 0), 0)

const templated = new Set<string>()

// a board's seeds read one shared detail object, copied from one of its real builds
async function ensureTemplate(env: RouteContext['env'], rulesetId: string, resonator: number): Promise<void> {
  const key = seedTemplateKey(rulesetId, resonator)
  if (templated.has(key)) return
  if (!await env.LB_DATA.head(key)) {
    const listed = await env.LB_DATA.list({ prefix: `detail/${rulesetId}/${resonator}/`, limit: 50 })
    // pick a real build's image; seed builds are skipped
    const real = listed.objects.find((object) => {
      const id = parseBuildIdOf(object.key)
      return id != null && id.local < SEED_LOCAL_FLOOR
    })
    const object = real ? await env.LB_DATA.get(real.key) : null
    if (!object) return
    await env.LB_DATA.put(key, await object.arrayBuffer(), { httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' } })
  }
  templated.add(key)
}

const parseBuildIdOf = (key: string) => parseBuildId(key.slice(key.lastIndexOf('/') + 1).replace(/\.json\.gz$/, ''))

// POST /admin/seed/:id/rows: inserts players, then builds, then accounts and their documents, in one or more calls;
// existing rows are left as they are, so a resent chunk is a no-op
export async function insertSeedRows(context: RouteContext): Promise<Response> {
  await localAdmin(context)
  const { env } = context
  const db = env.LB
  const batch = await db.prepare('SELECT * FROM seed_batches WHERE id = ?').bind(context.params.id).first<BatchRow>()
  if (!batch) throw new HttpError('not_found', 'no such seed batch')
  if (batch.purged_boards != null) throw new HttpError('bad_request', 'this batch is being purged')
  const rows = await readJsonBody<SeedRows>(context.request, MAX_BODY)
  const now = context.now
  const inBatch = async (uids: string[]) => {
    if (!uids.length) return
    const { n } = (await db.prepare(`SELECT COUNT(*) AS n FROM players WHERE seed_batch = ?1 AND uid IN (SELECT value FROM json_each(?2))`)
      .bind(batch.id, JSON.stringify([...new Set(uids)])).first<{ n: number }>())!
    if (n !== new Set(uids).size) throw new HttpError('bad_request', 'every uid must be a player of this batch')
  }
  const count = (column: 'players' | 'accounts' | 'builds', n: number) =>
    db.prepare(`UPDATE seed_batches SET ${column} = ${column} + ? WHERE id = ?`).bind(n, batch.id)

  const players = rows.players ?? []
  if (players.some((player) => !SEED_UID.test(player.uid))) throw new HttpError('bad_request', 'seeded uids are 9 digits starting with 0')
  if (players.length) {
    const statements = bulk(db, `INSERT OR IGNORE INTO players (uid, region, last_name, hide_uid, anonymous, opted_out_at, first_seen_at,
        last_seen_at, seed_batch) SELECT ${f(0)}, ${f(1)}, ${f(2)}, ${f(3)}, ${f(4)}, NULL, ${f(5)}, ?2, ?3 FROM json_each(?1)`,
    players.map((player) => [player.uid, player.region, player.name, player.hideUid ? 1 : 0, player.anonymous ? 1 : 0, player.firstSeenAt]),
    now, batch.id)
    const sorted = players.map((player) => player.uid).sort()
    await count('players', changes(await db.batch(statements), 0, statements.length)).run()
    await db.prepare(`UPDATE seed_batches SET uid_from = MIN(COALESCE(uid_from, ?1), ?1), uid_to = MAX(COALESCE(uid_to, ?2), ?2) WHERE id = ?3`)
      .bind(sorted[0], sorted.at(-1), batch.id).run()
  }

  const builds = rows.builds ?? []
  let inserted = 0
  if (builds.length) {
    await inBatch(builds.map((build) => build.uid))
    if (batch.mode === 'written' && builds.some((build) => !build.scores?.length)) throw new HttpError('bad_request', 'written builds carry scores')
    if (batch.mode === 'scored' && builds.some((build) => build.scores)) throw new HttpError('bad_request', 'scored builds carry no scores')
    const rulesetId = (await liveRulesetId(db))!
    const prefix = `${rulesetId}:`
    const { results: people } = await db.prepare(`SELECT p.* FROM players p WHERE uid IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify([...new Set(builds.map((build) => build.uid))])).all<PlayerRow>()
    const facts = new Map(people.map((row) => [row.uid, factsOf(row, false)]))
    const byBoard = new Map<number, BoardSeedBuild[]>()
    for (const build of builds) {
      const id = parseBuildId(build.id)
      if (!id || String(id.resonator) !== build.resonatorId || id.local < batch.local_from || id.local > batch.local_to) {
        throw new HttpError('bad_request', `${build.id} is not a build id of this batch's range on board ${build.resonatorId}`)
      }
      const best = build.scores?.reduce((top, row) => (row.score > top.score ? row : top)) ?? null
      const row: BoardSeedBuild = { local: id.local, uid: Number(build.uid), seq: build.sequence, card: 'seed', snap: packSnapshot(build.snapshot),
        snapHash: await snapshotHash(build.snapshot), drawnAt: build.drawnAt, at: build.at,
        scores: build.scores ? build.scores.filter((score) => score.scenarioId.startsWith(prefix))
          .map((score) => ({ key: score.scenarioId.slice(prefix.length), score: score.score, damage: score.damage, dpr: score.dpr })) : null,
        stats: best?.stats ? packStats(best.stats) : null }
      byBoard.set(id.resonator, [...byBoard.get(id.resonator) ?? [], row])
    }
    const placed = await Promise.all([...byBoard].map(async ([resonator, list]) => {
      if (batch.mode === 'written') await ensureTemplate(env, rulesetId, resonator)
      const boardPlayers = [...new Set(list.map((build) => build.uid))].map((uid) => facts.get(uidToText(uid))!)
      return { resonator, result: await boardOf(env, resonator).seed(resonator, { range: [batch.local_from, batch.local_to], players: boardPlayers,
        builds: list, now }) }
    }))
    const standings: unknown[][] = []
    const uploads: unknown[][] = []
    const id = (gbid: number | null) => (gbid == null ? null : formatBuildId(fromGbid(gbid)))
    for (const { resonator, result } of placed) {
      inserted += result.inserted
      for (const row of result.players) {
        standings.push([uidToText(row.uid), String(resonator), row.standing, id(row.active), id(row.listed), row.listedAt, row.seq])
      }
      for (const row of result.uploads) {
        if (row.at >= now - RECENT_MS) uploads.push([id(row.gbid), uidToText(row.uid), String(resonator), row.at, row.shown ? 1 : 0])
      }
    }
    await db.batch([
      ...bulk(db, `INSERT INTO player_boards (uid, resonator_id, standing, active, listed, listed_at, sequence, updated_at)
        SELECT ${f(0)}, ${f(1)}, ${f(2)}, ${f(3)}, ${f(4)}, ${f(5)}, ${f(6)}, ?2 FROM json_each(?1) WHERE true
        ON CONFLICT (uid, resonator_id) DO UPDATE SET standing = excluded.standing, active = excluded.active, listed = excluded.listed,
          listed_at = excluded.listed_at, sequence = excluded.sequence, updated_at = excluded.updated_at`, standings, now),
      ...bulk(db, `INSERT INTO recent_uploads (build_id, uid, resonator_id, at, shown)
        SELECT ${f(0)}, ${f(1)}, ${f(2)}, ${f(3)}, ${f(4)} FROM json_each(?1) WHERE true
        ON CONFLICT (build_id) DO UPDATE SET at = excluded.at, shown = excluded.shown`, uploads),
      count('builds', inserted),
    ])
  }

  const accounts = rows.accounts ?? []
  await inBatch(accounts.map((account) => account.uid))
  if (accounts.length) {
    const bare = await db.prepare(`SELECT value AS uid FROM json_each(?1) WHERE NOT EXISTS (SELECT 1 FROM player_boards WHERE uid = value) LIMIT 1`)
      .bind(JSON.stringify(accounts.map((account) => account.uid))).first<{ uid: string }>()
    if (bare) throw new HttpError('bad_request', `uid ${bare.uid} has no build to claim it with`)
    const list = accounts.map((account) => [account.id, account.uid, account.createdAt, account.claimId ?? uuidv7(account.createdAt)])
    const made = bulk(db, `INSERT OR IGNORE INTO accounts (id, role, created_at, last_seen_at, seed_batch)
      SELECT ${f(0)}, 'user', ${f(2)}, ?2, ?3 FROM json_each(?1)`, list, now, batch.id)
    const results = await db.batch([...made,
      ...bulk(db, `INSERT OR IGNORE INTO claims (id, uid, card_id, kind, created_at) SELECT ${f(3)}, ${f(1)}, 'seed', 'fresh_card', ${f(2)}
        FROM json_each(?1)`, list),
      ...bulk(db, `INSERT OR IGNORE INTO account_uids (uid, account_id, claim_id, linked_at) SELECT ${f(1)}, ${f(0)}, ${f(3)}, ${f(2)}
        FROM json_each(?1)`, list),
    ])
    await count('accounts', changes(results, 0, made.length)).run()
  }

  const profiles = rows.profiles ?? []
  await inBatch(profiles.map((profile) => profile.uid))
  // a follow is written by one of this batch's accounts
  const written = rows.follows ?? []
  if (written.length) {
    const accountIds = [...new Set(written.map((row) => row.accountId))]
    const { n } = (await db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE seed_batch = ?1 AND id IN (SELECT value FROM json_each(?2))`)
      .bind(batch.id, JSON.stringify(accountIds)).first<{ n: number }>())!
    if (n !== accountIds.length) throw new HttpError('bad_request', 'every follow is written by an account of this batch')
  }
  const owners = profiles.length ? await accountsOf(db, profiles.map((profile) => profile.uid)) : new Map<string, string>()
  const statements = [
    ...profiles.map((profile) => {
      const owner = owners.get(profile.uid)
      if (!owner) throw new HttpError('bad_request', `profile of ${profile.uid}: a profile is an account's, and this uid is on none`)
      const parsed = DOCUMENTS.profile.schema.safeParse({ displayName: profile.displayName, bio: profile.bio })
      if (!parsed.success) throw new HttpError('bad_request', `profile of ${profile.uid}: ${parsed.error.message}`)
      return putDocumentStatement(db, { kind: 'profile', ownerId: owner, version: DOCUMENTS.profile.version, body: parsed.data,
        reviewedBy: 'seed' }, now)
    }),
    ...bulk(db, `INSERT OR IGNORE INTO follows (account_id, kind, target, created_at) SELECT ${f(0)}, ${f(1)}, ${f(2)}, ${f(3)} FROM json_each(?1)`,
      (rows.follows ?? []).map((follow) => [follow.accountId, follow.kind, follow.target, follow.at])),
  ]
  for (let start = 0; start < statements.length; start += 200) await db.batch(statements.slice(start, start + 200))

  return json({ players: players.length, builds: builds.length, inserted, accounts: accounts.length, profiles: profiles.length,
    follows: rows.follows?.length ?? 0 })
}

// POST /admin/seed/:id/finish: marks the batch complete; each board writes its written builds' entries in key order
// (BoardDO.finishSeeds), and a board that misses the call writes them a minute after its last chunk
export async function finishSeedBatch(context: RouteContext): Promise<Response> {
  await localAdmin(context)
  const { env } = context
  const batch = await env.LB.prepare('SELECT id FROM seed_batches WHERE id = ?').bind(context.params.id).first<{ id: string }>()
  if (!batch) throw new HttpError('not_found', 'no such seed batch')
  const started = Date.now()
  const boards = await boardsOf(env.LB)
  const written = await Promise.all(boards.map((resonator) => boardOf(env, resonator).finishSeeds(Number(resonator))))
  return json({ boards: written.filter(Boolean).length, ms: Date.now() - started })
}

// purge

// how many of a batch's accounts or players one purge step takes
const STEP = { accounts: 5000, players: 5000 }

// statements removing the reports by or about a list of ids, with their dependent rows; `where` reads ?1
const reportStatements = (db: D1Database, where: string, ids: string) => {
  const reports = `(SELECT id FROM reports WHERE ${where})`
  return [
    db.prepare(`DELETE FROM report_notes WHERE report_id IN ${reports}`).bind(ids),
    db.prepare(`UPDATE sanctions SET report_id = NULL WHERE report_id IN ${reports}`).bind(ids),
    db.prepare(`DELETE FROM reports WHERE ${where}`).bind(ids),
  ]
}

// a step's statements, every one reading the step's ids as json from ?1
const each = (db: D1Database, ids: string, sql: string[]) => sql.map((text) => db.prepare(text).bind(ids))

// statements removing everything written about a board's seed builds. their public ids are the board id plus 8 base36
// digits (seed locals are at least 2^38), so the id range matches the local range and uses the build_id indexes
function buildRangeStatements(db: D1Database, resonator: string, from: number, to: number): D1PreparedStatement[] {
  const lo = formatBuildId({ resonator: Number(resonator), local: from })
  const hi = formatBuildId({ resonator: Number(resonator), local: to })
  const range = `BETWEEN ?1 AND ?2 AND length(build_id) = length(?1)`
  const reports = `(SELECT id FROM reports WHERE build_id ${range})`
  return [
    `DELETE FROM notifications WHERE build_id ${range}`,
    `DELETE FROM bookmarks WHERE build_id ${range}`,
    `DELETE FROM report_notes WHERE report_id IN ${reports}`,
    `UPDATE sanctions SET report_id = NULL WHERE report_id IN ${reports}`,
    `DELETE FROM reports WHERE build_id ${range}`,
    `DELETE FROM recent_uploads WHERE build_id ${range}`,
  ].map((text) => db.prepare(text).bind(lo, hi))
}

// statements removing accounts and every row that references them
function accountStatements(db: D1Database, accountIds: string[]) {
  const accounts = JSON.stringify(accountIds)
  return [
    ...each(db, accounts, [
      `DELETE FROM audit_log WHERE (subject_kind = 'account' AND subject_id IN ${IDS}) OR actor_id IN ${IDS}`,
      `DELETE FROM notifications WHERE account_id IN ${IDS}`,
      `DELETE FROM bookmarks WHERE account_id IN ${IDS}`,
    ]),
    ...reportStatements(db, `reporter_account IN ${IDS}`, accounts),
    ...each(db, accounts, [
      `DELETE FROM follows WHERE account_id IN ${IDS}`,
      `DELETE FROM blocks WHERE account_id IN ${IDS} OR blocked_account IN ${IDS}`,
      `DELETE FROM documents WHERE kind IN ('profile', 'views') AND owner_id IN ${IDS}`,
      `DELETE FROM documents WHERE kind = 'card' AND substr(owner_id, 1, 36) IN ${IDS}`,
      `DELETE FROM media WHERE account_id IN ${IDS}`,
      `DELETE FROM card_presets WHERE account_id IN ${IDS}`,
      `DELETE FROM appeals WHERE account_id IN ${IDS}`,
      `DELETE FROM sanctions WHERE subject_kind = 'account' AND subject_id IN ${IDS}`,
      `DELETE FROM sessions WHERE account_id IN ${IDS}`,
      `DELETE FROM account_uids WHERE account_id IN ${IDS}`,
      `DELETE FROM account_logins WHERE account_id IN ${IDS}`,
      `DELETE FROM accounts WHERE id IN ${IDS}`,
    ]),
  ]
}

// statements removing players with their documents, claims and D1 board copies; their builds and accounts are
// removed before this
function playerStatements(db: D1Database, uids: string[]) {
  const players = JSON.stringify(uids)
  return [
    ...each(db, players, [
      `DELETE FROM audit_log WHERE (subject_kind = 'player' AND subject_id IN ${IDS}) OR actor_id IN ${IDS}`,
      `DELETE FROM notifications WHERE actor_uid IN ${IDS} OR (kind = 'uid_moved' AND subject_id IN ${IDS})`,
    ]),
    ...reportStatements(db, `subject_uid IN ${IDS}`, players),
    ...each(db, players, [
      `DELETE FROM follows WHERE kind = 'player' AND target IN ${IDS}`,
      `DELETE FROM sanctions WHERE subject_kind = 'uid' AND subject_id IN ${IDS}`,
      `DELETE FROM uid_holds WHERE uid IN ${IDS}`,
      `DELETE FROM account_uids WHERE uid IN ${IDS}`,
      `DELETE FROM sessions WHERE claim_id IN (SELECT id FROM claims WHERE uid IN ${IDS})`,
      `DELETE FROM claims WHERE uid IN ${IDS}`,
      `DELETE FROM player_boards WHERE uid IN ${IDS}`,
      `DELETE FROM recent_uploads WHERE uid IN ${IDS}`,
      `DELETE FROM players WHERE uid IN ${IDS}`,
    ]),
  ]
}

export interface PurgeStep { done: boolean; builds: number; accounts: number; players: number }

// every board a batch may be on: boards with a summary and boards the live ruleset scores
async function boardsOf(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(`SELECT resonator_id FROM boards UNION
    SELECT DISTINCT resonator_id FROM scenarios WHERE ruleset_id = (SELECT value FROM settings WHERE key = 'live_ruleset')`)
    .all<{ resonator_id: string }>()
  return results.map((row) => row.resonator_id).sort()
}

// one purge step: a board's builds, else some accounts, else some players, else the batch row. an interrupted purge
// leaves the batch listed and closed to new rows, and resumes where it stopped
export async function purgeStep(env: RouteContext['env'], batch: BatchRow): Promise<PurgeStep> {
  const db = env.LB
  const step = { done: false, builds: 0, accounts: 0, players: 0 }
  const done = new Set<string>(batch.purged_boards ? JSON.parse(batch.purged_boards) as string[] : [])
  const next = (await boardsOf(db)).find((resonator) => !done.has(resonator))
  if (next) {
    // a seed uid is below SEED_UID_CEILING; a batch with no players yet spans none
    const uids: [number, number] = batch.uid_from == null ? [1, 0] : [Number(batch.uid_from), Math.min(Number(batch.uid_to), SEED_UID_CEILING - 1)]
    const purged = await boardOf(env, next).purgeSeeds(Number(next), [batch.local_from, batch.local_to], uids)
    done.add(next)
    await db.batch([...buildRangeStatements(db, next, batch.local_from, batch.local_to),
      db.prepare('UPDATE seed_batches SET builds = MAX(0, builds - ?), purged_boards = ? WHERE id = ?')
        .bind(purged.builds, JSON.stringify([...done]), batch.id)])
    batch.purged_boards = JSON.stringify([...done])
    return { ...step, builds: purged.builds }
  }
  const { results: accounts } = await db.prepare('SELECT id FROM accounts WHERE seed_batch = ?1 LIMIT ?2').bind(batch.id, STEP.accounts)
    .all<{ id: string }>()
  if (accounts.length) {
    await db.batch([...accountStatements(db, accounts.map((row) => row.id)),
      db.prepare('UPDATE seed_batches SET accounts = MAX(0, accounts - ?) WHERE id = ?').bind(accounts.length, batch.id)])
    return { ...step, accounts: accounts.length }
  }
  const { results: players } = await db.prepare('SELECT uid FROM players WHERE seed_batch = ?1 LIMIT ?2').bind(batch.id, STEP.players)
    .all<{ uid: string }>()
  if (players.length) {
    await db.batch([...playerStatements(db, players.map((row) => row.uid)),
      db.prepare('UPDATE seed_batches SET players = MAX(0, players - ?) WHERE id = ?').bind(players.length, batch.id)])
    return { ...step, players: players.length }
  }
  await db.prepare('DELETE FROM seed_batches WHERE id = ?1').bind(batch.id).run()
  return { ...step, done: true }
}

// time budget of one purge request; the tool repeats the call until done
const PURGE_BUDGET_MS = 20_000

// POST /admin/seed/purge { batch? }: purges one batch, or all of them without `batch`; returns `done: false` while
// work remains
export async function purgeSeedBatches(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'roles.assign')
  const body = await readJsonBody<{ batch?: unknown }>(context.request)
  const batchId = typeof body.batch === 'string' ? body.batch : null
  const db = context.env.LB
  const { results: batches } = await db.prepare(`SELECT * FROM seed_batches ${batchId == null ? '' : 'WHERE id = ?'} ORDER BY created_at`)
    .bind(...(batchId == null ? [] : [batchId])).all<BatchRow>()
  if (batchId != null && !batches.length) throw new HttpError('not_found', 'no such seed batch')
  const started = Date.now()
  const removed = { batches: [] as string[], players: 0, accounts: 0, builds: 0 }
  for (const batch of batches) {
    // close the batch to new rows
    if (batch.purged_boards == null) {
      batch.purged_boards = '[]'
      await db.prepare(`UPDATE seed_batches SET purged_boards = '[]' WHERE id = ? AND purged_boards IS NULL`).bind(batch.id).run()
    }
    const counts = { players: batch.players, accounts: batch.accounts, builds: batch.builds }
    for (;;) {
      const step = await purgeStep(context.env, batch)
      removed.players += step.players
      removed.accounts += step.accounts
      removed.builds += step.builds
      if (step.done) {
        removed.batches.push(batch.id)
        await db.batch([staffAudit(context, who, { action: 'seed.purge', subjectKind: 'seed', subjectId: batch.id, data: counts })])
        break
      }
      if (Date.now() - started > PURGE_BUDGET_MS) return json({ ...removed, done: false })
    }
  }
  return json({ ...removed, done: true })
}
