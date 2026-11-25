/*
  Author: Runor Ewhro
  description: one resonator's board as a Durable Object (idFromName of the
               resonator id). board rules are in store.ts and run in one SQLite
               transaction per write; this class adds the work outside a
               transaction: the scored rulesets (read from D1's catalog),
               outgoing scoring messages, and an alarm that writes finished
               jobs' detail objects to R2, applies the outbox to D1, walks a
               rolling ruleset over the board, resends unsent orders and
               resumes stalled jobs.
*/

import { DurableObject } from 'cloudflare:workers'
import type { ApiEnv } from '../env.ts'
import { applyOutbox } from '../api/projections.ts'
import { formatBuildId, parseBuildId } from '../lib/ids.ts'
import { detailKey, gunzipJson, gzipJson, toBase64, type CellDetail, type CellMessage, type DetailObject, type GroupMessage, type ReuseMessage,
  type ScoreMessage } from '../scorer/messages.ts'
import { durableSql } from './sql.ts'
import { heavyStep, heavyWait } from './pace.ts'
import { BoardStore, CELL_STATUS, GROUP_WAIT_MS, JOB, STATE, WALKS } from './store.ts'
import { fromQ } from '../lib/score.ts'
import * as reads from './reads.ts'
import type { SrFilter } from './rank.ts'
import type { CellDef, CellResult, JobOrder, Lane, PlaceInput, PlaceResult, PlayerFacts, RecordAck, RescoreRequest, SeedInput, SeedPlaced } from './types.ts'

/** a job with no new result for this long is sent again (its missing cells only). */
export const STALL_MS = 30 * 60_000
/** resumes before a job is given up on and finishes on what did score. */
export const MAX_RESUMES = 3
/** interval of the board's D1 catalog sync (rulesets going live, rolling out, cancelled). */
const CATALOG_MS = 30_000
/** builds a rollout fans out per alarm. */
const ROLLOUT_SLICE = 300
/** outbox ops per D1 batch (each op is up to five statements; a batch takes at most a few hundred). */
const OUTBOX_BATCH = 120
/** how soon the alarm runs after a write that left work for it. */
const SOON_MS = 50
/** while jobs are open, the alarm looks in this often. */
const WATCH_MS = 60_000
/** detail objects of an ended ruleset deleted per alarm. */
const PURGE_SLICE = 500
/** a written seed batch left the entries stale this long ago with no more chunks: the alarm writes them (a tool that
    stopped before it said the batch was done). */
const SEED_QUIET_MS = 60_000
/** builds staged per entry rebuild step (store.rebuildEntries; a sort step copies SORT_ROWS entries). */
const REBUILD_BUILDS = 5_000
/** players rechecked per go-live step (store.standingsSlice). */
const STANDINGS_SLICE = 2_000
/** extra random delay, up to this, before a board that missed its heavy-step turn retries, which spreads retries
    of boards waiting together. */
const TURN_JITTER_MS = 250

/**
 * the board's heavy background tasks, most urgent first, each with a check (wants) and one bounded step (step). the
 * alarm runs at most one per call, and only on this isolate's heavy-step turn (pace.ts), which keeps each alarm short
 * and lets boards on one thread take turns. player-facing work (outbox, detail objects, scoring messages) runs on
 * every alarm before these.
 */
const BACKGROUND: Array<{ name: string; wants: (store: BoardStore, now: number) => boolean; step: (store: BoardStore, now: number) => void }> = [
  // after a go-live: reread every player's best build on the live ruleset
  { name: 'standings', wants: (store) => store.standingsPending(), step: (store) => { store.standingsSlice(STANDINGS_SLICE) } },
  // a rollout's walk is done: its entries are written now (the rebuild below), the deferral ended.
  { name: 'deferred', wants: (store) => store.deferralsDue().length > 0, step: (store) => { store.endDeferrals() } },
  { name: 'entries', wants: (store, now) => entriesDue(store, now), step: (store) => { store.rebuildEntries(1, REBUILD_BUILDS) } },
  { name: 'timings', wants: (store, now) => store.timingsToPrune(now), step: (store, now) => { store.pruneTimings(now) } },
]

/** a stale board's entries are rebuilt once its seed batch has gone quiet (or said it was done). */
function entriesDue(store: BoardStore, now: number): boolean {
  const stale = store.entriesStaleSince()
  return stale != null && stale + SEED_QUIET_MS <= now
}
/** a queue send takes 256 KB of messages; a little is left for what the queue adds to each. */
const SEND_BATCH_BYTES = 240_000

export interface CatalogRuleset {
  rs: number
  id: string
  /** live, or rolling (being scored by a rollout). */
  state: 'live' | 'rolling'
  /** for a rollout: the ruleset whose scores the scorer may keep, or null (scorer/reuse.ts). */
  reuse_from: number | null
}

type Env = Pick<ApiEnv, 'LB' | 'LB_DATA' | 'SCORE_QUEUE' | 'SCORE_BULK_QUEUE' | 'LOCAL_SCORER_URL' | 'GROUP_WAIT_MS' | 'SCORER'>

