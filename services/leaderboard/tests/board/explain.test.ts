/*
  Author: Runor Ewhro
  description: board statements avoid walking large tables. every statement the
               store and its reads run during a workload goes through EXPLAIN
               QUERY PLAN on the real schema, and a SCAN of anything except the
               small tables (and intended whole-board passes) fails.
*/

import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { nodeSql, type SqlLike, type SqlValue } from '../../src/board/sql.ts'
import { BoardStore, OVER_PERFECT } from '../../src/board/store.ts'
import { SCORE_FLAGS } from '../../src/scorer/job.ts'
import { ensureSchema, rulesetTables } from '../../src/board/schema.ts'
import { cellRanks, counts, field, page, playerBuilds, rowView, standing } from '../../src/board/reads.ts'
import type { CellResult } from '../../src/board/types.ts'
import { facts, rulesetDef, snapOf } from './support.ts'

/** tables small enough to scan: per-board settings, a ruleset's cells, interned texts, the outbox queue, and a
    statement's bound json list or constant row. */
const SMALL = /^SCAN (meta|rulesets|cells|reasons|outbox|json_each|CONSTANT ROW)\b/
/** partial indexes of open or unfinished work, or of rare defective scores, which scan only those rows. */
const PARTIAL = /^SCAN j1 USING (COVERING )?INDEX j1_(open|unsent|detail)$/
/** a ruleset's staged bulk cells, bounded by its open bulk jobs (OPEN_BULK_JOBS, about 20 cells each), so the
    alarm's cut scans it. */
const STAGED = /^SCAN n1\b/
/** the latest timings the costs average (store.meanCosts), a subquery bounded by its LIMIT and read on timings_at. */
const SAMPLE = /^SCAN t$/
/** an index whose key almost every row shares (nearly every build is active, state 0), so searching it alone reads
    the board; only the rare states (deleted, hidden) may use it. */
const WIDE = /USING (COVERING )?INDEX builds_state \(state=\?\)$/
/** the statements allowed to search builds_state: a literal rare state (1 replaced, 2 deleted, 3 hidden), or the
    admin count of kept builds, which reads the index alone on purpose (store.keptBuilds). */
