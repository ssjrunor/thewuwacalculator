/*
  Author: Runor Ewhro
  description: ruleset rollouts through their admin routes (local dev token) on
               the board objects: a rollout installs the new ruleset on every
               board, whose alarms fan builds out on the bulk lane; it stays in
               progress until every board has scored every build, then goes live
               and the boards rank by it. rescores go out per lane, and a
               deployed scorer batch past its time budget resends the rest, each
               message on its own lane. a rollout with the same scorer (or one
               that passed a sample check) offers the scorer each build's old
               scores; kept scores go to the board with the rest, which the
               board sends as groups. a cancelled rollout leaves nothing.
*/

import { describe, expect, it, vi } from 'vitest'
import type { CellMessage, GroupMessage, ReuseMessage } from '../src/scorer/messages.ts'
import { consumeScores, REUSE_ATTEMPTS, settleDeadScores } from '../src/scorer/worker.ts'
import type { ReuseOutcome } from '../src/scorer/reuse.ts'
import { boardOf } from '../src/api/stubs.ts'
import { gzipJson } from '../src/scorer/messages.ts'
import { batchOf } from './support.ts'
import { hasScoringData } from '@lb/scoring'
import { A, B, boardDb, boardIds, buildOf, call, cellsOf, env, scoreQueued, seedPlayer, settle, setUpAccountHarness, takeCells } from './accountHarness.ts'

setUpAccountHarness()

const NEXT = 'next'

// publishes the next ruleset: the live one's single scenario under a new number
function publishNext(fingerprint = 'new-fp') {
  env.LB.sqlite.exec(`
    UPDATE rulesets SET fingerprint = 'old-fp' WHERE id = 'ruleset';
    INSERT INTO rulesets (id, no, game_ver, engine_ver, rotation_ver, manifest_key, manifest_sha256, status, created_at, fingerprint)
      VALUES ('${NEXT}', 2, 'test', 'test', 'test', 'manifest', 'hash', 'building', 2, '${fingerprint}');
    INSERT INTO scenarios (id, rs, ruleset_id, resonator_id, cell, team_id, recipe_sha256, team_key, weapon_id, weapon_rank, weapon_role,
      team_rank, members)
      VALUES ('${NEXT}:1108:t1:21020086', 2, '${NEXT}', '1108', 0, 't1', 'hash', '1108-1109-1110', '21020086', 1, 'signature', 1,
        '["1108","1109","1110"]');
  `)
}

// a test reuse step: reuses the old scores of `keep`'s builds and scores the rest
const keepFor = (keep: Set<number>) => async (_env: unknown, message: ReuseMessage): Promise<ReuseOutcome> => {
  if (!keep.has(message.local)) return { results: [], rescore: message.cells, kept: 0, rescaled: 0 }
  return { kept: message.old.length, rescaled: 0, rescore: [], results: message.old.map((old) => ({ rs: message.rs, local: message.local,
    gen: message.gen, cell: message.cells.find((cell) => cell.key === old.key)!.cell, status: old.status, score: old.score, damage: old.damage,
    dpr: old.dpr, flags: old.flags, reason: old.reason, weapon: Number(old.key.split(':')[2]), stats: null, detail: null })) }
}

const localOf = (buildId: string) => Number.parseInt(buildId.split('-')[1], 36)

const live = () => (env.LB.sqlite.prepare(`SELECT value FROM settings WHERE key = 'live_ruleset'`).get() as { value: string }).value
const sweep = () => call('POST', '/admin/sweep', { devAdmin: true, body: { stallMs: 60_000 } })

