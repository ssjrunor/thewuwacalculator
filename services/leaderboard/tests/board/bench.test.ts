/*
  Author: Runor Ewhro
  description: large-board timings on node:sqlite (a file, like a Durable
               Object's), skipped unless BENCH_BOARD is a build count, e.g.
               BENCH_BOARD=200000 npx vitest run
               services/leaderboard/tests/board/bench.test.ts. builds are added
               through the store's place and recordScores (a thousand per
               transaction) on a 5-team, 4-weapon ruleset, then each read and
               write is timed with p50 and p95 over repeats.
*/

import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { nodeSql } from '../../src/board/sql.ts'
import { BoardStore } from '../../src/board/store.ts'
import { cellRanks, counts, field, page, standing } from '../../src/board/reads.ts'
import type { CellResult } from '../../src/board/types.ts'
import { facts, random, rulesetDef, snapOf } from './support.ts'

const N = Number(process.env.BENCH_BOARD ?? 0)
const TEAMS = ['t0', 't1', 't2', 't3', 't4']
const WEAPONS = [21010011, 21010012, 21010013, 21010014]

function time(label: string, repeats: number, work: (index: number) => void) {
  const spent: number[] = []
  for (let index = 0; index < repeats; index += 1) {
    const start = performance.now()
    work(index)
    spent.push(performance.now() - start)
  }
  spent.sort((a, b) => a - b)
  const at = (fraction: number) => spent[Math.min(spent.length - 1, Math.floor(spent.length * fraction))]
  console.log(`${label.padEnd(34)} p50 ${at(0.5).toFixed(3).padStart(8)} ms   p95 ${at(0.95).toFixed(3).padStart(8)} ms`)
}

describe.skipIf(!N)('board bench', () => {
  it(`answers a ${N}-build board`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-bench-'))
    const path = join(dir, 'board.sqlite')
    const db = new DatabaseSync(path)
    db.exec('PRAGMA journal_mode = WAL')
    const sql = nodeSql(db)
    const store = new BoardStore(sql, 1506)
    store.installRuleset(rulesetDef(1, { teams: TEAMS, weapons: WEAPONS }), 1, { live: true })
    const cells = [...store.ruleset(1)!.cells.values()]
    const rand = random(42)
    // scores cluster like a real board: most builds in a band, ties on round values.
    const scoreOf = () => Math.round((80 + (rand.next() + rand.next() + rand.next() - 1.5) * 40) * 10_000) / 10_000
    const resultsFor = (local: number, gen: number): CellResult[] => cells.map((cell) => ({ rs: 1, local, gen, cell: cell.cell, status: 'ok',
      score: scoreOf(), damage: 1e6 * rand.next(), dpr: 1e5, flags: 0, reason: null, weapon: cell.weaponId, stats: new Uint8Array(104), detail: null }))
    let now = 1_000
    const load = performance.now()
    for (let start = 0; start < N; start += 1000) {
      store.write(() => {
        for (let index = start; index < Math.min(N, start + 1000); index += 1) {
          const uid = 100_000_000 + index
          const placed = store.place({ uid, player: facts(uid), card: `c${index}`, snap: snapOf(uid, index % 7, index % 50), snapHash: `h${index}`,
            seq: index % 7, drawnAt: now, owner: true, now: now++ })
          store.recordScores(resultsFor(placed.placement.local, placed.jobs[0].gen), now)
          for (const pending of store.pendingDetail()) store.detailWritten(pending.rs, pending.local, pending.gen, now)
        }
        store.outboxApplied(Number.MAX_SAFE_INTEGER)
      })
    }
    const loadMs = performance.now() - load
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const bytes = statSync(path).size
    console.log(`\n${N} builds in ${(loadMs / 1000).toFixed(1)} s (${(N / (loadMs / 1000)).toFixed(0)}/s), ` +
      `${(bytes / 1e6).toFixed(1)} MB, ${(bytes / N).toFixed(0)} B per build\n`)
    // where the bytes are: each table with its indexes, pages included (dbstat counts whole pages, free space too).
    const tables = db.prepare(`SELECT tbl_name AS name, SUM(pgsize) AS size FROM dbstat JOIN sqlite_schema USING (name) GROUP BY tbl_name
      ORDER BY size DESC`).all() as Array<{ name: string; size: number }>
    for (const table of tables.filter((row) => row.size / N >= 1)) console.log(`${table.name.padEnd(12)} ${(table.size / N).toFixed(0).padStart(6)} B per build`)
    console.log('')

    const fresh = () => new BoardStore(sql, 1506)
    time('cold facet load (all)', 5, () => fresh().rank(1).total(0))
    time('cold facet load (team+seq filter)', 5, () => fresh().rank(1).total(1, { seq: 3, region: null }))
    time('page 0 (50)', 200, () => page(store, { offset: 0, limit: 50 }))
    time('page deep (50)', 200, (index) => page(store, { offset: Math.floor(((index * 7919) % 1000) / 1000 * (N - 50)), limit: 50 }))
    time('page team, seq filter (50)', 200, (index) =>
      page(store, { pick: { team: TEAMS[index % 5], weapon: null }, filter: { seq: index % 7, region: null }, offset: index * 13, limit: 50 }))
    time('page cell, server filter (50)', 200, (index) =>
      page(store, { pick: { team: TEAMS[index % 5], weapon: WEAPONS[index % 4] }, filter: { seq: null, region: 1 + (index % 5) }, offset: index * 3, limit: 50 }))
    time('rank (all)', 500, () => store.rank(1).rank(0, { seq: null, region: null }, Math.round(scoreOf() * 10_000)))
    time('counts', 200, () => counts(store))
    time('standing', 500, (index) => standing(store, 1 + ((index * 104_729) % N)))
    time('cell ranks (20 cells)', 200, (index) => cellRanks(store, 1, 1 + ((index * 104_729) % N)))
    time('field', 50, () => field(store, 1))
    time('place (new build)', 200, (index) => {
      const uid = 900_000_000 + index
      store.place({ uid, player: facts(uid), card: `n${index}`, snap: snapOf(uid, 2, index), snapHash: `n${index}`, seq: 2, drawnAt: now, owner: true, now: now++ })
    })
    const fresh200 = Array.from({ length: 200 }, (_, index) => {
      const local = store.sql.first<{ id: number }>(`SELECT id FROM builds WHERE uid = ?`, 900_000_000 + index)!.id
      return { local, gen: store.job(1, local)!.gen }
    })
    time('recordScores(20) + finalize', 200, (index) => store.recordScores(resultsFor(fresh200[index].local, fresh200[index].gen), now++))
    time('owner hide + show (relist)', 100, (index) => {
      const local = 1 + ((index * 7_919) % N)
      const uid = store.build(local)!.uid
      store.setOwnerHidden(local, uid, true, now++)
      store.setOwnerHidden(local, uid, false, now++)
    })
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }, 3_600_000)
})
