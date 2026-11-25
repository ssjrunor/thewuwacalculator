/*
  Author: Runor Ewhro
  description: grouped bulk work on a board: bulk orders are staged by cell and
               program key and cut into group messages (full groups at once, the
               rest after waiting), a reuse message's leftovers return staged,
               builds whose job moved on are dropped, and walks (a rollout's, a
               rescore of every build) admit builds only while the ruleset has
               fewer than OPEN_BULK_JOBS open jobs.
*/

import { describe, expect, it } from 'vitest'
import { BoardStore, GROUP_BUDGET_MS, GROUP_MAX, GROUP_WAIT_MS, JOB, OPEN_BULK_JOBS } from '../../src/board/store.ts'
import type { CellResult, JobOrder } from '../../src/board/types.ts'
import { facts, memoryBoard, rulesetDef, snapOf } from './support.ts'

function board() {
  const made = memoryBoard()
  made.store.installRuleset(rulesetDef(1), 1, { live: true })
  return made
}

/** a build of `uid`; builds with equal `salt` and `seq` have the same echoes and share a program key. */
function place(store: BoardStore, uid: number, salt: number, now: number, seq = 0) {
  const placed = store.place({ uid, player: facts(uid), card: `c${uid}-${salt}`, snap: snapOf(uid, seq, salt), snapHash: `h${uid}-${salt}`, seq,
    drawnAt: now, owner: true, now })
  store.markSent(placed.jobs, now)
  return placed.placement.local
}

/** every cell of a build's job on a ruleset scored. */
function finish(store: BoardStore, rs: number, local: number, now: number) {
  const job = store.job(rs, local)!
  const results: CellResult[] = [...store.ruleset(rs)!.cells.values()].map((cell) => ({ rs, local, gen: job.gen, cell: cell.cell, status: 'ok',
    score: 50, damage: 10, dpr: 1, flags: 0, reason: null, weapon: cell.weaponId, stats: null, detail: '{}' }))
  store.recordScores(results, now)
}

/** a rollout to ruleset 2, its whole walk admitted. */
function rollOut(store: BoardStore, now: number): JobOrder[] {
  store.installRuleset(rulesetDef(2), now)
  const orders: JobOrder[] = []
  for (;;) {
    const slice = store.fanOutSlice(2, 300, now)
    orders.push(...slice.orders)
    if (slice.done) return orders
  }
}

