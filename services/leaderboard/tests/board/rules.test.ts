/*
  Author: Runor Ewhro
  description: board rules one at a time: every build ranked as itself with the
               player's best sent to D1, the effects of hiding, deleting and
               ending a ruleset, results counting once per job, the notices a
               finish sends, detail staging, server filters and the score field,
               a rollout fan-out's reuse offers, and bulk send order.
*/

import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { BoardStore } from '../../src/board/store.ts'
import { nodeSql } from '../../src/board/sql.ts'
import { SCHEMA_VERSION } from '../../src/board/schema.ts'
import { writeScore } from '../../src/board/scorePack.ts'
import { cellRanks, field, page, standing } from '../../src/board/reads.ts'
import type { CellResult, OutboxOp } from '../../src/board/types.ts'
import { facts, memoryBoard, rulesetDef, snapOf } from './support.ts'

const A = 500_000_001
const B = 600_000_002
const C = 700_000_003

function board() {
  const made = memoryBoard()
  made.store.installRuleset(rulesetDef(1), 1, { live: true })
  return made
}

function place(store: BoardStore, uid: number, salt: number, now: number, patch: { seq?: number } = {}) {
  const seq = patch.seq ?? 0
  return store.place({ uid, player: facts(uid), card: `c${uid}-${salt}`, snap: snapOf(uid, seq, salt), snapHash: `h${uid}-${salt}`, seq,
    drawnAt: now, owner: true, now })
}

/** scores every cell of a build's job on a ruleset: `score` on cell 0, lower on the rest. */
function score(store: BoardStore, local: number, value: number, now: number, rs = 1) {
  const job = store.job(rs, local)!
  const results: CellResult[] = [...store.ruleset(rs)!.cells.values()].map((cell) => ({
    rs, local, gen: job.gen, cell: cell.cell, status: 'ok', score: cell.cell === 0 ? value : value - 10 - cell.cell,
    damage: 1000, dpr: 5, flags: 0, reason: null, weapon: cell.weaponId, stats: null, detail: `{"cell":${cell.cell}}` }))
  return store.recordScores(results, now)
}

const ops = (store: BoardStore) => store.outbox(10_000).map((row) => row.op)
const notices = (store: BoardStore) => ops(store).filter((op): op is Extract<OutboxOp, { op: 'notify' }> => op.op === 'notify')