/** a lean cell a fill makes the breakdown of: build, cell, on a ruleset by its number here. */
interface FillItem { rs: number; local: number; cell: number }
/** the most lean cells one alarm fills, and how long a fill may take before its cells may be asked for again. */
const FILL_SLICE = 200
const FILL_TIMEOUT_MS = 60_000

export class BoardDO extends DurableObject<Env> {
  private store: BoardStore | null = null
  private catalogAt = 0
  /** lean cells a page read requested fills for, run by the alarm (memory only; a page read requests again). */
  private readonly fillWanted = new Map<string, FillItem>()
  /** fills in progress by cell; repeated requests await the first. */
  private readonly filling = new Map<string, Promise<CellDetail | null>>()
  /** per R2 detail object, a promise chain that serializes patches, which keeps two fills of one build from
      overwriting each other. */
  private readonly objectTurns = new Map<string, Promise<unknown>>()

  private board(resonator: number): BoardStore {
    if (!this.store) this.store = new BoardStore(durableSql(this.ctx.storage), resonator)
    else if (this.store.resonator !== resonator) throw new Error(`board: this is ${this.store.resonator}'s board, not ${resonator}'s`)
    return this.store
  }

  // catalog

  /** syncs the board's rulesets with D1: installs live and rolling rulesets (with this resonator's cells), makes live
        the ones that went live, and drops cancelled rollouts; runs at most every CATALOG_MS unless forced. */
  async syncCatalog(resonator: number, { force = false } = {}): Promise<void> {
    const store = this.board(resonator)
    const now = Date.now()
    if (!force && now - this.catalogAt < CATALOG_MS) return
    // a rollout keeps scores from the ruleset it replaces when the scorer is unchanged ('scenario'); with a new scorer,
    // on scenarios its sample check found scoring the same ('data', cellsOf), or, when only the generator changed (the
    // evaluation fingerprints match), for builds with an unchanged program. the scorer then checks each score's reads
    const { results } = await this.env.LB.prepare(`SELECT r.no AS rs, r.id, CASE WHEN r.status = 'live' THEN 'live' ELSE 'rolling' END AS state,
        CASE WHEN o.keep = 'data' OR (o.keep = 'scenario' AND r.scorer IS NOT NULL AND (r.scorer = f.scorer
          OR (r.evaluation_fp IS NOT NULL AND r.evaluation_fp = f.evaluation_fp))) THEN f.no END AS reuse_from
      FROM rulesets r LEFT JOIN rollouts o ON o.ruleset_id = r.id AND o.status = 'scoring' LEFT JOIN rulesets f ON f.id = o.from_ruleset
      WHERE r.status = 'live' OR o.ruleset_id IS NOT NULL`).all<CatalogRuleset>()
    for (const ruleset of results) {
      if (!store.ruleset(ruleset.rs)) {
        const cells = await this.cellsOf(ruleset.rs, resonator)
        // a ruleset that does not score this resonator has nothing to install here.
        if (!cells.length) continue
        store.installRuleset({ rs: ruleset.rs, id: ruleset.id, cells, reuseFrom: ruleset.reuse_from }, now, { live: ruleset.state === 'live' })
      }
      if (ruleset.state === 'live' && store.liveRs !== ruleset.rs) store.goLive(ruleset.rs, now)
    }
    const wanted = new Set(results.map((ruleset) => ruleset.rs))
    for (const info of store.activeRulesets()) if (info.rs !== store.liveRs && !wanted.has(info.rs)) store.cancelRuleset(info.rs, now)
    this.catalogAt = now
    await this.wake()
  }

  private async cellsOf(rs: number, resonator: number): Promise<CellDef[]> {
    // reuse: whether a rollout may offer the cell's old score. with the same scorer the scorer checks it; with a new
    // scorer every sample of the scenario must pass its check (moderation/checks.ts); a scorer with the old evaluation
    // (only the generator changed) offers it by program (2)
    const { results } = await this.env.LB.prepare(`SELECT s.cell, substr(s.id, length(s.ruleset_id) + 2) AS key, s.team_id, s.team_key,
        s.team_rank, s.weapon_id, s.weapon_rank, s.weapon_role, s.members,
        CASE WHEN o.ruleset_id IS NULL OR f.scorer = r.scorer OR (c.samples > 0 AND c.differing = 0) THEN 1
          WHEN r.evaluation_fp IS NOT NULL AND r.evaluation_fp = f.evaluation_fp THEN 2 ELSE 0 END AS reuse
      FROM scenarios s JOIN rulesets r ON r.no = s.rs
        LEFT JOIN rollouts o ON o.ruleset_id = r.id AND o.status = 'scoring' LEFT JOIN rulesets f ON f.id = o.from_ruleset
        LEFT JOIN ruleset_check_scenarios c ON c.ruleset_id = r.id AND c.from_ruleset = o.from_ruleset AND c.scorer = r.scorer
          AND c.key = substr(s.id, length(s.ruleset_id) + 2)
      WHERE s.rs = ? AND s.resonator_id = ? ORDER BY s.cell`)
      .bind(rs, String(resonator)).all<{ cell: number; key: string; team_id: string; team_key: string; team_rank: number; weapon_id: string
        weapon_rank: number; weapon_role: string; members: string; reuse: number }>()
    return results.map((row) => ({ cell: row.cell, key: row.key, teamId: row.team_id, teamKey: row.team_key, teamRank: row.team_rank,
      weaponId: Number(row.weapon_id), weaponRank: row.weapon_rank, weaponRole: row.weapon_role, members: JSON.parse(row.members) as string[],
      reuse: row.reuse === 2 ? 'program' : row.reuse === 1 }))
  }

