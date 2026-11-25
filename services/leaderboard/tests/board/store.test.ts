/*
  Author: Runor Ewhro
  description: the board store under random work. after every step the board
               is compared with an independent model: each listed build's
               entries, the counts, every rank, total and page under every
               filter (against RANK() over the entries), one active build per
               player, and job progress. a cold store over the same database
               must return the same results.
*/

import { describe, expect, it } from 'vitest'
import { bucketOf } from '../../src/lib/score.ts'
import { BoardStore, regionKey, type BuildRow, type JobRow, type PlayerRow } from '../../src/board/store.ts'
import { counts, page, rankPage } from '../../src/board/reads.ts'
import { srOf, type SrFilter } from '../../src/board/rank.ts'
import type { CellResult, JobOrder, SeedBuild } from '../../src/board/types.ts'
import { SEED_LOCAL_FLOOR } from '../../src/lib/ids.ts'
import type { SqlLike } from '../../src/board/sql.ts'
import { facts, memoryBoard, random, rulesetDef, snapOf } from './support.ts'

const SCORES = [50, 50, 50.0001, 75, 100, 100, 100, 120.5, -3, 0, 1e5, -1e5]

interface Expected {
  facet: number
  ns: number
  build: number
  sr: number
  cell: number
}

/** a build's entries on a ruleset, worked out from its rows alone. */
function expectedEntries(store: BoardStore, sql: SqlLike, rs: number): Expected[] {
  const info = store.ruleset(rs)!
  const out: Expected[] = []
  const builds = sql.all<BuildRow>(`SELECT * FROM builds WHERE state = 0 AND owner_hidden_at IS NULL`)
  for (const build of builds) {
    const player = sql.first<PlayerRow>(`SELECT * FROM players WHERE uid = ?`, build.uid)
    if (player && player.flags & 4) continue
    const job = sql.first<JobRow>(`SELECT * FROM j${rs} WHERE build = ?`, build.id)
    if (!job || job.status !== 1) continue
    const ok = store.scores(rs, build.id).filter((row) => row.status === 0 && row.q != null && row.damage != null)
      .map((row) => ({ cell: row.cell, q: row.q!, damage: row.damage!, key: info.cells.get(row.cell)!.key }))
    const best = (rows: typeof ok) => [...rows].sort((a, b) => b.q - a.q || b.damage - a.damage || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))[0]
    const top = best(ok)
    // the job's best cell is the best of its ok cells.
    expect(job.best_cell ?? null).toBe(top?.cell ?? null)
    if (!top) continue
    const sr = srOf(build.seq, regionKey(player))
    const push = (facet: number, row: { q: number; cell: number }) => out.push({ facet, ns: row.q === 0 ? 0 : -row.q, build: build.id, sr, cell: row.cell })
    push(0, top)
    for (const row of ok) push(info.cells.get(row.cell)!.cellFacet, row)
    for (const [, facet] of info.teams) {
      const held = best(ok.filter((row) => info.cells.get(row.cell)!.teamFacet === facet))
      if (held) push(facet, held)
    }
    for (const [, facet] of info.weapons) {
      const held = best(ok.filter((row) => info.cells.get(row.cell)!.weaponFacet === facet))
      if (held) push(facet, held)
    }
  }
  const key = (row: Expected) => [row.facet, row.ns, row.build]
  return out.sort((a, b) => {
    const x = key(a)
    const y = key(b)
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
  })
}

const FILTERS: SrFilter[] = [
  { seq: null, region: null }, { seq: 0, region: null }, { seq: 3, region: null }, { seq: null, region: 1 }, { seq: null, region: 3 },
  { seq: 2, region: 2 }, { seq: 6, region: 5 },
]

const matches = (sr: number, filter: SrFilter) =>
  (filter.seq === null || Math.floor(sr / 8) === filter.seq) && (filter.region === null || sr % 8 === filter.region)

const sameEntry = (a: Expected, b: Expected) => a.facet === b.facet && a.ns === b.ns && a.build === b.build && a.sr === b.sr && a.cell === b.cell

