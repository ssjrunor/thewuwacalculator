/*
  Author: Runor Ewhro
  description: test data on the boards (api/moderation/seed.ts): made only by
               the local tool, from uids and build locals no real build uses;
               written builds ranked as scored ones at once, scored ones queued
               for the scorer; a chunk sent twice taken once; and a purge that
               removes a batch whole, with what real accounts wrote about it,
               leaving real players as they were.
*/

import { describe, expect, it } from 'vitest'
import type { SeedBuild, SeedRows } from '../src/api/moderation/seed.ts'
import { formatBuildId, SEED_LOCAL_FLOOR } from '../src/lib/ids.ts'
import { A, boardDb, buildOf, call, claimSession, env, SCENARIO, seedPlayer, settle, signIn, setUpAccountHarness, cellsOf } from './accountHarness.ts'

setUpAccountHarness()

const T1 = '012345678'
const T2 = '087654321'
const NOW = Date.now() - 3_600_000

const snapshot = (uid: string, name: string) => ({ v: 1 as const, gameVer: 'seed', uid, name,
  resonator: { id: '1108', level: 90, sequence: 0, skillLevels: {} }, weapon: { id: '21020086', level: 90 }, echoes: [] })
const count = (table: string) => (env.LB.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

async function seedBatch(mode: 'written' | 'scored' = 'written') {
  const made = await call('POST', '/admin/seed', { devAdmin: true, body: { label: 'test', mode, builds: 10 } })
  expect(made.status).toBe(201)
  const { id, localFrom } = made.body as { id: string; localFrom: number }
  const rows = async (body: SeedRows) => {
    const sent = await call('POST', `/admin/seed/${id}/rows`, { devAdmin: true, body })
    // the tool says when the batch is in; here, after every chunk of builds.
    if (body.builds && sent.status === 200) expect((await call('POST', `/admin/seed/${id}/finish`, { devAdmin: true, body: {} })).status).toBe(200)
    await settle()
    return sent
  }
  expect((await rows({ players: [
    { uid: T1, region: '9', name: '漂泊者', hideUid: false, anonymous: false, firstSeenAt: 10 },
    { uid: T2, region: '6', name: 'Remi', hideUid: false, anonymous: false, firstSeenAt: 10 },
  ] })).status).toBe(200)
  // the nth build of the batch.
  const idOf = (n: number) => formatBuildId({ resonator: 1108, local: localFrom + n })
  const build = (n: number, uid: string, name: string, score: number | null, at: number): SeedBuild => ({
    id: idOf(n), uid, resonatorId: '1108', sequence: 0, snapshot: snapshot(uid, name), at: NOW + at, drawnAt: NOW + at - 10,
    ...(score == null ? {} : { scores: [{ scenarioId: SCENARIO, score, damage: score * 100, dpr: score * 50, stats: null }] }),
  })
  return { id, rows, build, idOf, localFrom }
}

// the activity strip's slot counts (maintained by triggers) match a count of the shown uploads
const slotsHold = () => expect(env.LB.sqlite.prepare(`SELECT q, entries FROM upload_slots WHERE entries <> 0 ORDER BY q`).all())
  .toEqual(env.LB.sqlite.prepare(`SELECT at / 900000 AS q, COUNT(*) AS entries FROM recent_uploads WHERE shown = 1 GROUP BY q ORDER BY q`).all())

const boardRows = async () => (await call('GET', '/boards/1108')).body.rows as Array<{ buildId: string; name: string; region: string; rank: number }>

describe('test data', () => {
  it('is made only by the local tool, from uids and builds no game uses', async () => {
    expect((await call('POST', '/admin/seed', { admin: true, body: { label: 'x', mode: 'written', builds: 1 } })).status).toBe(403)
    const { rows, build } = await seedBatch()
    const real = await rows({ players: [{ uid: '512345678', region: '5', name: 'x', hideUid: false, anonymous: false, firstSeenAt: 1 }] })
    expect(real.status).toBe(400)
    expect((await rows({ builds: [{ ...build(0, T1, 'x', 50, 20), uid: '599999999' }] })).status).toBe(400)
    // a build id outside the batch's range, or on another board, is refused.
    expect((await rows({ builds: [{ ...build(0, T1, 'x', 50, 20), id: '1108-1' }] })).status).toBe(400)
    expect((await rows({ builds: [{ ...build(0, T1, 'x', 50, 20), resonatorId: '1205' }] })).status).toBe(400)
    expect((await rows({ builds: [build(0, T1, 'x', null, 20)] })).status).toBe(400)
  })

  it('ranks written builds as scored ones, and purges the batch whole', async () => {
    await seedPlayer(A, 'Alpha', 120)
    const { id, rows, build, idOf, localFrom } = await seedBatch()
    expect(localFrom).toBe(SEED_LOCAL_FLOOR)
    expect((await rows({ builds: [build(0, T1, '漂泊者', 130, 20), build(1, T2, 'Remi', 90, 30), build(2, T2, 'Remi', 100, 40)] })).status)
      .toBe(200)
    // every card is ranked as itself.
    const board = await boardRows()
    expect(board.map((row) => row.buildId)).toEqual([idOf(0), buildOf(A), idOf(2), idOf(1)])
    expect(board.map((row) => row.rank)).toEqual([1, 2, 3, 4])
    expect(board[0]).toMatchObject({ name: '漂泊者', region: '9' })
    expect((await call('GET', '/activity')).body.rows.map((row: { buildId: string }) => row.buildId)).toContain(idOf(0))
    slotsHold()
    expect(count('upload_slots')).toBeGreaterThan(0)
    expect((await call('GET', `/builds/${idOf(0)}`)).status).toBe(200)
    expect((await call('GET', `/players/${T2}`)).status).toBe(200)

    const accounts = [{ id: 'acc-1', uid: T1, createdAt: 15 }, { id: 'acc-2', uid: T2, createdAt: 15 }]
    expect((await rows({ accounts })).status).toBe(200)
    expect((await rows({
      profiles: [{ uid: T1, displayName: '漂泊者☆', bio: '声骸刷到吐' }],
      comments: [{ id: 'c-1', buildId: idOf(0), parentId: null, accountId: 'acc-2', uid: T2, body: 'How did you get crit this high?', at: 50 },
        { id: 'c-2', buildId: idOf(0), parentId: 'c-1', accountId: 'acc-1', uid: T1, body: '谢谢！运气好', at: 60 }],
      likes: [{ buildId: idOf(0), accountId: 'acc-2', at: 55 }],
      follows: [{ accountId: 'acc-2', kind: 'player', target: T1, at: 56 }],
    })).status).toBe(200)
    expect((await call('GET', `/builds/${idOf(0)}/comments`)).body.comments[0].replies).toHaveLength(1)
    expect((await call('GET', `/players/${T1}`)).body.profile).toMatchObject({ displayName: '漂泊者☆' })

    // a real account likes and comments on a test build: that goes with the batch too.
    const real = (await signIn('ana', await claimSession(A))).cookie!
    expect((await call('PUT', `/builds/${idOf(0)}/like`, { cookie: real })).status).toBe(200)
    expect((await call('POST', `/builds/${idOf(0)}/comments`, { cookie: real, body: { body: 'nice' } })).status).toBe(201)
    expect((await call('PUT', `/follows/players/${T1}`, { cookie: real })).status).toBe(200)

    expect((await call('GET', '/admin/seed', { admin: true })).body.batches).toEqual([expect.objectContaining({ id, players: 2, accounts: 2, builds: 3 })])
    const purged = await call('POST', '/admin/seed/purge', { admin: true, body: { batch: id } })
    expect(purged.body).toMatchObject({ batches: [id], players: 2, accounts: 2, builds: 3, done: true })
    await settle()

    const left = await boardRows()
    expect(left.map((row) => [row.buildId, row.rank])).toEqual([[buildOf(A), 1]])
    slotsHold()
    for (const table of ['seed_batches', 'comments', 'likes', 'follows']) expect(count(table)).toBe(0)
    for (const table of ['players', 'player_boards', 'recent_uploads']) {
      expect(env.LB.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE uid LIKE '0%'`).get()).toEqual({ n: 0 })
    }
    // profiles are the accounts', and every seeded account is gone with its documents.
    expect(env.LB.sqlite.prepare(`SELECT COUNT(*) AS n FROM documents WHERE kind IN ('profile', 'views', 'card')
      AND substr(owner_id, 1, 36) NOT IN (SELECT id FROM accounts)`).get()).toEqual({ n: 0 })
    expect(boardDb().prepare(`SELECT COUNT(*) AS n FROM builds WHERE id >= ?`).get(SEED_LOCAL_FLOOR)).toEqual({ n: 0 })
    expect(count('accounts')).toBe(1)
    expect((await call('GET', `/players/${A}`)).status).toBe(200)
  })

  it('writes the entries once the batch is in', async () => {
    const { id, build, idOf } = await seedBatch()
    expect((await call('POST', `/admin/seed/${id}/rows`, { devAdmin: true, body: { builds: [build(0, T1, '漂泊者', 130, 20)] } })).status).toBe(200)
    await settle()
    expect(await boardRows()).toEqual([])
    expect((await call('POST', `/admin/seed/${id}/finish`, { devAdmin: true, body: {} })).body.boards).toBe(1)
    await settle()
    expect((await boardRows()).map((row) => row.buildId)).toEqual([idOf(0)])
    expect((await call('POST', `/admin/seed/${id}/finish`, { devAdmin: true, body: {} })).body.boards).toBe(0)
  })

  it('takes a chunk sent twice once, and ranks a later build beside the player\'s others', async () => {
    const { id, rows, build, idOf } = await seedBatch()
    const first = [build(0, T1, '漂泊者', 100, 20), build(1, T2, 'Remi', 90, 30)]
    expect((await rows({ builds: first })).status).toBe(200)
    // a resent chunk after a lost response inserts nothing
    expect((await rows({ builds: first })).body.inserted).toBe(0)
    expect(boardDb().prepare(`SELECT COUNT(*) AS n FROM builds`).get()).toEqual({ n: 2 })
    expect(boardDb().prepare(`SELECT COUNT(*) AS n FROM s1`).get()).toEqual({ n: 2 })
    expect((await call('GET', '/admin/seed', { admin: true })).body.batches[0]).toMatchObject({ id, players: 2, builds: 2, uidFrom: T1, uidTo: T2 })

    // a player's card in a later chunk is ranked beside their others.
    expect((await rows({ builds: [build(2, T1, '漂泊者', 140, 50)] })).status).toBe(200)
    expect((await boardRows()).map((row) => row.buildId)).toEqual([idOf(2), idOf(0), idOf(1)])
    expect(boardDb().prepare(`SELECT state FROM builds WHERE id = ?`).get(SEED_LOCAL_FLOOR)).toEqual({ state: 0 })
    expect((await call('POST', '/admin/seed/purge', { admin: true, body: { batch: id } })).body).toMatchObject({ builds: 3, done: true })
    // a later batch takes the next range.
    const next = await call('POST', '/admin/seed', { devAdmin: true, body: { label: 'again', mode: 'written', builds: 1 } })
    expect(next.body.localFrom).toBe(SEED_LOCAL_FLOOR)
  })

  it('queues scored builds for the scorer', async () => {
    const { rows, build } = await seedBatch('scored')
    const before = env.SCORE_QUEUE.sent.length
    expect((await rows({ builds: [build(0, T1, 'x', null, 20)] })).status).toBe(200)
    expect(env.SCORE_QUEUE.sent.length).toBeGreaterThan(before)
    // bulk work goes as a group message: its build is the seeded one.
    expect(cellsOf(env.SCORE_QUEUE.sent).at(-1)).toMatchObject({ lane: 'bulk', local: SEED_LOCAL_FLOOR })
    // purging every batch takes it too.
    expect((await call('POST', '/admin/seed/purge', { admin: true, body: {} })).body.builds).toBe(1)
    expect(boardDb().prepare(`SELECT COUNT(*) AS n FROM builds`).get()).toEqual({ n: 0 })
  })
})