describe('ruleset rollouts', () => {
  it('signs the local tool in only with the dev token, on this machine', async () => {
    publishNext()
    const start = (options: { devToken?: string; origin?: string } = {}) =>
      call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: {}, ...options })
    expect((await start({ devToken: 'x'.repeat(40) })).status).toBe(403)
    expect((await start({ origin: 'https://lb.example.test' })).status).toBe(403)
    expect((await start()).status).toBe(202)
  })

  it('stays building until every board has scored every build, then goes live', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    publishNext()
    expect((await call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: {} })).body)
      .toMatchObject({ rulesetId: NEXT, from: 'ruleset', boards: 1 })
    // the board's alarm fans its builds out on the bulk lane
    await settle(120_000)
    // both builds share one program and are sent as one group
    expect(env.SCORE_QUEUE.sent.map((message) => [message.k, message.rid, message.lane])).toEqual([['g', NEXT, 'bulk']])
    expect(cellsOf(env.SCORE_QUEUE.sent).map((message) => [message.rid, message.lane])).toEqual([[NEXT, 'bulk'], [NEXT, 'bulk']])
    expect((await sweep()).body.rollouts).toEqual({ live: [], done: [] })
    expect(live()).toBe('ruleset')

    // scored on the new ruleset, it goes live and the board ranks by it (B ahead)
    const [first, second] = takeCells()
    env.SCORE_QUEUE.sent.push(first as never)
    await scoreQueued(90)
    expect((await sweep()).body.rollouts).toEqual({ live: [], done: [] })
    env.SCORE_QUEUE.sent.push(second as never)
    await scoreQueued(140)
    expect((await sweep()).body.rollouts).toEqual({ live: [NEXT], done: [NEXT] })
    expect(live()).toBe(NEXT)
    await settle()
    const board = (await call('GET', '/boards/1108')).body
    expect(board.rulesetId).toBe(NEXT)
    const scores = new Map((board.rows as Array<{ buildId: string; score: number }>).map((row) => [row.buildId, row.score]))
    expect([...scores.values()].sort()).toEqual([140, 90])
    expect(await boardIds()).toHaveLength(2)
  })

  it('carries a board the new ruleset leaves as it is: nothing is scored, and it goes live with the same scores', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    publishNext()
    // the same scenario, fingerprint, anchors and units in both rulesets
    env.LB.sqlite.exec(`UPDATE scenarios SET fingerprint = 'scenario-fp'`)
    for (const id of ['ruleset', NEXT]) {
      await env.LB_DATA.put(`rulesets/${id}/manifest.json`, JSON.stringify({ id, files: { anchors: 'anchors/', units: 'units.json', refs: null },
        hashes: { 'anchors/1108/t1-21020086.json': { bytes: 1, sha256: 'anchor' } }, scenarios: [] }))
      await env.LB_DATA.put(`rulesets/${id}/units.json`, JSON.stringify({ units: { 'echo:1': 'e', 'def:1108:t1:21020086': 'd' } }))
    }
    expect((await call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: {} })).body)
      .toMatchObject({ rulesetId: NEXT, boards: 1, carried: ['1108'] })
    await settle(120_000)
    expect(env.SCORE_QUEUE.sent).toEqual([])
    expect((await call('GET', `/admin/rulesets/${NEXT}/progress`, { devAdmin: true })).body.progress)
      .toMatchObject({ installed: 1, carried: 1, settled: 1, scoring: 0 })

    expect((await sweep()).body.rollouts).toEqual({ live: [NEXT], done: [NEXT] })
    await settle()
    expect(env.SCORE_QUEUE.sent).toEqual([])
    const board = (await call('GET', '/boards/1108')).body
    expect(board.rulesetId).toBe(NEXT)
    expect((board.rows as Array<{ buildId: string; score: number }>).map((row) => [row.buildId, row.score]))
      .toEqual([[buildOf(A), 120], [buildOf(B), 110]])
    const detail = (await call('GET', `/builds/${buildOf(A)}`)).body
    expect(detail.cells.map((cell: { scenario: { id: string }; status: string }) => [cell.scenario.id, cell.status]))
      .toEqual([[`${NEXT}:1108:t1:21020086`, 'ok']])
    // the jobs moved to the new number and read the old ruleset's detail objects, which stay in R2
    expect(boardDb().prepare(`SELECT build, detail_from FROM j2 ORDER BY build`).all()).toEqual([
      { build: localOf(buildOf(A)), detail_from: 1 }, { build: localOf(buildOf(B)), detail_from: 1 }])
    expect([...env.LB_DATA.objects.keys()].filter((key) => key.startsWith('detail/'))).toEqual([
      `detail/ruleset/1108/${buildOf(A)}.json.gz`, `detail/ruleset/1108/${buildOf(B)}.json.gz`])
  })

  it('refuses a rollout whose fingerprint matches the live ruleset, unless forced', async () => {
    publishNext('old-fp')
    expect((await call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: {} })).status).toBe(400)
    expect((await call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: { force: true } })).status).toBe(202)
  })

  it('refuses a rollout over verified scenarios with no offline anchors, unless search is allowed', async () => {
    publishNext()
    const team = Array.from({ length: 1000 }, (_, n) => `t${n}`).find((teamId) => hasScoringData({ teamId } as never))!
    const scenario = (weapon: string) => ({ id: `${NEXT}:1108:${team}:${weapon}`, resonatorId: '1108', teamId: team, weapon: { id: weapon } })
    // one scenario anchored and one not; unverified scenarios never search and are not counted
    await env.LB_DATA.put(`rulesets/${NEXT}/manifest.json`, JSON.stringify({ files: { anchors: 'anchors' },
      hashes: { [`anchors/1108/${team}-21020086.json`]: { sha256: 'x', bytes: 1 } },
      scenarios: [scenario('21020086'), scenario('21020016'), { ...scenario('21020026'), teamId: 'unreviewed-team' }] }))
    const refused = await call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: {} })
    expect(refused.status).toBe(400)
    expect(JSON.stringify(refused.body)).toContain(`1 scenarios of ${NEXT} have no offline anchors (${NEXT}:1108:${team}:21020016)`)
    expect((await call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: { allowSearch: true } })).status).toBe(202)
  })

  it('rescores named builds on the interactive lane and a whole ruleset on the bulk lane', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    expect((await call('POST', '/admin/rulesets/ruleset/rescore', { devAdmin: true, body: { buildIds: [buildOf(B)] } })).body)
      .toEqual({ rulesetId: 'ruleset', builds: 1 })
    expect((env.SCORE_QUEUE.take() as unknown as CellMessage[]).map((message) => [message.local, message.lane]))
      .toEqual([[Number.parseInt(buildOf(B).split('-')[1], 36), undefined]])
    expect((await call('POST', '/admin/rulesets/ruleset/rescore', { devAdmin: true, body: {} })).body).toEqual({ rulesetId: 'ruleset', builds: 2 })
    expect(takeCells().map((message) => message.lane)).toEqual(['bulk', 'bulk'])
  })

  it('ends each build of a dead group as an error row, so every job still finishes', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    await call('POST', '/admin/rulesets/ruleset/rescore', { devAdmin: true, body: {} })
    const [group] = env.SCORE_QUEUE.take() as unknown as GroupMessage[]
    expect([group.k, group.builds.length]).toEqual(['g', 2])
    await settleDeadScores(batchOf<unknown>([group]).batch, env as never, Date.now())
    await settle()
    const jobs = boardDb().prepare(`SELECT status, done, expected FROM j1`).all()
    expect(jobs).toEqual([{ status: 1, done: 1, expected: 1 }, { status: 1, done: 1, expected: 1 }])
    expect(env.LB.sqlite.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'score.dead_letter'`).get()).toEqual({ n: 2 })
  })

  it('returns the rest of a deployed batch to its lanes once it runs past the budget', async () => {
    const bulk = { ...env.SCORE_QUEUE, sent: [] as unknown[] }
    Object.assign(env, { SCORE_BULK_QUEUE: { sent: bulk.sent, sendBatch: async (messages: Array<{ body: unknown }>) => {
      for (const message of messages) bulk.sent.push(message.body)
    } } })
    let clock = 0
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 130_000))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      // the first cell is tried and retried later (its ruleset is unpublished), and the budget runs out after it
      const cell = (local: number, lane?: 'bulk'): CellMessage => ({ k: 's', res: 1108, local, gen: 1, rs: 9, rid: 'unpublished', cell: 0,
        key: '1108:t1:21020086', snap: '', ...(lane ? { lane } : {}) })
      const bodies = [cell(1), cell(2, 'bulk'), cell(3)]
      const { batch, acked, retried } = batchOf<unknown>(bodies)
      await consumeScores(batch, env as never)
      expect(retried).toEqual([bodies[0]])
      expect(acked).toEqual([bodies[1], bodies[2]])
      expect(bulk.sent).toEqual([bodies[1]])
      expect(env.SCORE_QUEUE.take()).toEqual([bodies[2]])
    } finally {
      now.mockRestore()
      quiet.mockRestore()
    }
  })

  it('reuses a build\'s scores on scenarios that score alike, and sends only the rest', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    publishNext()
    env.LB.sqlite.exec(`UPDATE rulesets SET scorer = 'same'`)
    expect((await call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: {} })).body).toMatchObject({ keep: 'scenario' })
    await settle(120_000)
    // one message per build, with its old score on the scenario both rulesets score
    const offers = env.SCORE_QUEUE.take() as unknown as ReuseMessage[]
    expect(offers.map((offer) => [offer.k, offer.rid, offer.fid, offer.lane, offer.old.map((old) => [old.key, old.score])])).toEqual([
      ['r', NEXT, 'ruleset', 'bulk', [['1108:t1:21020086', 120]]], ['r', NEXT, 'ruleset', 'bulk', [['1108:t1:21020086', 110]]]])

    // A's score is kept; B's scenario returns to the board with it and is sent as a group
    const { batch, acked } = batchOf<unknown>(offers)
    await consumeScores(batch, env as never, { reuse: keepFor(new Set([localOf(buildOf(A))])) })
    expect(acked).toHaveLength(2)
    const rest = takeCells()
    expect(rest.map((message) => [message.k, message.local, message.lane, message.gen])).toEqual([['s', localOf(buildOf(B)), 'bulk', offers[1].gen]])
    env.SCORE_QUEUE.sent.push(...rest as never[])
    await scoreQueued(140)
    expect((await sweep()).body.rollouts).toEqual({ live: [NEXT], done: [NEXT] })
    await settle()
    const rows = (await call('GET', '/boards/1108')).body.rows as Array<{ buildId: string; score: number }>
    expect(rows.map((row) => [row.buildId, row.score])).toEqual([[buildOf(B), 140], [buildOf(A), 120]])
  })

  it('offers each old score on its program when the new scorer differs from the old in its generator alone', async () => {
    await seedPlayer(A, 'Alpha', 120)
    publishNext()
    env.LB.sqlite.exec(`UPDATE rulesets SET scorer = 'old', generator_fp = 'g1', evaluation_fp = 'e' WHERE id = 'ruleset';
      UPDATE rulesets SET scorer = 'new', generator_fp = 'g2', evaluation_fp = 'e' WHERE id = '${NEXT}'`)
    expect((await call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: {} })).body).toMatchObject({ keep: 'scenario' })
    await settle(120_000)
    const offers = env.SCORE_QUEUE.take() as unknown as ReuseMessage[]
    expect(offers.map((offer) => [offer.k, offer.old.map((old) => [old.key, old.score, old.program])])).toEqual([
      ['r', [['1108:t1:21020086', 120, true]]]])
  })

  it('offers nothing when the new scorer\'s evaluation differs', async () => {
    await seedPlayer(A, 'Alpha', 120)
    publishNext()
    env.LB.sqlite.exec(`UPDATE rulesets SET scorer = 'old', evaluation_fp = 'e1' WHERE id = 'ruleset';
      UPDATE rulesets SET scorer = 'new', evaluation_fp = 'e2' WHERE id = '${NEXT}'`)
    await call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: {} })
    await settle(120_000)
    expect(cellsOf(env.SCORE_QUEUE.take()).map((message) => [message.k, message.key])).toEqual([['s', '1108:t1:21020086']])
  })

  it('scores a job whole when its reuse fails repeatedly, and offers nothing when the scorer changed', async () => {
    await seedPlayer(A, 'Alpha', 120)
    publishNext()
    env.LB.sqlite.exec(`UPDATE rulesets SET scorer = 'same'`)
    await call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: {} })
    await settle(120_000)
    const [offer] = env.SCORE_QUEUE.take() as unknown as ReuseMessage[]
    const failing = async () => { throw new Error('r2 is down') }
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const first = batchOf<unknown>([offer])
      await consumeScores(first.batch, env as never, { reuse: failing })
      expect([first.retried, env.SCORE_QUEUE.take()]).toEqual([[offer], []])
      const last = batchOf<unknown>([offer])
      for (const message of last.batch.messages) Object.assign(message, { attempts: REUSE_ATTEMPTS })
      await consumeScores(last.batch, env as never, { reuse: failing })
      expect(last.acked).toEqual([offer])
      expect(takeCells().map((message) => [message.k, message.key])).toEqual([['s', '1108:t1:21020086']])
    } finally {
      quiet.mockRestore()
    }
  })

  it('reuses scores by data when a sample check of the new scorer is all identical', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    publishNext()
    env.LB.sqlite.exec(`UPDATE rulesets SET scorer = 'old' WHERE id = 'ruleset'; UPDATE rulesets SET scorer = 'new' WHERE id = '${NEXT}';
      UPDATE scenarios SET data_fingerprint = 'data'`)
    const sample = (await call('GET', `/admin/rulesets/${NEXT}/samples?per=10`, { devAdmin: true })).body
    expect(sample).toMatchObject({ from: 'ruleset', scorer: 'new', eligible: 2, per: 10, scenarios: 1 })
    expect(sample.samples.map((entry: { buildId: string; scenarioId: string }) => [entry.buildId, entry.scenarioId]).sort())
      .toEqual([[buildOf(A), `${NEXT}:1108:t1:21020086`], [buildOf(B), `${NEXT}:1108:t1:21020086`]].sort())
    expect(sample.samples[0].snapshot).toMatchObject({ uid: expect.any(String), resonator: { id: '1108' } })

    // what the new scorer gave each: the same score, damage and parts as stored
    const scored = (buildId: string, score: number) => ({ buildId, scenarioId: `${NEXT}:1108:t1:21020086`, result: {
      scenarioId: `${NEXT}:1108:t1:21020086`, status: 'ok', score, damage: score * 100, reason: null, contribution: null, input: null,
      anchors: null, programSha256: null, stats: null } })
    const verify = (results: unknown[]) => call('POST', `/admin/rulesets/${NEXT}/verify`, { devAdmin: true, body: { from: 'ruleset', scorer: 'new', results } })
    expect((await verify([scored(buildOf(A), 120), scored(buildOf(B), 111)])).body)
      .toMatchObject({ samples: 2, differing: [{ buildId: buildOf(B), fields: ['score', 'damage'] }], scenarios: { checked: 1, kept: 0 },
        keep: 'scenario' })
    // the scenario differed, so a rollout reuses nothing
    expect(env.LB.sqlite.prepare(`SELECT key, samples, differing FROM ruleset_check_scenarios`).all())
      .toEqual([{ key: '1108:t1:21020086', samples: 2, differing: 1 }])
    expect((await call('POST', `/admin/rulesets/${NEXT}/verify`, { devAdmin: true, body: { scorer: 'old', results: [scored(buildOf(A), 120)] } })).status)
      .toBe(400)
    // checked again, its verdict is replaced
    expect((await verify([scored(buildOf(A), 120), scored(buildOf(B), 110)])).body)
      .toMatchObject({ samples: 2, differing: [], scenarios: { checked: 1, kept: 1 }, keep: 'data' })
    expect(env.LB.sqlite.prepare(`SELECT samples, differing FROM ruleset_checks`).all()).toEqual([{ samples: 2, differing: 0 }])

    // the scorers differ, and the scenario's passed check makes the boards offer its old scores
    expect((await call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: {} })).body).toMatchObject({ keep: 'data' })
    await settle(120_000)
    expect((env.SCORE_QUEUE.take() as unknown as ReuseMessage[]).map((message) => message.k)).toEqual(['r', 'r'])
  })

  it('cancelling drops the rolling ruleset\'s tables and detail objects, and a late result acks as stale', async () => {
    await seedPlayer(A, 'Alpha', 120)
    publishNext()
    await call('POST', `/admin/rulesets/${NEXT}/rollout`, { devAdmin: true, body: {} })
    await settle(120_000)
    const [late] = takeCells()
    // one build of the rollout already has its detail object
    await env.LB_DATA.put(`detail/${NEXT}/1108/${buildOf(A)}.json.gz`, await gzipJson({ v: 1 }))
    expect((await call('POST', `/admin/rulesets/${NEXT}/rollout/cancel`, { devAdmin: true, body: {} })).body).toEqual({ rulesetId: NEXT, cancelled: true })
    await settle()
    expect(boardDb().prepare(`SELECT state FROM rulesets WHERE id = ?`).get(NEXT)).toEqual({ state: 3 })
    expect(boardDb().prepare(`SELECT name FROM sqlite_master WHERE name IN ('s2', 'j2', 'e2', 'c2')`).all()).toEqual([])
    expect((await env.LB_DATA.list({ prefix: `detail/${NEXT}/` })).objects).toEqual([])
    expect(await boardOf(env, 1108).recordScores(1108, [{ rs: late.rs, local: late.local, gen: late.gen, cell: late.cell, status: 'ok', score: 1,
      damage: 100, dpr: null, flags: 0, reason: null, weapon: 21020086, stats: null, detail: null }])).toEqual(['stale'])
    expect(live()).toBe('ruleset')
    expect(await boardIds()).toEqual([buildOf(A)])
  })
})