const staged = (store: BoardStore, rs: number) => store.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM n${rs}`)!.n

describe('grouped bulk work', () => {
  it('sends builds that share a program key together, one group per cell, and marks their jobs sent', () => {
    const { store } = board()
    const alike = [1, 2, 3].map((index) => place(store, 500_000_000 + index, 7, 10))
    const other = place(store, 600_000_000, 8, 10)
    const orders = rollOut(store, 20)
    store.stage(orders, 21)
    expect(staged(store, 2)).toBe(4 * 6)
    for (const local of [...alike, other]) expect(store.job(2, local)!.sent_at).toBe(21)
    expect(store.unsentOrders()).toEqual([])

    // not yet waited long enough, and no group is full: nothing goes.
    expect(store.cutGroups(22)).toEqual([])
    expect(store.stagedSince()).toBe(21)
    const groups = store.cutGroups(21 + GROUP_WAIT_MS)
    expect(groups).toHaveLength(6 * 2)
    for (const cell of store.ruleset(2)!.cells.values()) {
      const forCell = groups.filter((group) => group.cell === cell.cell)
      expect(forCell.map((group) => group.builds.map((build) => build.local).sort())).toEqual(expect.arrayContaining([[...alike].sort(), [other]]))
      expect(forCell.every((group) => group.key === cell.key && group.rulesetId === 'rs-2')).toBe(true)
    }
    // the rolling ruleset is not live, so no cell measures card stats, and the staged rows are removed
    expect(groups.flatMap((group) => group.builds).some((build) => build.cs)).toBe(false)
    expect(staged(store, 2)).toBe(0)
    expect(store.stagedSince()).toBeNull()
  })

  it('sizes a cell\'s groups to its measured cost per build, and keeps a cell it has not timed small', () => {
    const { store } = board()
    const local = place(store, 500_000_001, 7, 10)
    const job = store.job(1, local)!
    const timed = (cell: number, lane: 'bulk' | 'interactive', ms: number): CellResult => ({ rs: 1, local, gen: job.gen, cell, status: 'ok', score: 50,
      damage: 10, dpr: 1, flags: 0, reason: null, weapon: 21010011, stats: null, detail: '{}',
      timing: { lane, runner: 'worker', ms, wallMs: ms, stages: null, anchorSource: null } })
    // cell 0 costs 100 ms per build in groups; cell 1 has only an interactive timing (a cell scored alone)
    store.recordScores([timed(0, 'bulk', 100), timed(1, 'interactive', 50)], 20)
    const key = (cell: number) => store.ruleset(1)!.cells.get(cell)!.key
    expect(store.groupSize(key(0), 21)).toBe(Math.min(GROUP_MAX, GROUP_BUDGET_MS / 100))
    expect(store.groupSize(key(1), 21)).toBe(GROUP_BUDGET_MS / 1_500)
  })

  it('sends a full group at once and the live ruleset\'s first cell measures the card', () => {
    const { store } = board()
    // without timings a group is sized by GROUP_BUDGET_MS at the untimed cost
    const size = store.groupSize(store.ruleset(1)!.cells.get(0)!.key)
    expect(size).toBe(40)
    const locals = Array.from({ length: size + 3 }, (_, index) => place(store, 500_000_000 + index, 7, 10))
    const orders = locals.map((local) => store.restartJob(1, local, 'bulk', 20)!)
    store.stage(orders, 20)
    const full = store.cutGroups(20)
    expect(full.map((group) => group.builds.length)).toEqual(Array(6).fill(size))
    // the 3 left over wait for more, then go.
    expect(staged(store, 1)).toBe(3 * 6)
    const rest = store.cutGroups(20, GROUP_WAIT_MS, true)
    expect(rest.map((group) => group.builds.length)).toEqual(Array(6).fill(3))
    const cs = [...full, ...rest].flatMap((group) => group.builds.filter((build) => build.cs).map((build) => [group.cell, build.local]))
    expect(cs).toHaveLength(locals.length)
    expect(cs.every(([cell]) => cell === 0)).toBe(true)
  })

  it('drops a build whose job finished or started over, and stages a restarted one again', () => {
    const { store } = board()
    const a = place(store, 500_000_001, 7, 10)
    const b = place(store, 500_000_002, 7, 10)
    const c = place(store, 500_000_003, 7, 10)
    store.stage([a, b, c].map((local) => store.restartJob(1, local, 'bulk', 20)!), 20)
    finish(store, 1, a, 21)
    // b starts over: its old rows go with its scores, and its new job is staged afresh.
    const again = store.restartJob(1, b, 'bulk', 22)!
    store.stage([again], 22)
    const groups = store.cutGroups(23, 0)
    const cell0 = groups.find((group) => group.cell === 0)!
    expect(cell0.builds.map((build) => [build.local, build.gen])).toEqual([[b, again.gen], [c, store.job(1, c)!.gen]])
    expect(store.job(1, a)!.status).toBe(JOB.scored)
  })

  it('stages a reuse message\'s leftover cells with its results, only for the job that asked', () => {
    const { store } = board()
    const local = place(store, 500_000_001, 7, 10)
    rollOut(store, 20)
    const job = store.job(2, local)!
    const kept: CellResult[] = [2, 3, 4, 5].map((cell) => ({ rs: 2, local, gen: job.gen, cell, status: 'ok', score: 50, damage: 10, dpr: 1,
      flags: 0, reason: null, weapon: store.ruleset(2)!.cells.get(cell)!.weaponId, stats: null, detail: '{}' }))
    store.recordScores(kept, 21, [{ rs: 2, local, gen: job.gen, cells: [0, 1] }, { rs: 2, local, gen: job.gen - 1, cells: [0] },
      { rs: 2, local, gen: job.gen, cells: [99] }])
    expect(store.sql.all(`SELECT cell, build FROM n2 ORDER BY cell`)).toEqual([{ cell: 0, build: local }, { cell: 1, build: local }])
    expect(store.cutGroups(21, 0).map((group) => [group.cell, group.builds.map((build) => build.gen)])).toEqual([[0, [job.gen]], [1, [job.gen]]])
  })

  it('admits a rollout\'s builds only while the ruleset has room for more open jobs', () => {
    const { store } = board()
    const locals = Array.from({ length: OPEN_BULK_JOBS + 5 }, (_, index) => place(store, 500_000_000 + index, index % 9, 10))
    store.installRuleset(rulesetDef(2), 20)
    let admitted = 0
    for (let slice = store.fanOutSlice(2, 300, 21); slice.orders.length; slice = store.fanOutSlice(2, 300, 21)) admitted += slice.orders.length
    expect(admitted).toBe(OPEN_BULK_JOBS)
    expect(store.fanOutSlice(2, 300, 21)).toEqual({ orders: [], done: false })
    expect(store.hasRolloutWork()).toBe(false)
    // two jobs finish: two more builds come in, and then the walk is over.
    finish(store, 2, locals[0], 22)
    finish(store, 2, locals[1], 22)
    expect(store.hasRolloutWork()).toBe(true)
    expect(store.fanOutSlice(2, 300, 23).orders).toHaveLength(2)
    // with more room than builds left, the walk takes the last three and is done.
    for (const local of locals.slice(2, 7)) finish(store, 2, local, 24)
    const last = store.fanOutSlice(2, 300, 25)
    expect([last.orders.length, last.done]).toEqual([3, true])
    expect(store.rulesetSettled(2)).toBe(false)
  })

  it('rescores every build as a paced walk that ends past the last one', () => {
    const { store } = board()
    const locals = Array.from({ length: 5 }, (_, index) => place(store, 500_000_000 + index, 7, 10))
    for (const local of locals) finish(store, 1, local, 11)
    expect(store.startRescoreWalk(1)).toBe(5)
    expect(store.hasRolloutWork()).toBe(true)
    expect(store.rescoreSlice(1, 3, 20).map((order) => [order.local, order.lane])).toEqual(locals.slice(0, 3).map((local) => [local, 'bulk']))
    expect(store.rescoreSlice(1, 3, 21).map((order) => order.local)).toEqual(locals.slice(3))
    expect(store.rescoreWalks()).toEqual({})
    expect(store.rescoreSlice(1, 3, 22)).toEqual([])
    expect(store.jobCounts(1)).toMatchObject({ scoring: 5, scored: 0 })
  })

  it('prunes timings older than the 14 days the costs read', () => {
    const { store } = board()
    const day = 86_400_000
    const local = place(store, 500_000_001, 7, 10)
    const job = store.job(1, local)!
    const timed = (cell: number): CellResult => ({ rs: 1, local, gen: job.gen, cell, status: 'ok', score: 50, damage: 10, dpr: 1, flags: 0,
      reason: null, weapon: 21010011, stats: null, detail: '{}', timing: { lane: 'bulk', runner: 'worker', ms: 5, wallMs: 5, stages: null,
        anchorSource: null } })
    store.recordScores([timed(0)], 1 * day)
    store.recordScores([timed(1)], 10 * day)
    store.recordScores([timed(2)], 20 * day)
    expect(store.pruneTimings(21 * day)).toBe(1)
    expect(store.sql.all(`SELECT cell FROM timings ORDER BY at`)).toEqual([{ cell: 1 }, { cell: 2 }])
    expect(store.pruneTimings(21 * day)).toBe(0)
  })
})