describe('board rules', () => {
  it('ranks every build of a player as itself, and tells D1 their best', () => {
    const { store } = board()
    const first = place(store, A, 1, 10).placement
    expect(first).toMatchObject({ active: true, repeated: false })
    const second = place(store, A, 2, 11).placement
    expect(second).toMatchObject({ active: true, repeated: false })
    score(store, second.local, 120, 12)
    score(store, first.local, 100, 13)
    expect([first.local, second.local].map((local) => store.build(local)!.state)).toEqual([0, 0])
    expect(page(store, { offset: 0, limit: 10 })!.rows.map((row) => row.local)).toEqual([second.local, first.local])
    expect(standing(store, second.local)).toMatchObject({ rank: 1, total: 2, score: 120 })
    expect(standing(store, first.local)).toMatchObject({ rank: 2, total: 2, score: 100 })
    // D1's standing: both kept, the best one active and listed.
    expect(ops(store).filter((op) => op.op === 'player_board').at(-1)).toMatchObject({ uid: A, standing: 2, active: store.gbid(second.local),
      listed: store.gbid(second.local) })
    // the same card again is the build already stored.
    expect(place(store, A, 2, 14).placement).toMatchObject({ local: second.local, active: true, repeated: true })
  })

  it('takes a hidden or deleted build off the board and leaves the player\'s others where they were', () => {
    const { store } = board()
    const one = place(store, A, 1, 10).placement.local
    const two = place(store, A, 2, 11).placement.local
    score(store, one, 130, 12)
    score(store, two, 110, 13)
    store.setOwnerHidden(one, A, true, 14)
    expect(page(store, { offset: 0, limit: 10 })!.rows.map((row) => row.local)).toEqual([two])
    // D1's best listed build moves to the one still shown; the best kept stays the hidden one.
    expect(ops(store).filter((op) => op.op === 'player_board').at(-1)).toMatchObject({ active: store.gbid(one), listed: store.gbid(two) })
    store.setOwnerHidden(one, A, false, 15)
    expect(page(store, { offset: 0, limit: 10 })!.rows.map((row) => row.local)).toEqual([one, two])
    store.endBuild(one, 'deleted', 'uid', 16)
    expect(store.build(one)!.state).toBe(2)
    expect(store.build(two)!.state).toBe(0)
    expect(store.job(1, one)).toBeNull()
    expect(page(store, { offset: 0, limit: 10 })!.rows.map((row) => row.local)).toEqual([two])
    expect(ops(store)).toContainEqual({ op: 'build_gone', gbid: store.gbid(one) })
  })

  it('drops a ruleset\'s tables when another goes live', () => {
    const { store } = board()
    const builds = [[A, 100], [B, 100], [C, 90]].map(([uid, value], index) => {
      const local = place(store, uid, 1, 10 + index).placement.local
      score(store, local, value, 20 + index)
      return local
    })
    store.installRuleset(rulesetDef(2), 30)
    store.goLive(2, 31)
    expect(builds.map((local) => store.build(local)!.state)).toEqual([0, 0, 0])
    expect(store.ruleset(1)).toBeUndefined()
    expect(store.sql.first(`SELECT name FROM sqlite_master WHERE name = 'e1'`)).toBeNull()
  })

  it('sends D1 nothing for a rollout that leaves every standing as it was, and keeps no event of its jobs', () => {
    const { store } = board()
    const a = place(store, A, 1, 10).placement.local
    const b = place(store, B, 1, 11).placement.local
    score(store, a, 100, 12)
    score(store, b, 90, 13)
    store.outboxApplied(store.outbox(10_000).at(-1)!.seq)
    const events = store.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM events`)!.n
    store.installRuleset(rulesetDef(2), 20)
    while (store.fanOutSlice(2, 100, 21).orders.length) { /* every build's job on 2 */ }
    score(store, a, 100, 22, 2)
    score(store, b, 90, 23, 2)
    // scoring on a rolling ruleset: no standing, upload or summary moves, and no event row.
    expect(ops(store)).toEqual([])
    expect(store.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM events`)!.n).toBe(events)
    // its entries wait for the walk: written once (the alarm's steps), and only then is the ruleset settled.
    expect([store.ruleset(2) && store.rulesetSettled(2), store.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM e2`)!.n]).toEqual([false, 0])
    expect(store.endDeferrals()).toEqual([2])
    expect(store.rebuildEntries()).toBe(true)
    expect(store.rulesetSettled(2)).toBe(true)
    expect(store.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM e2`)!.n).toBe(store.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM e1`)!.n)
    // going live rechecks every player's best build; each is unchanged, so D1 receives only the board's new ruleset
    store.goLive(2, 30)
    expect(ops(store).map((op) => op.op)).toEqual(['board'])
    // the owner hides their build, which changes its upload and standing and is sent
    store.outboxApplied(store.outbox(10_000).at(-1)!.seq)
    store.setOwnerHidden(b, B, true, 31)
    expect(ops(store).map((op) => op.op).sort()).toEqual(['board', 'player_board', 'upload'])
  })

  it('offers no old score on a scenario its sample check found scoring differently', () => {
    const { store } = board()
    const local = place(store, A, 1, 10).placement.local
    score(store, local, 100, 11)
    const def = { ...rulesetDef(2), reuseFrom: 1 }
    def.cells = def.cells.map((cell) => ({ ...cell, reuse: cell.teamKey !== 'b' }))
    store.installRuleset(def, 20)
    const [order] = store.fanOutSlice(2, 10, 21).orders
    expect(order.reuse!.old.map((cell) => cell.key.split(':')[1])).toEqual(['a', 'a', 'c', 'c'])
    expect(order.cells).toHaveLength(6)
    // the flag outlives the store: a board woken again reads it from its cells.
    expect(new BoardStore(store.sql, 1506).ruleset(2)!.cells.get(2)!.reuse).toBe(false)
  })

  it('lets a job a rollout kept whole read the earlier object, follows it down a chain, and frees it once no job reads it', () => {
    const { store } = board()
    const local = place(store, A, 1, 10).placement.local
    score(store, local, 100, 11)
    for (const pending of store.pendingDetail()) store.detailWritten(pending.rs, pending.local, pending.gen, 12)
    // every cell kept: the job has no detail and names the object it reads
    const keepAll = (rs: number, now: number, from: string) => {
      const job = store.job(rs, local)!
      return store.recordScores(store.scores(rs - 1, local).map((row) => ({ rs, local, gen: job.gen, cell: row.cell, status: 'ok' as const,
        score: row.q! / 10_000, damage: row.damage, dpr: row.dpr, flags: 0, reason: null, weapon: 21010011, stats: null, detail: null,
        detailFrom: from })), now)
    }
    store.installRuleset({ ...rulesetDef(2), reuseFrom: 1 }, 20)
    const [order] = store.fanOutSlice(2, 10, 21).orders
    expect(order.reuse).toMatchObject({ fromId: 'rs-1', detailId: 'rs-1' })
    expect(keepAll(2, 22, 'rs-1').finished).toHaveLength(1)
    expect(store.job(2, local)).toMatchObject({ detail_from: 1, detail_at: 22 })
    expect(store.pendingDetail()).toEqual([])
    store.goLive(2, 23)
    expect(store.detailIdOf(2, local)).toBe('rs-1')
    // ruleset 1 ended: its objects are queued to go, but this build's stays while a job reads it.
    expect(store.detailPurges()).toEqual(['rs-1'])
    expect([...store.detailReaders('rs-1', [local, local + 1])]).toEqual([local])
    store.detailPurged('rs-1')
    // the next rollout reuses from 2, and its offer reads 1's object.
    store.installRuleset({ ...rulesetDef(3), reuseFrom: 2 }, 30)
    expect(store.fanOutSlice(3, 10, 31).orders[0].reuse).toMatchObject({ fromId: 'rs-2', detailId: 'rs-1' })
    // scored again with its own object; once 2 ends, 1's objects have no readers and 1's purge runs again
    score(store, local, 101, 32, 3)
    expect(store.job(3, local)).toMatchObject({ detail_from: null, detail_at: null })
    store.goLive(3, 33)
    expect(store.detailPurges().sort()).toEqual(['rs-1', 'rs-2'])
    expect([...store.detailReaders('rs-1', [local])]).toEqual([])
  })

  it('counts a result once per job: a repeat is kept, a failure takes a later ok, an old job\'s result is stale', () => {
    const { store } = board()
    const local = place(store, A, 1, 10).placement.local
    const gen = store.job(1, local)!.gen
    const cell = (status: 'ok' | 'error', value: number | null, g = gen): CellResult => ({ rs: 1, local, gen: g, cell: 0, status, score: value,
      damage: value == null ? null : 1, dpr: null, flags: 0, reason: status === 'error' ? 'boom' : null, weapon: 21010011, stats: null, detail: null })
    expect(store.recordScores([cell('error', null)], 11).acks).toEqual(['counted'])
    expect(store.recordScores([cell('error', null)], 12).acks).toEqual(['kept'])
    expect(store.recordScores([cell('ok', 90)], 13).acks).toEqual(['upgraded'])
    expect(store.recordScores([cell('ok', 95)], 14).acks).toEqual(['kept'])
    expect(store.job(1, local)!.done).toBe(1)
    expect(store.reasonText(store.scores(1, local)[0].reason)).toBeNull()
    const order = store.restartJob(1, local, 'bulk', 15)!
    expect(order.gen).not.toBe(gen)
    expect(order.cells).toHaveLength(6)
    expect(store.recordScores([cell('ok', 99)], 16).acks).toEqual(['stale'])
    expect(store.recordScores([{ ...cell('ok', 99), rs: 7 }], 16).acks).toEqual(['stale'])
  })

  it('tells the player whose #1 was taken, and a build its first score', () => {
    const { store } = board()
    const a = place(store, A, 1, 10).placement.local
    score(store, a, 100, 11)
    expect(notices(store)).toEqual([expect.objectContaining({ kind: 'scored', uid: A, data: expect.objectContaining({ rank: 1, total: 1, score: 100 }) })])
    store.outboxApplied(store.outbox(1)[0] ? Number.MAX_SAFE_INTEGER : 0)
    const b = place(store, B, 1, 12).placement.local
    score(store, b, 101, 13)
    expect(notices(store).map((op) => [op.kind, op.uid])).toEqual([['dethroned', A], ['scored', B]])
    // a tie for #1 dethrones nobody.
    store.outboxApplied(Number.MAX_SAFE_INTEGER)
    const c = place(store, C, 1, 14).placement.local
    score(store, c, 101, 15)
    expect(notices(store).map((op) => op.kind)).toEqual(['scored'])
    expect(cellRanks(store, 1, c).get(0)).toEqual({ rank: 1, total: 3 })
  })

  it('reports each touched player\'s standing and the board top in its outbox', () => {
    const { store } = board()
    const a = place(store, A, 1, 10).placement.local
    expect(ops(store)).toContainEqual({ op: 'player_board', uid: A, standing: 1, active: store.gbid(a), listed: null, listedAt: null, seq: 0 })
    score(store, a, 100, 11)
    const last = ops(store).filter((op) => op.op === 'board').at(-1)
    expect(last).toMatchObject({ op: 'board', rulesetId: 'rs-1', total: 1, top: [store.gbid(a)], topQ: 1_000_000,
      head: { rank: 1, local: a, uid: A, score: 100 } })
    expect(ops(store)).toContainEqual({ op: 'player_board', uid: A, standing: 1, active: store.gbid(a), listed: store.gbid(a), listedAt: 10, seq: 0 })
    // ops leave in order and are dropped once applied.
    const seqs = store.outbox(10_000).map((row) => row.seq)
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y))
    store.outboxApplied(seqs.at(-1)!)
    expect(store.outbox()).toEqual([])
    // the first row is part of the summary: a rename of the player holding it sends the summary again.
    store.syncPlayer(facts(A, { name: 'Renamed', ver: 2 }))
    expect(ops(store).filter((op) => op.op === 'board')).toMatchObject([{ head: { local: a, name: 'Renamed' } }])
    // with nothing changed, upkeep's check sends nothing.
    store.outboxApplied(store.outbox(10_000).at(-1)!.seq)
    store.resummarize()
    expect(ops(store)).toEqual([])
  })

  it('never numbers an op with a seq it used before, once the outbox has drained', () => {
    // d1 treats a batch whose first seq it has seen as a replay (projections.ts board_sync), so a reused seq loses ops
    const { store } = board()
    place(store, A, 1, 10)
    const first = store.outbox(10_000).map((row) => row.seq)
    store.outboxApplied(first.at(-1)!)
    place(store, B, 2, 11)
    const next = store.outbox(10_000).map((row) => row.seq)
    expect(next.length).toBeGreaterThan(0)
    expect(Math.min(...next)).toBeGreaterThan(Math.max(...first))
  })

  it('stages a finished job\'s detail until its object is written', () => {
    const { store } = board()
    const local = place(store, A, 1, 10).placement.local
    const { finished } = score(store, local, 100, 11)
    expect(finished).toEqual([{ rs: 1, local, gen: store.job(1, local)!.gen }])
    expect(store.pendingDetail()).toEqual(finished)
    expect(store.stagedDetail(1, local).get(3)).toBe('{"cell":3}')
    store.detailWritten(1, local, finished[0].gen, 12)
    expect(store.pendingDetail()).toEqual([])
    expect(store.stagedDetail(1, local).size).toBe(0)
  })

  it('leaves a hidden uid out of server filters but keeps an anonymous player\'s server', () => {
    const { store } = board()
    const a = place(store, A, 1, 10).placement.local
    const b = place(store, B, 1, 11).placement.local
    score(store, a, 100, 12)
    score(store, b, 90, 13)
    const region = (uid: number) => 1 + (uid % 5)
    const byServer = (uid: number) => page(store, { filter: { seq: null, region: region(uid) }, offset: 0, limit: 5 })!.rows.map((row) => row.local)
    expect(byServer(A)).toEqual([a])
    store.syncPlayer(facts(A, { hideUid: true, ver: 2 }))
    expect(byServer(A)).toEqual([])
    store.syncPlayer(facts(A, { hideUid: true, masked: true, ver: 3 }))
    expect(byServer(A)).toEqual([a])
    // an older word on the player changes nothing.
    store.syncPlayer(facts(A, { unlisted: true, ver: 2 }))
    expect(byServer(A)).toEqual([a])
    store.syncPlayer(facts(A, { unlisted: true, ver: 4 }))
    expect(page(store, { offset: 0, limit: 5 })!.rows.map((row) => row.local)).toEqual([b])
  })

  it('draws the score field exactly on a small board and to a bucket\'s width on a big one', () => {
    const { store } = board()
    for (let index = 0; index < 700; index += 1) {
      const uid = 100_000_000 + index
      const local = place(store, uid, 1, 10).placement.local
      score(store, local, 50 + (index % 97) * 1.3, 11)
    }
    const values = page(store, { offset: 0, limit: 700 })!.rows.map((row) => row.score)
    const drawn = field(store, 1)
    expect(drawn).toHaveLength(480)
    drawn.forEach((value, point) => {
      const exact = values[Math.round(point * (values.length - 1) / 479)]
      expect(Math.abs(value - exact)).toBeLessThanOrEqual(0.1024)
    })
    const small = memoryBoard().store
    small.installRuleset(rulesetDef(1), 1, { live: true })
    const local = place(small, A, 1, 10).placement.local
    score(small, local, 77.25, 11)
    expect(field(small, 1)).toEqual([77.25])
  })

  it('offers a rollout\'s fan-out the old scores of the scenarios both rulesets score, and only while its job is fresh', () => {
    const { store } = board()
    const local = place(store, A, 1, 10).placement.local
    score(store, local, 100, 11)
    // an error row is scored again, not offered.
    const errored = writeScore(store.scoreBlob(1, local)!, { ...store.scoreOf(1, local, 5)!, status: 2, q: null })
    store.sql.run(`UPDATE s1 SET cells = ? WHERE build = ?`, errored, local)
    // the next ruleset drops team c and adds team d.
    store.installRuleset({ ...rulesetDef(2, { teams: ['a', 'b', 'd'] }), reuseFrom: 1 }, 20)
    const [order] = store.fanOutSlice(2, 10, 21).orders
    expect(order.reuse!.from).toBe(1)
    expect(order.reuse!.fromId).toBe('rs-1')
    expect(order.reuse!.old.map((cell) => [cell.key.split(':')[1], cell.score])).toEqual([['a', 100], ['a', 89], ['b', 88], ['b', 87]])
    expect(order.cells).toHaveLength(6)
    // once anything of the job is in, an order is plain cells.
    store.recordScores([{ rs: 2, local, gen: order.gen, cell: 0, status: 'ok', score: 100, damage: 1000, dpr: 5, flags: 0, reason: null,
      weapon: 21010011, stats: null, detail: null }], 22)
    store.sql.run(`UPDATE j2 SET sent_at = NULL WHERE build = ?`, local)
    expect(store.unsentOrders().map((entry) => entry.reuse)).toEqual([undefined])
    // a ruleset installed without reuse offers nothing.
    const plain = memoryBoard().store
    plain.installRuleset(rulesetDef(1), 1, { live: true })
    const other = place(plain, B, 1, 10).placement.local
    score(plain, other, 90, 11)
    plain.installRuleset(rulesetDef(2), 20)
    expect(plain.fanOutSlice(2, 10, 21).orders[0].reuse).toBeUndefined()
  })

  it('sends bulk work slowest scenario first, by what each key cost on any ruleset, and a new upload in team order', () => {
    const { store } = board()
    const ms = [5, 900, 40, 0, 300, 10]
    ms.forEach((value, cell) => store.sql.run(`INSERT INTO timings (at, rs, cell, lane, runner, status, ms) VALUES (?, 1, ?, 'bulk', 'node', 0, ?)`,
      Date.now(), cell, value))
    const upload = place(store, A, 1, 10)
    expect(upload.jobs[0].cells.map((cell) => cell.cell)).toEqual([0, 1, 2, 3, 4, 5])
    const order = store.restartJob(1, upload.placement.local, 'bulk', 11)!
    expect(order.cells.map((cell) => cell.cell)).toEqual([1, 4, 2, 5, 0, 3])
  })

  it('queues an ended ruleset\'s detail objects for deletion until they are gone', () => {
    const { store } = board()
    store.installRuleset(rulesetDef(2), 20)
    store.cancelRuleset(2, 21)
    expect(store.detailPurges()).toEqual(['rs-2'])
    store.goLive(store.installRuleset(rulesetDef(3), 22).rs, 23)
    expect(store.detailPurges()).toEqual(['rs-2', 'rs-1'])
    store.detailPurged('rs-2')
    expect(store.detailPurges()).toEqual(['rs-1'])
  })

  it('refuses a board older than the oldest migratable schema', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE meta (k TEXT PRIMARY KEY, v) WITHOUT ROWID; INSERT INTO meta VALUES ('schema', 6), ('resonator', 1506)`)
    expect(() => new BoardStore(nodeSql(db), 1506)).toThrow(/schema 6/)
  })

  it('leaves a board at the current schema as it is', () => {
    const { sql } = board()
    expect(new BoardStore(sql, 1506).meta('schema')).toBe(SCHEMA_VERSION)
  })

  it('refuses storage that belongs to another resonator', () => {
    const { sql } = board()
    expect(() => new BoardStore(sql, 1102)).toThrow(/resonator 1506/)
  })
})