function checkBoard(store: BoardStore, sql: SqlLike, rand: ReturnType<typeof random>, withCold: boolean) {
  // every kept build is active (no replaced state); a job's done is its rows.
  expect(sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM builds WHERE state NOT IN (0, 2, 3)`)!.n).toBe(0)
  for (const info of store.activeRulesets()) {
    const rs = info.rs
    expect(sql.all<{ build: number; done: number }>(`SELECT build, done FROM j${rs}`).filter((job) => job.done !== store.scores(rs, job.build).length)).toEqual([])
    // the health tally is the blobs' failed and past-perfect cells.
    const defects: Array<{ kind: number; build: number; cell: number; q: number | null }> = []
    for (const { build } of sql.all<{ build: number }>(`SELECT build FROM s${rs} ORDER BY build`)) {
      for (const row of store.scores(rs, build)) {
        if (row.status === 2) defects.push({ kind: 0, build, cell: row.cell, q: null })
        if (row.flags & 2) defects.push({ kind: 1, build, cell: row.cell, q: row.q })
      }
    }
    expect(sql.all(`SELECT kind, build, cell, q FROM x${rs} ORDER BY build, cell, kind`))
      .toEqual(defects.sort((a, b) => a.build - b.build || a.cell - b.cell || a.kind - b.kind))
    // the entries are exactly the listed builds' facets; a rollout's wait for its walk, then for their first rebuild.
    const entries = sql.all<Expected>(`SELECT facet, ns, build, sr, cell FROM e${rs} ORDER BY facet, ns, build`)
    const expected = expectedEntries(store, sql, rs)
    if (store.entriesWaiting(rs)) {
      // before its rebuild swaps in, a rollout's table has only builds listed since, and no unexpected entry
      expect(entries.filter((entry) => !expected.some((want) => sameEntry(want, entry)))).toEqual([])
      continue
    }
    expect(entries).toEqual(expected)
    // the counts are the entries per bucket.
    const want = new Map<string, number>()
    for (const entry of entries) {
      const key = `${entry.facet}:${entry.sr}:${bucketOf(-entry.ns)}`
      want.set(key, (want.get(key) ?? 0) + 1)
    }
    const have = new Map(sql.all<{ facet: number; sr: number; bucket: number; n: number }>(`SELECT * FROM c${rs} WHERE n <> 0`)
      .map((row) => [`${row.facet}:${row.sr}:${row.bucket}`, row.n]))
    expect(have).toEqual(want)
    // ranks, totals and pages under every filter, warm and cold.
    const facets = [...new Set(entries.map((entry) => entry.facet)), 0, 999]
    for (const board of withCold ? [store, new BoardStore(sql, store.resonator)] : [store]) {
      const index = board.rank(rs)
      for (const facet of facets) {
        for (const filter of FILTERS) {
          const rows = entries.filter((entry) => entry.facet === facet && matches(entry.sr, filter))
          expect(index.total(facet, filter)).toBe(rows.length)
          // RANK(): one more than the rows scoring higher.
          for (const row of rows) expect(index.rank(facet, filter, -row.ns)).toBe(1 + rows.filter((other) => other.ns < row.ns).length)
          if (facet !== 0) continue
          const offset = rows.length ? rand.int(rows.length + 1) : 0
          const limit = 1 + rand.int(5)
          const got = page(board, { rs, filter, offset, limit })!
          expect(got.total).toBe(rows.length)
          const slice = rows.slice(offset, offset + limit)
          expect(got.rows.map((row) => [row.local, row.rank])).toEqual(slice.map((row) => [row.build, 1 + rows.filter((other) => other.ns < row.ns).length]))
        }
      }
      const shown = counts(board, FILTERS[0], rs)!
      for (const [team, facet] of info.teams) expect(shown.teams[team]).toBe(entries.filter((entry) => entry.facet === facet).length)
    }
  }
}

describe('board store', () => {
  it('ranks a page as RANK() does', () => {
    const rows = [100, 90, 90, 90, 80].map((q) => ({ q }))
    expect(rankPage(rows, 3, 2).map((row) => row.rank)).toEqual([2, 5, 5, 5, 8])
  })

  it('keeps entries, counts, ranks and pages exact under random work', () => {
    // rollouts whose walk finished and whose entries were then written, over every seed.
    let deferralsEnded = 0
    for (let seed = 1; seed <= 6; seed += 1) {
      const rand = random(seed * 7919)
      const { store, sql } = memoryBoard()
      let now = 1_000
      store.installRuleset(rulesetDef(1), now, { live: true })
      let nextRs = 2
      let rebuilt = 0
      const uids = Array.from({ length: 14 }, (_, index) => 500_000_000 + index * 7)
      const vers = new Map<number, number>()
      const playerOf = (uid: number) => facts(uid, { ver: vers.get(uid) ?? 1 })

      for (let step = 0; step < 260; step += 1) {
        now += 1 + rand.int(5)
        const roll = rand.next()
        const builds = sql.all<BuildRow>(`SELECT * FROM builds`)
        const some = builds.length ? rand.pick(builds) : null
        if (roll < 0.25 || !some) {
          const uid = rand.pick(uids)
          const seq = rand.int(7)
          const salt = rand.int(3)
          store.place({ uid, player: playerOf(uid), card: `c-${uid}-${seq}-${salt}`, snap: snapOf(uid, seq, salt), snapHash: `h${uid}:${seq}:${salt}`,
            seq, drawnAt: now - rand.int(100), owner: rand.next() < 0.5, claimSetup: rand.next() < 0.05, now })
        } else if (roll < 0.62) {
          // score some open cells of an open job, now and then repeating a cell or sending a stale generation.
          for (const info of store.activeRulesets()) {
            const open = sql.all<JobRow>(`SELECT * FROM j${info.rs} WHERE status = 0`)
            if (!open.length) continue
            const job = rand.pick(open)
            const results: CellResult[] = []
            for (const cell of info.cells.values()) {
              if (rand.next() < 0.4) continue
              const ok = rand.next() < 0.85
              results.push({ rs: info.rs, local: job.build, gen: rand.next() < 0.05 ? job.gen - 1 : job.gen, cell: cell.cell,
                status: ok ? 'ok' : rand.pick(['unsupported', 'error'] as const), score: ok ? rand.pick(SCORES) : null,
                damage: ok ? rand.pick([1000, 1000, 2000]) : null, dpr: ok ? 10 : null, flags: 0, reason: ok ? null : 'no_refs',
                weapon: cell.weaponId, stats: null, detail: ok ? '{"c":1}' : null })
            }
            store.recordScores(results, now)
          }
        } else if (roll < 0.68) {
          store.setOwnerHidden(some.id, some.uid, some.owner_hidden_at == null, now)
        } else if (roll < 0.72) {
          store.endBuild(some.id, rand.pick(['deleted', 'hidden'] as const), 'test', now)
        } else if (roll < 0.75) {
          store.restoreBuild(some.id, 'test', now)
        } else if (roll < 0.82) {
          const uid = rand.pick(uids)
          const ver = (vers.get(uid) ?? 1) + 1
          vers.set(uid, ver)
          store.syncPlayer(facts(uid, { ver, hideUid: rand.next() < 0.3, masked: rand.next() < 0.2, unlisted: rand.next() < 0.15,
            region: rand.pick([5, 6, 7, 8, 9, null]) }))
        } else if (roll < 0.87) {
          const info = rand.pick(store.activeRulesets())
          store.restartJob(info.rs, some.id, 'bulk', now)
        } else if (roll < 0.9) {
          const info = rand.pick(store.activeRulesets())
          const job = store.job(info.rs, some.id)
          if (job) store.failJob(info.rs, some.id, job.gen, now)
        } else if (roll < 0.93) {
          // roll out a ruleset, then make it live next time (or cancel one)
          const rolling = store.activeRulesets().find((info) => info.rs !== store.liveRs)
          if (!rolling) {
            store.installRuleset(rulesetDef(nextRs++, rand.next() < 0.5 ? {} : { teams: ['b', 'd'], weapons: [21010012] }), now)
            // builds already stored get their jobs when the rollout slices reach them; here, by placing them again.
            for (const build of sql.all<BuildRow>(`SELECT * FROM builds WHERE state = 0`)) {
              store.place({ uid: build.uid, player: playerOf(build.uid), card: build.card, snap: build.snap, snapHash: build.snap_h, seq: build.seq,
                drawnAt: build.drawn_at, owner: false, now })
            }
          } else if (rand.next() < 0.75) store.goLive(rolling.rs, now)
          else store.cancelRuleset(rolling.rs, now)
        } else if (roll < 0.97) {
          // a rollout's walk goes on; once it is done its entries are written (deferral ended, rebuilt in slices).
          const rolling = store.activeRulesets().find((info) => info.rs !== store.liveRs)
          if (rolling) {
            store.fanOutSlice(rolling.rs, 1 + rand.int(rand.next() < 0.5 ? 30 : 1000), now)
            // usually finish every open job, which lets the walk settle
            if (rand.next() < 0.7) {
              for (const job of sql.all<JobRow>(`SELECT * FROM j${rolling.rs} WHERE status = 0`)) {
                store.recordScores([...rolling.cells.values()].map((cell): CellResult => ({ rs: rolling.rs, local: job.build, gen: job.gen,
                  cell: cell.cell, status: 'ok', score: rand.pick(SCORES), damage: 1000, dpr: 10, flags: 0, reason: null, weapon: cell.weaponId,
                  stats: null, detail: '{"c":1}' })), now)
              }
            }
            if (store.endDeferrals().length) deferralsEnded += 1
          }
        }
        // entries rewritten in key order match the ones list() wrote build by build; the rebuild runs one slice per step
        // (ranges of 3 builds staged, 2 entries sorted, often leaving a facet half copied) with the work above between slices
        if (step % 37 === 20 && !store.rebuilding()) sql.run(`INSERT OR REPLACE INTO meta (k, v) VALUES ('entries_stale', 0)`)
        if (store.entriesStale() && store.rebuildEntries(0, 3, 2)) rebuilt += 1
        checkBoard(store, sql, rand, step % 13 === 0)
      }
      // the work reached every part of the board, rebuilds finished among it.
      expect(rebuilt).toBeGreaterThan(0)
      expect(sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM rulesets WHERE state = 2`)!.n).toBeGreaterThan(0)
      expect(sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM builds WHERE state = 0`)!.n).toBeGreaterThan(0)
    }
    expect(deferralsEnded).toBeGreaterThan(2)
  }, 120_000)
  it('seeds written builds straight onto the board and purges them whole, leaving the real ones as they were', () => {
    const rand = random(4242)
    const { store, sql } = memoryBoard()
    store.installRuleset(rulesetDef(1), 1, { live: true })
    const info = store.ruleset(1)!
    // two real players, scored.
    const real = [500_000_001, 600_000_002].map((uid, index) => {
      const { placement } = store.place({ uid, player: facts(uid), card: `c${uid}`, snap: snapOf(uid, 0, index), snapHash: `h${uid}`, seq: 0,
        drawnAt: 5, owner: true, now: 10 })
      const job = store.job(1, placement.local)!
      store.recordScores([...info.cells.values()].map((cell) => ({ rs: 1, local: placement.local, gen: job.gen, cell: cell.cell, status: 'ok',
        score: 120 + index - cell.cell, damage: 1000, dpr: 5, flags: 0, reason: null, weapon: cell.weaponId, stats: null, detail: '{}' })), 11)
      return placement.local
    })
    const before = sql.all(`SELECT * FROM e1 ORDER BY facet, ns, build`)
    const range: [number, number] = [SEED_LOCAL_FLOOR + 100, SEED_LOCAL_FLOOR + 10_000]
    let local = range[0]
    const seedPlayers = Array.from({ length: 60 }, (_, index) => facts(1_000 + index, { region: 5 + (index % 5), hideUid: index % 7 === 0,
      unlisted: index % 11 === 0 }))
    const chunk = (players: typeof seedPlayers) => {
      const builds: SeedBuild[] = []
      for (const player of players) {
        for (let card = 0; card < 1 + (player.uid % 3 === 0 ? 1 : 0); card += 1) {
          const seq = rand.int(7)
          builds.push({ local: local++, uid: player.uid, seq, card: 'seed', snap: snapOf(player.uid, seq, card), snapHash: `s${player.uid}-${card}`,
            drawnAt: 20, at: 30 + card, stats: card ? null : new Uint8Array([1, 2, 3]),
            scores: [...info.cells.values()].filter(() => rand.next() < 0.9).map((cell) => ({ key: cell.key,
              score: rand.pick([80, 95.5, 95.5, 110, 121, 130]), damage: rand.pick([900, 1000]), dpr: 4 })) })
        }
      }
      return builds
    }
    const first = chunk(seedPlayers.slice(0, 30))
    const placed = store.seed({ range, players: seedPlayers.slice(0, 30), builds: first, now: 40 })
    expect(placed.inserted).toBe(first.length)
    // a chunk sent again changes nothing.
    expect(store.seed({ range, players: seedPlayers.slice(0, 30), builds: first, now: 41 }).inserted).toBe(0)
    store.seed({ range, players: seedPlayers.slice(30), builds: chunk(seedPlayers.slice(30)), now: 42 })
    // written seeds wait for their entries until the batch is done.
    expect(store.entriesStaleSince()).toBe(42)
    expect(sql.all(`SELECT * FROM e1 ORDER BY facet, ns, build`)).toEqual(before)
    store.rebuildEntries()
    expect(store.entriesStale()).toBe(false)
    checkBoard(store, sql, rand, true)
    // each seeded player keeps every build, each ranked as itself, and D1 receives their best
    const players = new Map(placed.players.map((row) => [row.uid, row]))
    for (const player of seedPlayers.slice(0, 30)) {
      const row = players.get(player.uid)!
      expect(row.standing).toBe(first.filter((build) => build.uid === player.uid).length)
      expect(row.listed == null).toBe(player.unlisted)
    }
    expect(sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM builds WHERE state = 0 AND id >= ?`, range[0])!.n).toBe(local - range[0])
    expect(store.stagedDetail(1, first[0].local).size).toBe(0)
    expect(store.pendingDetail().filter((job) => job.local >= range[0])).toEqual([])
    // a page reads them as it reads anyone.
    expect(page(store, { rs: 1, filter: { seq: null, region: null }, offset: 0, limit: 5 })!.total).toBeGreaterThan(50)

    const purged = store.purgeSeeds(range, [1_000, 1_059])
    expect(purged.builds).toBe(local - range[0])
    expect(purged.players).toBe(60)
    expect(purged.detail).toEqual([])
    expect(sql.all(`SELECT * FROM e1 ORDER BY facet, ns, build`)).toEqual(before)
    expect(sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM builds`)!.n).toBe(2)
    expect(real.map((id) => store.build(id)!.state)).toEqual([0, 0])
    checkBoard(store, sql, rand, true)
    // the swapped tables kept their keys and indexes.
    expect(sql.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'builds' ORDER BY name`).map((row) => row.name))
      .toEqual(['builds_card', 'builds_player', 'builds_state'])
    expect(() => store.place({ uid: 500_000_001, player: facts(500_000_001), card: 'x', snap: snapOf(500_000_001, 1, 9), snapHash: 'hx', seq: 1,
      drawnAt: 50, owner: true, now: 50 })).not.toThrow()
  })

  it('carries written seeds over to a rollout as they are, and scores only the real builds', () => {
    const rand = random(919)
    const { store, sql } = memoryBoard()
    store.installRuleset(rulesetDef(1), 1, { live: true })
    const info = store.ruleset(1)!
    const real = [500_000_001, 600_000_002].map((uid, index) => {
      const { placement } = store.place({ uid, player: facts(uid), card: `c${uid}`, snap: snapOf(uid, 0, index), snapHash: `h${uid}`, seq: 0,
        drawnAt: 5, owner: true, now: 10 })
      const job = store.job(1, placement.local)!
      store.recordScores([...info.cells.values()].map((cell) => ({ rs: 1, local: placement.local, gen: job.gen, cell: cell.cell, status: 'ok',
        score: 120 + index - cell.cell, damage: 1000, dpr: 5, flags: 0, reason: null, weapon: cell.weaponId, stats: null, detail: '{}' })), 11)
      return placement.local
    })
    const range: [number, number] = [SEED_LOCAL_FLOOR, SEED_LOCAL_FLOOR + 10_000]
    const players = Array.from({ length: 40 }, (_, index) => facts(1_000 + index, { unlisted: index % 9 === 0 }))
    const seeds: SeedBuild[] = players.flatMap((player, index) => [0, 1].map((card) => ({ local: range[0] + index * 2 + card, uid: player.uid,
      seq: rand.int(7), card: 'seed', snap: snapOf(player.uid, 0, card), snapHash: `s${player.uid}-${card}`, drawnAt: 20, at: 30,
      stats: card ? null : new Uint8Array([1, 2, 3]),
      scores: [...info.cells.values()].filter(() => rand.next() < 0.8).map((cell) => ({ key: cell.key, score: rand.pick([80, 95.5, 110, 130]),
        damage: rand.pick([900, 1000]), dpr: 4 })) })))
    store.seed({ range, players, builds: seeds, now: 40 })
    store.rebuildEntries()

    // ruleset 2 drops one scenario and adds one; a seed keeps the scores of scenarios both score
    const def = rulesetDef(2, { teams: ['a', 'b', 'd'] })
    store.installRuleset(def, 50)
    const orders: JobOrder[] = []
    for (;;) {
      const slice = store.fanOutSlice(2, 300, 51)
      orders.push(...slice.orders)
      if (slice.done) break
    }
    // only the real builds go to the scorer.
    expect(orders.filter((order) => order.rs === 2).map((order) => order.local).sort()).toEqual([...real].sort())
    const next = store.ruleset(2)!
    for (const seed of seeds) {
      const job = store.job(2, seed.local)!
      const kept = store.scores(1, seed.local).filter((row) => [...next.cells.values()].some((cell) => cell.key === info.cells.get(row.cell)!.key))
      expect(store.scores(2, seed.local).map((row) => [next.cells.get(row.cell)!.key, row.q, row.damage]).sort())
        .toEqual(kept.map((row) => [info.cells.get(row.cell)!.key, row.q, row.damage]).sort())
      expect([job.status, job.detail_at, job.done]).toEqual([kept.length ? 1 : 2, 0, kept.length])
    }
    for (const local of real) {
      const job = store.job(2, local)!
      store.recordScores([...next.cells.values()].map((cell) => ({ rs: 2, local, gen: job.gen, cell: cell.cell, status: 'ok' as const,
        score: 100, damage: 10, dpr: 1, flags: 0, reason: null, weapon: cell.weaponId, stats: null, detail: '{}' })), 60)
    }
    expect(store.endDeferrals()).toEqual([2])
    store.rebuildEntries()
    expect(store.rulesetSettled(2)).toBe(true)
    store.goLive(2, 70)
    checkBoard(store, sql, rand, true)
    expect(page(store, { rs: 2, filter: { seq: null, region: null }, offset: 0, limit: 5 })!.total).toBeGreaterThan(60)
  })

  it('seeds builds for the scorer as uploads, and purges a small batch in place', () => {
    const rand = random(77)
    const { store, sql } = memoryBoard()
    store.installRuleset(rulesetDef(1), 1, { live: true })
    for (let index = 0; index < 30; index += 1) {
      const uid = 500_000_000 + index
      store.place({ uid, player: facts(uid), card: `c${uid}`, snap: snapOf(uid, 0, index), snapHash: `h${uid}`, seq: 0, drawnAt: 5, owner: true, now: 10 })
    }
    const range: [number, number] = [SEED_LOCAL_FLOOR, SEED_LOCAL_FLOOR + 9]
    const builds: SeedBuild[] = [0, 1, 2].map((index) => ({ local: range[0] + index, uid: 7, seq: 0, card: 'seed', snap: snapOf(7, 0, index),
      snapHash: `s7-${index}`, drawnAt: 20, at: 30 - index, scores: null, stats: null }))
    const placed = store.seed({ range, players: [facts(7)], builds, now: 40 })
    // no job yet: a fill walk over the batch gives each its job on the bulk lane, past the 30 uploads before it.
    expect(placed.orders).toEqual([])
    expect(store.walks('fill')).toEqual({ 1: range[0] - 1 })
    expect(store.walkSlice('fill', 1, 10, 40).map((order) => [order.local, order.lane])).toEqual(builds.map((build) => [build.local, 'bulk']))
    expect(store.walks('fill')).toEqual({})
    // every card is kept and ranked as itself once scored.
    expect(builds.map((build) => store.build(build.local)!.state)).toEqual([0, 0, 0])
    // a written chunk left stale and purged before the rebuild: the purge writes the entries itself.
    const stale = store.seed({ range, players: [facts(8)], builds: [{ ...builds[0], local: range[0] + 5, uid: 8, snapHash: 's8', scores: [{ key: store.ruleset(1)!.cells.get(0)!.key,
      score: 99, damage: 1, dpr: 1 }] }], now: 41 })
    expect(stale.inserted).toBe(1)
    const purged = store.purgeSeeds(range, [7, 8])
    expect([purged.builds, purged.players]).toEqual([4, 2])
    // a purge leaves a stale board stale (it may wait on more than seeds); the rebuild ends it.
    expect(store.entriesStale()).toBe(true)
    store.rebuildEntries()
    expect(store.entriesStale()).toBe(false)
    expect(sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM j1`)!.n).toBe(30)
    checkBoard(store, sql, rand, true)
  })
})