  // writes

  async place(resonator: number, input: PlaceInput): Promise<PlaceResult> {
    await this.syncCatalog(resonator)
    const result = this.board(resonator).place(input)
    await this.send(result.jobs)
    await this.wake()
    return result
  }

  /** records results and stages the cells reuse messages did not keep (`rescore`) for group scoring. */
  async recordScores(resonator: number, results: CellResult[], rescore: RescoreRequest[] = []): Promise<RecordAck[]> {
    const store = this.board(resonator)
    const outcome = store.recordScores(results, Date.now(), rescore)
    if (rescore.length) await this.sendGroups(store)
    await this.wake()
    return outcome.acks
  }

  /** a setup uid's build sent by its player: an upload from now (store.claimSetup). */
  async claimSetup(resonator: number, local: number, uid: number, card: string): Promise<boolean> {
    const claimed = this.board(resonator).claimSetup(local, uid, card, Date.now())
    await this.wake()
    return claimed
  }

  async syncPlayer(resonator: number, facts: PlayerFacts): Promise<void> {
    this.board(resonator).syncPlayer(facts)
    await this.wake()
  }

  async setOwnerHidden(resonator: number, local: number, uid: number, hidden: boolean): Promise<boolean> {
    const done = this.board(resonator).setOwnerHidden(local, uid, hidden, Date.now())
    await this.wake()
    return done
  }

  /** deletes an owner's build (uid given) or hides one for staff; returns the build as it was, or null. */
  async endBuild(resonator: number, local: number, state: 'deleted' | 'hidden', actor: string, uid?: number) {
    const build = this.board(resonator).endBuild(local, state, actor, Date.now(), uid == null ? {} : { uid })
    await this.wake()
    return build ? { uid: build.uid, card: build.card } : null
  }

  async restoreBuild(resonator: number, local: number, actor: string): Promise<boolean> {
    await this.syncCatalog(resonator)
    const orders = this.board(resonator).restoreBuild(local, actor, Date.now())
    if (orders) await this.send(orders)
    await this.wake()
    return orders != null
  }

  /** deletes an opted-out player's builds on this board and returns their cards for the registry. */
  async deletePlayer(resonator: number, uid: number): Promise<string[]> {
    const store = this.board(resonator)
    const cards = store.sql.all<{ card: string }>(`SELECT DISTINCT card FROM builds WHERE uid = ?`, uid).map((row) => row.card)
    store.deletePlayerBuilds(uid, Date.now())
    await this.wake()
    return cards
  }

  /** rescores builds on a ruleset (a moderator request), restarting each job there on the given lane; 'all' runs a
        paced bulk-lane walk (store.startRescoreWalk) with its first slice now and the rest from the alarm. */
  async rescore(resonator: number, rs: number, locals: number[] | 'all', lane: Lane): Promise<number> {
    await this.syncCatalog(resonator, { force: true })
    const store = this.board(resonator)
    if (locals === 'all') {
      const count = store.startRescoreWalk(rs)
      await this.send(store.rescoreSlice(rs, ROLLOUT_SLICE, Date.now()))
      await this.wake()
      return count
    }
    const orders: JobOrder[] = []
    for (const local of locals) {
      const order = store.restartJob(rs, local, lane, Date.now())
      if (order) orders.push(order)
    }
    await this.send(orders)
    await this.wake()
    return orders.length
  }

  // test data

  /** a chunk of a seed batch's builds (api/moderation/seed.ts): written ones are on the board at once, the rest go
      to the scorer on the bulk lane as a paced walk (store.walkSlice 'fill'). */
  async seed(resonator: number, input: SeedInput): Promise<SeedPlaced> {
    await this.syncCatalog(resonator, { force: true })
    const store = this.board(resonator)
    const placed = store.seed(input)
    await this.send(placed.orders)
    // unscored builds wait for the fill walk; its first slice goes now.
    await this.walk(store)
    await this.wake()
    return { ...placed, orders: [] }
  }

  /** marks a seed batch complete; the alarm writes its entries a slice at a time (store.rebuildEntries). returns
        whether entries remain to write. */
  async finishSeeds(resonator: number): Promise<boolean> {
    const store = this.board(resonator)
    if (!store.entriesStale()) return false
    store.hurryEntries()
    await this.wake()
    return true
  }

