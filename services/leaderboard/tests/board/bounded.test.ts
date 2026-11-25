/*
  Author: Runor Ewhro
  description: background work stays bounded per call. each heavy alarm step
               (BoardDO BACKGROUND) writes at most its slice at any board size
               and still finishes; migrations change only structure and leave
               row work to those steps; and steps on one
               thread take turns and wait while a request runs (pace.ts).
*/

import { afterEach, describe, expect, it } from 'vitest'
import { BoardStore } from '../../src/board/store.ts'
import { MIGRATIONS, RULESET_MIGRATIONS, rulesetTables } from '../../src/board/schema.ts'
import { heavyStep, heavyWait, HEAVY_GAP_MS, resetPace, serving } from '../../src/board/pace.ts'
import type { SqlLike, SqlValue } from '../../src/board/sql.ts'
import type { CellResult } from '../../src/board/types.ts'
import { facts, memoryBoard, rulesetDef, snapOf } from './support.ts'
import { fromQ } from '../../src/lib/score.ts'

/** cells in rulesetDef's default ruleset (3 teams x 2 weapons), and a build's entry facets: the board, 3 teams, 2
    weapons and 6 cells. */
const CELLS = 6
const ENTRIES = 1 + 3 + 2 + CELLS

/** a scored board of `builds` builds over half as many players. */
function scoredBoard(builds: number) {
  const made = memoryBoard()
  const { store } = made
  store.installRuleset(rulesetDef(1), 1, { live: true })
  let now = 10
  for (let index = 0; index < builds; index += 1) {
    const uid = 500_000_000 + (index % Math.ceil(builds / 2))
    const { placement } = store.place({ uid, player: facts(uid), card: `c${index}`, snap: snapOf(uid, index % 7, index), snapHash: `h${index}`,
      seq: index % 7, drawnAt: now, owner: true, now: now++ })
    const job = store.job(1, placement.local)!
    const results: CellResult[] = [...store.ruleset(1)!.cells.values()].map((cell) => ({ rs: 1, local: placement.local, gen: job.gen,
      cell: cell.cell, status: 'ok', score: 50 + ((index * 7 + cell.cell) % 40), damage: 10, dpr: 1, flags: 0, reason: null,
      weapon: cell.weaponId, stats: null, detail: '{}' }))
    store.recordScores(results, now++)
  }
  store.outboxApplied(store.outbox(100_000).at(-1)?.seq ?? 0)
  return { ...made, now }
}

/** the rows a piece of work inserted, updated or deleted. */
function rowsWritten(sql: SqlLike, work: () => unknown): number {
  const before = sql.first<{ n: number }>(`SELECT total_changes() AS n`)!.n
  work()
  return sql.first<{ n: number }>(`SELECT total_changes() AS n`)!.n - before
}

/** runs `step` until it reports nothing left; returns the most rows one call wrote and the call count. */
function steps(sql: SqlLike, step: () => boolean, cap = 10_000) {
  let most = 0
  let calls = 0
  let more = true
  while (more) {
    if (++calls > cap) throw new Error('a background step never finished')
    most = Math.max(most, rowsWritten(sql, () => { more = step() }))
  }
  return { most, calls }
}

afterEach(() => resetPace())

