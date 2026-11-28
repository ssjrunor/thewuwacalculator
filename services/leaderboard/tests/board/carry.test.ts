/*
  Author: Runor Ewhro
  description: a board a rollout carries over takes the new ruleset by renaming the live ruleset's tables: every
               score, entry, rank and job is unchanged under the new number, the jobs read the old ruleset's detail
               objects, the indexes are created again under the new number and nothing is purged. cells that differ do
               not carry, and a pending entries rebuild delays the carry.
*/

import { describe, expect, it } from 'vitest'
import type { BoardStore } from '../../src/board/store.ts'
import { page } from '../../src/board/reads.ts'
import type { CellResult } from '../../src/board/types.ts'
import { facts, memoryBoard, rulesetDef, snapOf } from './support.ts'

const A = 500_000_001
const B = 600_000_002

function place(store: BoardStore, uid: number, salt: number, now: number) {
  return store.place({ uid, player: facts(uid), card: `c${uid}-${salt}`, snap: snapOf(uid, 0, salt), snapHash: `h${uid}-${salt}`, seq: 0,
    drawnAt: now, owner: true, now }).placement
}

function score(store: BoardStore, local: number, value: number, now: number, rs = 1) {
  const job = store.job(rs, local)!
  const results: CellResult[] = [...store.ruleset(rs)!.cells.values()].map((cell) => ({
    rs, local, gen: job.gen, cell: cell.cell, status: 'ok', score: cell.cell === 0 ? value : value - 10 - cell.cell,
    damage: 1000, dpr: 5, flags: 0, reason: null, weapon: cell.weaponId, stats: null, detail: `{"cell":${cell.cell}}` }))
  store.recordScores(results, now)
  store.detailWritten(rs, local, job.gen, now)
}

function scoredBoard() {
  const made = memoryBoard()
  made.store.installRuleset(rulesetDef(1), 1, { live: true })
  const a = place(made.store, A, 1, 10).local
  const b = place(made.store, B, 2, 11).local
  score(made.store, a, 120, 12)
  score(made.store, b, 100, 13)
  return { ...made, a, b }
}

const indexes = (store: BoardStore) => store.sql.all<{ name: string }>(
  `SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND name GLOB '[a-z][0-9]*' ORDER BY name`).map((row) => row.name)

describe('carried rulesets', () => {
  it('renames the live tables to the new ruleset with every score, rank and job unchanged', () => {
    const { store, a, b } = scoredBoard()
    const before = page(store, { offset: 0, limit: 10 })!.rows.map((row) => [row.local, row.score])
    const scores = store.scoreBlob(1, a)
    const outbox = store.outbox(10_000).length
    expect(store.carries(rulesetDef(2).cells)).toBe(true)

    store.carryLive({ ...rulesetDef(2), reuseFrom: null }, 20)
    expect(store.liveRs).toBe(2)
    expect(store.ruleset(1)).toBeUndefined()
    expect(store.ruleset(2)!.id).toBe('rs-2')
    expect(page(store, { offset: 0, limit: 10 })!.rows.map((row) => [row.local, row.score])).toEqual(before)
    expect(store.scoreBlob(2, a)).toEqual(scores)
    expect(store.job(2, b)).toMatchObject({ status: 1, detail_from: 1 })
    // the jobs read the old ruleset's objects, so it is not purged
    expect(store.detailIdOf(2, a)).toBe('rs-1')
    expect(store.detailPurges()).toEqual([])
    expect(store.sql.all(`SELECT rs, state FROM rulesets ORDER BY rs`)).toEqual([{ rs: 1, state: 2 }, { rs: 2, state: 1 }])
    expect(store.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM cells WHERE rs = 1`)!.n).toBe(0)
    expect(indexes(store).every((name) => /^[a-z]2_/.test(name))).toBe(true)
    expect(indexes(store)).toContain('j2_status')
    // the boards index receives the new ruleset; standings are unchanged and not sent again
    const sent = store.outbox(10_000).slice(outbox).map((row) => row.op)
    expect(sent.map((op) => op.op)).toEqual(['board'])
    expect(sent[0]).toMatchObject({ rulesetId: 'rs-2', total: 2 })

    // the carried ruleset scores new builds as its own
    const c = place(store, 700_000_003, 3, 30).local
    score(store, c, 130, 31, 2)
    expect(page(store, { offset: 0, limit: 10 })!.rows.map((row) => row.local)).toEqual([c, a, b])
    expect(store.detailIdOf(2, c)).toBe('rs-2')
  })

  it('carries nothing when the cells differ', () => {
    const { store } = scoredBoard()
    expect(store.carries(rulesetDef(2, { weapons: [21010011, 21010013] }).cells)).toBe(false)
    expect(store.carries(rulesetDef(2, { teams: ['a', 'b'] }).cells)).toBe(false)
    expect(() => store.carryLive({ ...rulesetDef(2, { teams: ['a', 'b'] }), reuseFrom: null }, 20)).toThrow(/cannot be carried/)
    expect(store.liveRs).toBe(1)
  })

  it('ends an old ruleset\'s objects with the one carried from it', () => {
    const { store } = scoredBoard()
    store.carryLive({ ...rulesetDef(2), reuseFrom: null }, 20)
    store.installRuleset(rulesetDef(3), 21)
    store.goLive(3, 22)
    expect(store.detailPurges()).toEqual(['rs-2', 'rs-1'])
  })
})