const RARE_STATE = /\bstate (=|IN \() ?[123]\b|^SELECT COUNT\(\*\) AS n FROM builds WHERE state = 0$/

/** intended whole-board passes outside requests; empty, since background work runs a slice at a time
    (tests/board/bounded.test.ts). */
const WHOLE_BOARD: RegExp[] = []

function recording(sql: SqlLike, seen: Set<string>): SqlLike {
  const note = (query: string) => {
    seen.add(query.replace(/\s+/g, ' ').trim())
  }
  return {
    run: (query, ...binds) => (note(query), sql.run(query, ...binds)),
    all: <T,>(query: string, ...binds: SqlValue[]) => (note(query), sql.all<T>(query, ...binds)),
    first: <T,>(query: string, ...binds: SqlValue[]) => (note(query), sql.first<T>(query, ...binds)),
    transaction: (work) => sql.transaction(work),
  }
}

describe('board query plans', () => {
  it('searches an index for every statement a request runs', () => {
    const db = new DatabaseSync(':memory:')
    const seen = new Set<string>()
    const sql = recording(nodeSql(db), seen)
    const store = new BoardStore(sql, 1506)
    let now = 10
    store.installRuleset(rulesetDef(1), now, { live: true })
    const locals: number[] = []
    for (let index = 0; index < 40; index += 1) {
      const uid = 500_000_000 + (index % 25)
      const placed = store.place({ uid, player: facts(uid), card: `c${index}`, snap: snapOf(uid, index % 7, index), snapHash: `h${index}`,
        seq: index % 7, drawnAt: now, owner: true, now: now++ })
      store.markSent(placed.jobs, now)
      locals.push(placed.placement.local)
      const job = store.job(1, placed.placement.local)!
      const results: CellResult[] = [...store.ruleset(1)!.cells.values()].map((cell) => ({ rs: 1, local: job.build, gen: job.gen, cell: cell.cell,
        status: cell.cell === 5 ? 'error' : 'ok', score: cell.cell === 5 ? null : 50 + ((index * 7 + cell.cell) % 13), damage: 10, dpr: 1, flags: 0,
        reason: cell.cell === 5 ? 'no_refs' : null, weapon: cell.weaponId, stats: new Uint8Array(104), detail: '{}',
        timing: { lane: 'interactive', runner: 'gpu', ms: 5, wallMs: 6, stages: null, anchorSource: null } }))
      store.recordScores(results, now++)
    }
    for (const pending of store.pendingDetail()) store.detailWritten(pending.rs, pending.local, pending.gen, now)
    store.setOwnerHidden(locals[30], 500_000_005, true, now++)
    store.endBuild(locals[31], 'hidden', 'staff', now++)
    store.restoreBuild(locals[31], 'staff', now++)
    store.endBuild(locals[32], 'deleted', 'uid', now++)
    store.syncPlayer(facts(500_000_003, { hideUid: true, ver: 2 }))
    store.restartJob(1, locals[33], 'bulk', now++)
    store.failJob(1, locals[33], store.job(1, locals[33])!.gen, now++)
    page(store, { offset: 0, limit: 20 })
    page(store, { offset: 7, limit: 20, filter: { seq: 2, region: null }, pick: { team: 'b', weapon: null } })
    page(store, { offset: 3, limit: 20, filter: { seq: null, region: 3 }, pick: { team: 'a', weapon: 21010012 } })
    page(store, { offset: 0, limit: 20, filter: { seq: 1, region: 2 }, pick: { team: null, weapon: 21010011 } })
    counts(store)
    store.keptBuilds()
    store.jobCounts(1)
    expect(store.scoreDefects(1).errorRows).toBeGreaterThan(0)
    store.resummarize()
    cellRanks(store, 1, locals[0])
    standing(store, locals[1])
    rowView(store, locals[3])
    playerBuilds(store, 500_000_002, { withEnded: true })
    field(store, 1)
    store.outboxApplied(store.outbox(5).at(-1)!.seq)
    // grouped bulk work: a rescore walk stages its builds, a reuse's leftovers come back staged, groups are cut, and old
    // timings are pruned.
    store.startRescoreWalk(1)
    const walked = store.rescoreSlice(1, 10, now++)
    store.stage(walked, now++)
    const leftover = store.job(1, locals[2])!
    store.recordScores([], now++, [{ rs: 1, local: locals[2], gen: leftover.gen, cells: [0, 1] }])
    store.stagedSince()
    store.cutGroups(now + 10_000, 5_000)
    store.cutGroups(now++, 0, true)
    store.openBulkJobs(1)
    store.hasRolloutWork()
    store.pruneTimings(now + 30 * 86_400_000)
    store.installRuleset(rulesetDef(2), now++)
    store.cancelRuleset(2, now++)
    store.installRuleset(rulesetDef(3), now++)
    store.goLive(3, now++)
    // the background steps the alarm runs afterwards: go-live standings, a rebuild, pruning
    while (store.standingsSlice(3));
    sql.run(`INSERT OR REPLACE INTO meta (k, v) VALUES ('entries_stale', 0)`)
    while (!store.rebuildEntries(1, 4, 5));
    store.timingsToPrune(now)
    new BoardStore(sql, 1506).rank(3).total(0)

    // read plans on a fresh schema (the workload ended rulesets and dropped their tables), with every ruleset's tables as 1's
    const plans = new DatabaseSync(':memory:')
    const planSql = nodeSql(plans)
    ensureSchema(planSql)
    for (const statement of rulesetTables(1)) planSql.run(statement)
    // a ruleset's tables as 1's, its rebuild tables (e1_new, e1_stage) too.
    const asOne = (query: string) => query.replace(/\b([swjdecn])\d+(?=_|\b)/g, '$11')
    // the tables a rebuild makes for itself, as the workload made them.
    for (const seenQuery of seen) {
      if (!/^CREATE (TABLE|INDEX)/i.test(seenQuery)) continue
      try {
        planSql.run(asOne(seenQuery))
      } catch (error) {
        if (!/already exists/.test(String(error))) throw error
      }
    }
    const scans: string[] = []
    for (const seenQuery of seen) {
      const query = asOne(seenQuery)
      if (!/^(SELECT|UPDATE|DELETE|INSERT)/i.test(query) || WHOLE_BOARD.some((pattern) => pattern.test(query))) continue
      const binds = (query.match(/\?/g) ?? []).map(() => null)
      const plan = plans.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...binds) as Array<{ detail: string }>
      for (const step of plan) {
        if (/^SCAN /.test(step.detail) && !SMALL.test(step.detail) && !PARTIAL.test(step.detail) && !STAGED.test(step.detail) &&
          !SAMPLE.test(step.detail)) {
          scans.push(`${step.detail}  <-  ${query}`)
        }
        if (WIDE.test(step.detail) && !RARE_STATE.test(query)) scans.push(`${step.detail}  <-  ${query}`)
      }
    }
    expect(seen.size).toBeGreaterThan(40)
    expect(scans).toEqual([])
  })

  it('names the scorer\'s past-perfect flag as the store does', () => {
    // the board defines its own copy of the flag (it does not import the scorer) and packs flags into 6 bits
    expect(OVER_PERFECT).toBe(SCORE_FLAGS.overPerfect)
    expect(Math.max(...Object.values(SCORE_FLAGS))).toBeLessThan(64)
  })
})