  /** a seed batch out: its builds and players here, and the detail objects its scored builds had. */
  async purgeSeeds(resonator: number, range: [number, number], uids: [number, number]): Promise<{ builds: number; players: number }> {
    const store = this.board(resonator)
    const purged = store.purgeSeeds(range, uids)
    const keys = [...new Set(purged.detail.map((row) => detailKey(row.rulesetId, resonator, formatBuildId({ resonator, local: row.local }))))]
    for (let start = 0; start < keys.length; start += 1000) await this.env.LB_DATA.delete(keys.slice(start, start + 1000))
    await this.wake()
    return { builds: purged.builds, players: purged.players }
  }

  // reads

  async page(resonator: number, query: { pick?: reads.FacetPick; filter?: SrFilter; offset: number; limit: number }) {
    await this.syncCatalog(resonator)
    const store = this.board(resonator)
    const page = reads.page(store, query)
    // the page's lean rows get their breakdowns while the viewer looks: what a row's hover or build page shows.
    const live = store.liveRs
    if (page && live != null && this.env.SCORER) {
      const lean = store.leanCells(live, page.rows.map((row) => ({ local: row.local, cell: row.cell })))
      for (const { local, cell } of lean) {
        const key = `${live}:${local}:${cell}`
        if (!this.filling.has(key)) this.fillWanted.set(key, { rs: live, local, cell })
      }
      if (lean.length) await this.soon()
    }
    return page
  }

  /** one lean cell's breakdown for a build page or cell detail, computed now or by a fill in progress; null when the
        cell is not lean (its detail has the breakdown) or the fill failed. */
  async fillCell(resonator: number, local: number, key: string): Promise<CellDetail | null> {
    await this.syncCatalog(resonator)
    const store = this.board(resonator)
    const live = store.liveRs
    const info = live != null ? store.ruleset(live) : null
    const cell = info ? [...info.cells.entries()].find(([, def]) => def.key === key)?.[0] : undefined
    if (live == null || cell == null || !this.env.SCORER) return null
    return (await this.fill(store, [{ rs: live, local, cell }])).get(`${live}:${local}:${cell}`) ?? null
  }

  /** the alarm sooner than it would be: fills wait on it. */
  private async soon(): Promise<void> {
    const at = Date.now() + SOON_MS
    const current = await this.ctx.storage.getAlarm()
    if (current == null || current > at) await this.ctx.storage.setAlarm(at)
  }

  /** the wanted fills, a slice per alarm. */
  private async fillWantedSlice(store: BoardStore): Promise<void> {
    if (!this.fillWanted.size) return
    const items = [...this.fillWanted.values()].slice(0, FILL_SLICE)
    for (const item of items) this.fillWanted.delete(`${item.rs}:${item.local}:${item.cell}`)
    await this.fill(store, items)
  }

  /**
     * rescores lean cells with breakdowns (the scorer's POST /fill), one request per cell, and records each detail in
     * its staged body or patches it into the build's R2 object; returns each item's detail, with nothing for cells that
     * are not lean or failed.
     */
  private async fill(store: BoardStore, items: FillItem[]): Promise<Map<string, CellDetail | null>> {
    const out = new Map<string, CellDetail | null>()
    const waits: Array<Promise<void>> = []
    const fresh = new Map<number, FillItem[]>()
    for (const item of items) {
      const key = `${item.rs}:${item.local}:${item.cell}`
      const under = this.filling.get(key)
      if (under) waits.push(under.then((detail) => { out.set(key, detail) }))
      else (fresh.get(item.rs) ?? fresh.set(item.rs, []).get(item.rs)!).push(item)
    }
    for (const [rs, list] of fresh) {
      const info = store.ruleset(rs)
      if (!info) continue
      const lean = store.leanCells(rs, list)
      const byCell = new Map<number, typeof lean>()
      for (const entry of lean) (byCell.get(entry.cell) ?? byCell.set(entry.cell, []).get(entry.cell)!).push(entry)
      for (const [cell, builds] of byCell) {
        const message: GroupMessage = { k: 'g', res: store.resonator, rs, rid: info.id, cell, key: info.cells.get(cell)!.key, lane: 'bulk',
          builds: builds.map((entry) => ({ local: entry.local, gen: entry.gen, snap: toBase64(entry.snap) })) }
        const request = this.fillGroup(store, message)
        for (const entry of builds) {
          const key = `${rs}:${entry.local}:${cell}`
          const one = request.then((details) => details.get(entry.local) ?? null, () => null)
          this.filling.set(key, one)
          waits.push(one.then((detail) => { out.set(key, detail) }).finally(() => { this.filling.delete(key) }))
        }
      }
    }
    await Promise.all(waits)
    return out
  }

  /** fills one group through the scorer and records each build's detail; returns the details by build. */
  private async fillGroup(store: BoardStore, message: GroupMessage): Promise<Map<number, CellDetail>> {
    const response = await this.env.SCORER!.fetch('https://scorer/fill', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message), signal: AbortSignal.timeout(FILL_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`fill: ${response.status} ${await response.text()}`)
    const results = await response.json() as CellResult[]
    const details = new Map<number, CellDetail>()
    await Promise.all(results.map(async (result) => {
      if (result.status !== 'ok' || result.detail == null) return
      const detail = JSON.parse(result.detail) as CellDetail
      if (detail.lean || !detail.contribution) return
      if (await this.recordFill(store, result, detail)) details.set(result.local, detail)
    }))
    return details
  }