describe('bounded background work', () => {
  it('checks every player\'s standing after a go-live a slice of players per step', () => {
    const { sql, store } = scoredBoard(80)
    sql.run(`INSERT OR REPLACE INTO meta (k, v) VALUES ('standings_from', 0)`)
    const slice = 7
    const run = steps(sql, () => store.standingsSlice(slice))
    expect(run.most).toBeLessThanOrEqual(slice * 3 + 2)
    expect(run.calls).toBe(Math.floor(40 / slice) + 1)
    expect(store.standingsPending()).toBe(false)
  })

  it('rebuilds the entries in steps of a few builds staged or a few entries sorted, to the same entries', () => {
    const { sql, store } = scoredBoard(120)
    const before = sql.all(`SELECT facet, ns, build, sr, cell FROM e1 ORDER BY facet, ns, build`)
    const counts = sql.all(`SELECT facet, sr, bucket, n FROM c1 WHERE n > 0 ORDER BY facet, sr, bucket`)
    sql.run(`INSERT OR REPLACE INTO meta (k, v) VALUES ('entries_stale', 0)`)
    const range = 10
    const sort = 25
    const run = steps(sql, () => !store.rebuildEntries(1, range, sort))
    // a stage step writes each build's entries and listing, a sort step its entries and counts, plus the job
    expect(run.most).toBeLessThanOrEqual(Math.max(range * (ENTRIES + 1), sort * 2) + 4)
    expect(run.calls).toBeGreaterThan(120 / range)
    expect(sql.all(`SELECT facet, ns, build, sr, cell FROM e1 ORDER BY facet, ns, build`)).toEqual(before)
    expect(sql.all(`SELECT facet, sr, bucket, n FROM c1 WHERE n > 0 ORDER BY facet, sr, bucket`)).toEqual(counts)
  })

  it('writes a rollout\'s entries once its walk is done, a slice per step, as listing each build would have', () => {
    const { sql, store, now } = scoredBoard(120)
    store.installRuleset(rulesetDef(2), now)
    while (store.fanOutSlice(2, 50, now).orders.length) { /* every build's job on 2 */ }
    // the same scores as ruleset 1, so the same entries
    for (const { build, gen } of sql.all<{ build: number; gen: number }>(`SELECT build, gen FROM j2 WHERE status = 0`)) {
      store.recordScores(store.scores(1, build).map((row) => ({ rs: 2, local: build, gen, cell: row.cell, status: 'ok' as const,
        score: fromQ(row.q!), damage: row.damage, dpr: 1, flags: 0, reason: null, weapon: store.ruleset(2)!.cells.get(row.cell)!.weaponId,
        stats: null, detail: '{}' })), now + 1)
    }
    // scoring wrote no entry: they wait for the walk.
    expect(sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM e2`)!.n).toBe(0)
    expect(store.rulesetSettled(2)).toBe(false)
    expect(store.endDeferrals()).toEqual([2])
    const range = 10
    const sort = 25
    const run = steps(sql, () => !store.rebuildEntries(1, range, sort))
    expect(run.most).toBeLessThanOrEqual(Math.max(range * (ENTRIES + 1), sort * 2) + 6)
    expect(sql.all(`SELECT facet, ns, build, sr, cell FROM e2 ORDER BY facet, ns, build`))
      .toEqual(sql.all(`SELECT facet, ns, build, sr, cell FROM e1 ORDER BY facet, ns, build`))
    expect(sql.all(`SELECT facet, sr, bucket, n FROM c2 WHERE n > 0 ORDER BY facet, sr, bucket`))
      .toEqual(sql.all(`SELECT facet, sr, bucket, n FROM c1 WHERE n > 0 ORDER BY facet, sr, bucket`))
    expect(store.rulesetSettled(2)).toBe(true)
  })

  it('prunes old timings a slice per step', () => {
    const { sql, store, now } = scoredBoard(4)
    for (let index = 0; index < 35; index += 1) {
      sql.run(`INSERT INTO timings (at, rs, cell, lane, runner, status, ms) VALUES (?, 1, 0, 'bulk', 'node', 0, 5)`, index + 1)
    }
    const later = now + 30 * 86_400_000
    const run = steps(sql, () => store.pruneTimings(later, 10) > 0 && store.timingsToPrune(later))
    // the slice, and the write's version mark.
    expect(run.most).toBeLessThanOrEqual(10 + 1)
    expect(run.calls).toBe(4)
    expect(store.timingsToPrune(later)).toBe(false)
  })
})

describe('migrations', () => {
  /** what a migration may do while a board loads: change structure, or note something in meta for the alarm. */
  const STRUCTURAL = /^\s*(CREATE|DROP|ALTER)\b|^\s*INSERT INTO meta\b/i

  it('change only structure, leaving row work to the alarm\'s background steps', () => {
    const statements = Object.values(MIGRATIONS).flat()
    expect(statements.filter((statement) => !STRUCTURAL.test(statement))).toEqual([])
    // a ruleset migration is code: what it runs on a ruleset's tables is recorded.
    const { sql } = memoryBoard()
    for (const statement of rulesetTables(1)) sql.run(statement)
    const ran: string[] = []
    const recording: SqlLike = {
      run: (query: string, ...binds: SqlValue[]) => { ran.push(query); return sql.run(query, ...binds) },
      all: <T,>(query: string, ...binds: SqlValue[]) => sql.all<T>(query, ...binds),
      first: <T,>(query: string, ...binds: SqlValue[]) => sql.first<T>(query, ...binds),
      transaction: (work) => sql.transaction(work),
    }
    for (const migrate of Object.values(RULESET_MIGRATIONS)) migrate(recording, 1)
    expect(ran.filter((statement) => !STRUCTURAL.test(statement))).toEqual([])
  })
})

describe('the thread\'s turns', () => {
  it('runs no heavy step while a request is served, and leaves the thread free after one', async () => {
    let ran = 0
    let release!: () => void
    const request = serving(() => new Promise<void>((resolve) => { release = resolve }))
    expect(heavyWait(Date.now())).toBeGreaterThan(0)
    expect(await heavyStep(Date.now(), () => { ran += 1 })).toBe(false)
    release()
    await request
    expect(heavyWait(Date.now())).toBe(0)
    expect(await heavyStep(Date.now(), () => { ran += 1 })).toBe(true)
    expect(ran).toBe(1)
    // the next waits out at least the gap.
    expect(heavyWait(Date.now())).toBeGreaterThan(HEAVY_GAP_MS - 50)
    expect(await heavyStep(Date.now(), () => { ran += 1 })).toBe(false)
  })

  it('keeps a store usable by later steps when one throws', async () => {
    await expect(heavyStep(Date.now(), () => { throw new Error('step failed') })).rejects.toThrow('step failed')
    expect(heavyWait(Date.now())).toBeGreaterThan(0)
    resetPace()
    expect(heavyWait(Date.now())).toBe(0)
    expect(new BoardStore(memoryBoard().sql, 1506).entriesStale()).toBe(false)
  })
})