  /** records a fill's detail where its cell's detail is stored: the staged body, or the build's R2 object, patched in turn. */
  private async recordFill(store: BoardStore, result: CellResult, detail: CellDetail): Promise<boolean> {
    const target = store.fillTarget(result.rs, result.local, result.gen, result.cell)
    if (target === 'staged') return store.filled(result.rs, result.local, result.gen, result.cell, result.detail!)
    if (target !== 'object') return false
    const objectId = store.detailIdOf(result.rs, result.local)
    const info = store.ruleset(result.rs)
    if (!objectId || !info) return false
    const buildId = formatBuildId({ resonator: store.resonator, local: result.local })
    const objectKey = detailKey(objectId, store.resonator, buildId)
    const turn = (this.objectTurns.get(objectKey) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const found = await this.env.LB_DATA.get(objectKey)
      if (!found) return false
      const object = await gunzipJson<DetailObject>(await found.arrayBuffer())
      object.cells[info.cells.get(result.cell)!.key] = detail
      await this.env.LB_DATA.put(objectKey, await gzipJson(object), { httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' } })
      return store.filled(result.rs, result.local, result.gen, result.cell)
    })
    this.objectTurns.set(objectKey, turn)
    try { return await turn } finally { if (this.objectTurns.get(objectKey) === turn) this.objectTurns.delete(objectKey) }
  }

  async counts(resonator: number, filter?: SrFilter) {
    await this.syncCatalog(resonator)
    return reads.counts(this.board(resonator), filter)
  }

  async field(resonator: number) {
    await this.syncCatalog(resonator)
    const store = this.board(resonator)
    const live = store.liveRs
    if (live == null) return null
    return { rulesetId: store.ruleset(live)!.id, total: store.rank(live).total(0), field: reads.field(store, live) }
  }

  async build(resonator: number, local: number) {
    await this.syncCatalog(resonator)
    return reads.buildView(this.board(resonator), local)
  }

  /** builds' standings, by local id: profiles, the feed and history read them. */
  async standings(resonator: number, locals: number[]) {
    const store = this.board(resonator)
    return locals.map((local) => reads.rowView(store, local))
  }

  async playerBuilds(resonator: number, uid: number, withHidden: boolean) {
    const store = this.board(resonator)
    return reads.playerBuilds(store, uid, { withHidden }).map((standing) => reads.rowView(store, standing.local)!)
  }

  async history(resonator: number, uid: number, withHidden: boolean) {
    return reads.history(this.board(resonator), uid, withHidden)
  }

  async cardBuild(resonator: number, card: string) {
    const store = this.board(resonator)
    const [build] = store.buildsOfCard(card)
    return build ? reads.standing(store, build.id) : null
  }

  /** a ruleset's jobs here by status, or null when the board has not installed it. */
  async jobs(resonator: number, rulesetId: string, { force = false } = {}) {
    await this.syncCatalog(resonator, { force })
    const store = this.board(resonator)
    const info = store.rulesetById(rulesetId)
    if (!info) return null
    return { ...store.jobCounts(info.rs), builds: store.keptBuilds(), settled: store.rulesetSettled(info.rs) }
  }

  /**
     * a sample check's draw (moderation/checks.ts): up to `per` random ok scores of the ruleset per named scenario,
     * from active builds with finished jobs there, each with its build's packed snapshot; `eligible` counts the source
     * builds.
     */
  async samples(resonator: number, rulesetId: string, keys: string[], per: number) {
    const store = this.board(resonator)
    const info = store.rulesetById(rulesetId)
    const cells = info ? [...info.cells.values()].filter((cell) => keys.includes(cell.key)) : []
    if (!info || !cells.length) return { eligible: 0, rows: [] as Array<{ local: number; key: string; snap: string }> }
    return store.sampleScores(info.rs, cells.map((cell) => cell.cell), per)
  }

  /** one stored score as a sample check compares it (samples' rule), or null when it is not one. */
  async storedCell(resonator: number, rulesetId: string, local: number, key: string) {
    const store = this.board(resonator)
    const info = store.rulesetById(rulesetId)
    const cell = info && [...info.cells.values()].find((entry) => entry.key === key)
    if (!info || !cell) return null
    const build = store.build(local)
    const job = store.job(info.rs, local)
    const row = build?.state === STATE.active && job?.status === JOB.scored ? store.scoreOf(info.rs, local, cell.cell) : null
    if (!row || row.status !== CELL_STATUS.ok) return null
    const stats = store.sql.first<{ stats: Uint8Array }>(`SELECT stats FROM w${info.rs} WHERE build = ? AND weapon = ?`, local, cell.weaponId)
    return { status: 'ok' as const, score: row.q == null ? null : fromQ(row.q), damage: row.damage, flags: row.flags,
      reason: store.reasonText(row.reason), stats: stats ? toBase64(stats.stats) : null, detailId: store.detailIdOf(info.rs, local) ?? rulesetId }
  }

  /** the scoring times recorded here since `since` (14 days are kept), each with its scenario key (staff timings). */
  async timings(resonator: number, since: number) {
    return this.board(resonator).sql.all<{ key: string | null; lane: number; runner: string; status: number; ms: number; wall_ms: number | null
      stages: string | null; anchor: string | null }>(`SELECT c.key, t.lane, t.runner, t.status, t.ms, t.wall_ms, t.stages, t.anchor FROM timings t
      LEFT JOIN cells c ON c.rs = t.rs AND c.cell = t.cell WHERE t.at >= ?`, since)
  }

  /** a build's lifecycle events here, oldest first (staff history). */
  async events(resonator: number, local: number) {
    return this.board(resonator).sql.all<{ at: number; kind: string; actor: string | null; data: string | null }>(
      `SELECT at, kind, actor, data FROM events WHERE build = ? ORDER BY at`, local)
  }

  async ver(resonator: number): Promise<number> {
    return this.board(resonator).ver
  }

  async health(resonator: number) {
    const store = this.board(resonator)
    return {
      resonator, ver: store.ver, live: store.liveRs,
      rulesets: store.activeRulesets().map((info) => ({ rs: info.rs, id: info.id, state: info.state, cells: info.cells.size,
        listed: store.rank(info.rs).total(0), settled: store.rulesetSettled(info.rs),
        // a rollout's entries: waiting for its walk, being written once it is done, or written.
        entries: store.deferredRulesets().includes(info.rs) ? 'deferred' : store.entriesWaiting(info.rs) ? 'writing' : 'ready' })),
      builds: store.keptBuilds(),
      outbox: store.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox`)!.n,
      openJobs: store.hasOpenJobs(),
      bytes: this.ctx.storage.sql.databaseSize,
      ...this.scoreDefects(store),
    }
  }

  /** live-ruleset cells that failed to score, and scores above the perfect build (an anchor defect). */
  private scoreDefects(store: BoardStore) {
    const rs = store.liveRs
    const info = rs == null ? null : store.ruleset(rs)
    if (rs == null || !info) return { errorRows: 0, overPerfect: { n: 0, scores: [] as Array<{ buildId: string; scenarioId: string; score: number }> } }
    const { errorRows, over, overTop } = store.scoreDefects(rs)
    const scores = overTop.map((row) => ({ buildId: formatBuildId({ resonator: store.resonator, local: row.build }),
      scenarioId: `${info.id}:${info.cells.get(row.cell)?.key ?? row.cell}`, score: fromQ(row.q) }))
    return { errorRows, overPerfect: { n: over, scores } }
  }

  // scoring messages

  private async send(orders: JobOrder[]): Promise<void> {
    if (!orders.length || !this.store) return
    const store = this.store
    // bulk work without a reuse offer is staged and goes as groups; the rest goes now, a message per cell or job.
    const staged = orders.filter((order) => order.lane === 'bulk' && !order.reuse)
    const direct = orders.filter((order) => !(order.lane === 'bulk' && !order.reuse))
    for (const lane of ['interactive', 'bulk'] as const) {
      const messages: ScoreMessage[] = []
      for (const order of direct.filter((entry) => entry.lane === lane)) {
        const build = store.build(order.local)
        if (!build) continue
        const snap = toBase64(build.snap)
        if (order.reuse && lane === 'bulk') {
          // the whole job in one message; the scorer keeps what it can and forwards the rest as cells
          messages.push({ k: 'r', res: store.resonator, local: order.local, gen: order.gen, rs: order.rs, rid: order.rulesetId,
            from: order.reuse.from, fid: order.reuse.fromId, ...(order.reuse.detailId !== order.reuse.fromId ? { did: order.reuse.detailId } : {}),
            lane: 'bulk', snap, cells: order.cells,
            old: order.reuse.old.map((cell) => ({ ...cell, stats: cell.stats ? toBase64(cell.stats) : null })) } satisfies ReuseMessage)
          continue
        }
        order.cells.forEach((cell, index) => messages.push({ k: 's', res: store.resonator, local: order.local, gen: order.gen, rs: order.rs,
          rid: order.rulesetId, cell: cell.cell, key: cell.key, snap, ...(lane === 'bulk' ? { lane: 'bulk' as const } : {}),
          ...(index === 0 && order.rs === (store.liveRs ?? order.rs) ? { cs: 1 as const } : {}) } satisfies CellMessage))
      }
      await sendAll(lane === 'bulk' ? this.env.SCORE_BULK_QUEUE ?? this.env.SCORE_QUEUE : this.env.SCORE_QUEUE, messages)
    }
    store.markSent(direct, Date.now())
    if (staged.length) {
      store.stage(staged, Date.now())
      await this.sendGroups(store)
    }
  }

  /** how long staged cells wait for more builds of their program (GROUP_WAIT_MS, else the store's default). */
  private groupWait(): number {
    const value = Number(this.env.GROUP_WAIT_MS)
    return this.env.GROUP_WAIT_MS != null && Number.isFinite(value) && value >= 0 ? value : GROUP_WAIT_MS
  }

  /** staged bulk cells sent as group messages: full groups at once, the rest once they have waited (store.cutGroups). */
  private async sendGroups(store: BoardStore, flush = false): Promise<void> {
    const queue = this.env.SCORE_BULK_QUEUE ?? this.env.SCORE_QUEUE
    for (;;) {
      const groups = store.cutGroups(Date.now(), this.groupWait(), flush)
      if (!groups.length) return
      const messages: GroupMessage[] = groups.map((group) => ({ k: 'g', res: store.resonator, rs: group.rs, rid: group.rulesetId,
        cell: group.cell, key: group.key, lane: 'bulk',
        builds: group.builds.flatMap((entry) => {
          const build = store.build(entry.local)
          return build ? [{ local: entry.local, gen: entry.gen, snap: toBase64(build.snap), ...(entry.cs ? { cs: 1 as const } : {}) }] : []
        }) }))
      await sendAll(queue, messages.filter((message) => message.builds.length))
    }
  }

  // alarm

  /** schedules the alarm soon when work is pending. */
  private async wake(): Promise<void> {
    const store = this.store
    if (!store) return
    const now = Date.now()
    const pending = store.outbox(1).length > 0 || store.pendingDetail(1).length > 0 || store.hasRolloutWork() || store.detailPurges().length > 0
      || this.fillWanted.size > 0
    // heavy work waits for this isolate's next turn (pace.ts), and a stale board's entries wait for its seed's quiet window
    const background = BACKGROUND.some((task) => task.wants(store, now))
    const stale = store.entriesStaleSince()
    const staged = store.stagedSince()
    const at = Math.min(pending ? now + SOON_MS : Infinity,
      background ? now + Math.max(SOON_MS, heavyWait(now)) + Math.floor(Math.random() * TURN_JITTER_MS) : Infinity,
      staged != null ? Math.max(now + SOON_MS, staged + this.groupWait()) : Infinity,
      store.hasOpenJobs() ? Date.now() + WATCH_MS : Infinity, stale != null ? stale + SEED_QUIET_MS : Infinity)
    if (at === Infinity) return
    const current = await this.ctx.storage.getAlarm()
    if (current == null || current > at) await this.ctx.storage.setAlarm(at)
  }

  async alarm(): Promise<void> {
    const resonator = await this.ctx.storage.sql.exec(`SELECT v FROM meta WHERE k = 'resonator'`).toArray()[0]?.v as number | undefined
    if (resonator == null) return
    const store = this.board(resonator)
    await this.syncCatalog(resonator)
    // what players wait on, every alarm: each pass bounded (a slice of builds, a batch of ops or objects).
    await this.flushDetail(store)
    await this.fillWantedSlice(store)
    await this.flushOutbox(store)
    await this.rollOut(store)
    await this.sendGroups(store)
    await this.purgeDetail(store)
    await this.sweep(store, Date.now())
    // then one heavy step, the most urgent, if this isolate has a turn for it.
    const now = Date.now()
    const task = BACKGROUND.find((candidate) => candidate.wants(store, now))
    if (task) await heavyStep(now, () => task.step(store, now))
    await this.flushOutbox(store)
    await this.wake()
  }

  /** each finished job's staged detail as its one R2 object. */
  private async flushDetail(store: BoardStore): Promise<void> {
    for (const pending of store.pendingDetail(25)) {
      const info = store.ruleset(pending.rs)
      if (!info) continue
      const staged = store.stagedDetail(pending.rs, pending.local)
      const buildId = formatBuildId({ resonator: store.resonator, local: pending.local })
      const object: DetailObject = { v: 1, rulesetId: info.id, buildId, gen: pending.gen, cells: {} }
      for (const [cell, body] of staged) object.cells[info.cells.get(cell)!.key] = JSON.parse(body) as CellDetail
      await this.env.LB_DATA.put(detailKey(info.id, store.resonator, buildId), await gzipJson(object),
        { httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' } })
      store.detailWritten(pending.rs, pending.local, pending.gen, Date.now())
    }
  }

  /** an ended ruleset's detail objects on this board, a slice per alarm until none is left. */
  private async purgeDetail(store: BoardStore): Promise<void> {
    const [id] = store.detailPurges()
    if (id == null) return
    const after = store.detailPurgeAfter()
    const listed = await this.env.LB_DATA.list({ prefix: `detail/${id}/${store.resonator}/`, limit: PURGE_SLICE, ...(after ? { startAfter: after } : {}) })
    // an object a later ruleset's job still reads stays (a rollout kept that build's every cell); the purge moves past it.
    const locals = listed.objects.map((object) => parseBuildId(object.key.slice(object.key.lastIndexOf('/') + 1).replace(/\.json\.gz$/, ''))?.local ?? -1)
    const readers = store.detailReaders(id, locals.filter((local) => local >= 0))
    const doomed = listed.objects.filter((_, index) => !readers.has(locals[index])).map((object) => object.key)
    if (doomed.length) await this.env.LB_DATA.delete(doomed)
    if (!listed.truncated) store.detailPurged(id)
    else if (listed.objects.length) store.detailPurgeProgress(listed.objects.at(-1)!.key)
  }

  private async flushOutbox(store: BoardStore): Promise<void> {
    for (let round = 0; round < 20; round += 1) {
      const ops = store.outbox(OUTBOX_BATCH)
      if (!ops.length) return
      const applied = await applyOutbox(this.env.LB, String(store.resonator), ops, Date.now())
      store.outboxApplied(applied)
    }
  }

  /** a rolling-out ruleset walks the board a slice per alarm; once it has passed every build its jobs are scoring. */
  private async rollOut(store: BoardStore): Promise<void> {
    for (const info of store.activeRulesets()) {
      if (info.rs === store.liveRs) continue
      const { orders } = store.fanOutSlice(info.rs, ROLLOUT_SLICE, Date.now())
      await this.send(orders)
    }
    await this.walk(store)
  }

  /** a rescore of every build, and a seed batch's unscored builds, walk the board as a rollout does: a slice each. */
  private async walk(store: BoardStore): Promise<void> {
    for (const kind of WALKS) {
      for (const rs of Object.keys(store.walks(kind)).map(Number)) await this.send(store.walkSlice(kind, rs, ROLLOUT_SLICE, Date.now()))
    }
  }

  /** sends unsent orders and resumes stalled jobs, finishing them on their scored cells after MAX_RESUMES. local dev
        skips this while its node scorer is busy, where a long queue is not a stall. */
  private async sweep(store: BoardStore, now: number, stallMs = STALL_MS): Promise<{ unsent: number; resumed: number; abandoned: number }> {
    const report = { unsent: 0, resumed: 0, abandoned: 0 }
    const unsent = store.unsentOrders()
    await this.send(unsent)
    report.unsent = unsent.length
    if (this.env.LOCAL_SCORER_URL && await localScorerBusy(this.env.LOCAL_SCORER_URL)) return report
    const orders: JobOrder[] = []
    for (const job of store.stalledJobs(now - stallMs)) {
      if (job.resumes >= MAX_RESUMES) {
        if (store.abandonJob(job.rs, job.local, job.gen, 'stalled', now)) report.abandoned += 1
        continue
      }
      const order = store.resumeJob(job.rs, job.local, job.gen, now)
      if (order) orders.push(order)
    }
    await this.send(orders)
    report.resumed = orders.length
    return report
  }

  /** the upkeep pass on demand (maintenance, local dev's startup): `stallMs` 0 resumes every open job. */
  async upkeep(resonator: number, stallMs = STALL_MS) {
    const store = this.board(resonator)
    await this.syncCatalog(resonator, { force: true })
    await this.flushDetail(store)
    await this.rollOut(store)
    const report = await this.sweep(store, Date.now(), stallMs)
    store.resummarize()
    await this.flushOutbox(store)
    await this.wake()
    return report
  }

  /** a job whose cell dead-lettered: that cell is an error row, and the job finishes once it is the last. */
  async deadCell(resonator: number, message: Pick<CellMessage, 'rs' | 'local' | 'gen' | 'cell'>): Promise<RecordAck> {
    const store = this.board(resonator)
    const info = store.ruleset(message.rs)
    const cell = info?.cells.get(message.cell)
    if (!cell) return 'stale'
    const [ack] = store.recordScores([{ rs: message.rs, local: message.local, gen: message.gen, cell: message.cell, status: 'error',
      score: null, damage: null, dpr: null, flags: 0, reason: 'dead_lettered', weapon: cell.weaponId, stats: null, detail: null }], Date.now()).acks
    await this.wake()
    return ack
  }

}

async function localScorerBusy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`)
    if (!response.ok) return true
    const health = await response.json().catch(() => ({})) as { busy?: number; waiting?: Record<string, number> }
    const waiting = Object.values(health.waiting ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0)
    return (Number(health.busy) || 0) > 0 || waiting > 0
  } catch {
    // a scorer that is down cannot be waited on productively; resuming only queues the same work again.
    return true
  }
}

/** messages to a queue in batches a send takes: at most 100 messages and about 240 KB of bodies each. */
async function sendAll(queue: Queue, messages: ScoreMessage[]): Promise<void> {
  let batch: ScoreMessage[] = []
  let bytes = 0
  for (const message of messages) {
    const size = JSON.stringify(message).length + 100
    if (batch.length && (batch.length >= 100 || bytes + size > SEND_BATCH_BYTES)) {
      await queue.sendBatch(batch.map((body) => ({ body })))
      batch = []
      bytes = 0
    }
    batch.push(message)
    bytes += size
  }
  if (batch.length) await queue.sendBatch(batch.map((body) => ({ body })))
}
