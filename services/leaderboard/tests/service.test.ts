/*
  Author: Runor Ewhro
  description: the service end to end on in-process bindings: an admin
               publishes and activates a ruleset, a card is submitted, read and
               scored onto the board, and the public reads answer from it. then
               the ownership rules: an older anonymous card is kept as history,
               a fresh card logs in, the owner activates and deletes builds,
               opts out (images erased, submissions refused) and back in, and a
               report hides a build. card reads, rotation generation and
               execution are fixed fakes; everything else is the real code.
*/

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import type { CardReadResult } from '@/domain/leaderboard/read'
import type { RotationExecutor, RotationGenerator } from '@/engine/leaderboard'
import type { ApiEnv, ReadMessage } from '../src/env.ts'
import { handle } from '../src/api/worker.ts'
import { consumeReads } from '../src/api/worker.ts'
import { consumeScores, settleDeadScores } from '../src/scorer/worker.ts'
import { maintain, settleDeadReads } from '../src/api/maintenance.ts'
import type { ScoreMessage } from '../src/scorer/messages.ts'
import type { CardReader } from '../src/api/read/dispatch.ts'
import { assembleRuleset, attachRefs } from '../tools/lib/ruleset.mjs'
import { accessIssuer, allowAll, batchOf, memoryD1, memoryQueue, memoryR2 } from './support.ts'

const TEAM = 'team.cloudflareaccess.test'
const AUD = 'test-aud'
const HOST = 'wutheringwaves-dc.kurogames-global.com'
const APP = 'https://app.example.test'
const RULESET = 'svc-test'
const TARGET = '1506:t547:21050046'
const UID = '600000001'

type Package = { manifest: { id: string; scenarios: Array<{ id: string }> }; files: Map<string, string>; manifestSha256: string }

// cards kuro serves, by file name: which read they produce and when they were first drawn.
const kuro = new Map<string, { tag: number; lastModified: number }>()
let kuroFetches = 0
const reads = new Map<number, CardReadResult>()
let issuer: Awaited<ReturnType<typeof accessIssuer>>
let env: ApiEnv & { LB: ReturnType<typeof memoryD1>; CARDS: ReturnType<typeof memoryR2>; LB_DATA: ReturnType<typeof memoryR2>;
  READ_QUEUE: ReturnType<typeof memoryQueue<ReadMessage>>; SCORE_QUEUE: ReturnType<typeof memoryQueue<ScoreMessage>> }

const reader: CardReader = async (bytes) => reads.get(bytes[4])!
const fixedProgram: RotationGenerator = async (plan, scenario) => ({
  status: 'interpreted', duration: 20, diagnostics: {},
  scenario: { ...scenario, initialOnFieldMemberId: scenario.team.members[plan.initialActiveSlot].id,
    program: { ...scenario.program, program: plan.sections.map((_, index) => ({ kind: 'section', index })) as never } },
})
const fixedDamage: RotationExecutor = async ({ duration, input }) =>
  ({ status: 'ok', damage: duration * (45_000 + 1000 * (input.members[input.scoredSlot].echoes[0].substats.critRate ?? 0)) })

function snapshot(critRate: number): BuildSnapshot {
  const echo = (slot: number, id: string, primary: [string, number], secondary: [string, number]) => ({
    slot, id, set: 11, mainEcho: slot === 0,
    main: { primary: { key: primary[0], value: primary[1] }, secondary: { key: secondary[0], value: secondary[1] } },
    substats: { critRate, critDmg: 16.2, atkPercent: 8.6, energyRegen: 9.2, atkFlat: 40 },
  })
  return { v: 1, gameVer: 'test', uid: UID, name: 'Tester', resonator: { id: '1506', level: 90, sequence: 0, skillLevels: {} },
    weapon: { id: '21050046', level: 90 },
    echoes: [echo(0, '6000104', ['spectro', 30], ['atkFlat', 100]), echo(1, '6000064', ['atkPercent', 18], ['hpFlat', 2280]),
      echo(2, '6000067', ['atkPercent', 18], ['hpFlat', 2280]), echo(3, '6000092', ['critDmg', 44], ['atkFlat', 150]),
      echo(4, '6000096', ['spectro', 30], ['atkFlat', 100])] }
}

function okRead(snap: BuildSnapshot): CardReadResult {
  return { parserVer: 'test-1', outcome: 'ok', uid: snap.uid, resonatorId: snap.resonator.id, snapshot: snap, ms: 1,
    confidence: { frameScore: 1, botFrame: true, uidAgreed: true, resonatorCandidates: [], echoes: [], issues: [] } }
}

/** a card kuro serves: a name, the read it gives and when it was first drawn. */
function card(tag: number, read: CardReadResult, lastModified: number): string {
  const name = `${tag.toString(16).padStart(2, '0')}${'c'.repeat(38)}`
  kuro.set(name, { tag, lastModified })
  reads.set(tag, read)
  return `https://${HOST}/back/${name.slice(0, 2)}/${name}.jpeg`
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

async function call(method: string, path: string, options: { body?: unknown; cookie?: string; admin?: boolean } = {}) {
  const headers = new Headers({ origin: APP, 'cf-connecting-ip': '203.0.113.9' })
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  if (options.cookie) headers.set('cookie', options.cookie)
  if (options.admin) headers.set('cf-access-jwt-assertion', await issuer.token())
  const response = await handle(new Request(`https://api.example.test/api/lb/v1${path}`, { method, headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body) }), env, ctx, { services: { reader } })
  const text = await response.text()
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null }
}

const submit = (input: string) => call('POST', '/cards', { body: { input, turnstileToken: 'ok' } })

/** deliver everything queued: reads, then fan-outs and scenarios, until both queues are empty. */
async function drain() {
  for (let round = 0; round < 10; round += 1) {
    const readBodies = env.READ_QUEUE.take()
    if (readBodies.length) await consumeReads(batchOf(readBodies).batch, env, { reader })
    const scoreBodies = env.SCORE_QUEUE.take()
    if (scoreBodies.length) {
      const { batch, retried } = batchOf<unknown>(scoreBodies)
      await consumeScores(batch, env, { generate: fixedProgram, execute: fixedDamage })
      expect(retried).toEqual([])
    }
    if (!readBodies.length && !scoreBodies.length) return
  }
  throw new Error('queues did not drain')
}

const cookieOf = (headers: Headers) => headers.get('set-cookie')!.split(';')[0]

beforeAll(async () => {
  issuer = await accessIssuer(TEAM, AUD)
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith(`https://${HOST}/back/`)) {
      const name = url.split('/').pop()!.replace('.jpeg', '')
      kuroFetches += 1
      const entry = kuro.get(name)
      if (!entry) return new Response('missing', { status: 404 })
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, entry.tag, 0, 0, 0]),
        { headers: { 'last-modified': new Date(entry.lastModified).toUTCString() } })
    }
    if (url.startsWith('https://challenges.cloudflare.com/')) return Response.json({ success: true })
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json(issuer.certs)
    return realFetch(input as RequestInfo, init)
  })
  env = {
    LB: memoryD1(), CARDS: memoryR2(), LB_DATA: memoryR2(), READ_QUEUE: memoryQueue<ReadMessage>(), SCORE_QUEUE: memoryQueue<ScoreMessage>(),
    BROWSER: {} as never, SUBMIT_LIMIT: allowAll, REPORT_LIMIT: allowAll,
    APP_ORIGIN: APP, KURO_CARD_HOST: HOST, KURO_CARD_PATH_PREFIX: '/back/', CARD_MAX_BYTES: '4194304', FRESH_CARD_MAX_AGE_S: '900',
    SESSION_TTL_S: '3600', READER_URL: 'https://app.example.test/reader.html', READ_MODE: 'beta', REFUSED_IMAGE_KEEP_DAYS: '30',
    ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, LINK_HASH_KEY: 'link-key', SESSION_KEY: 'session-key', TURNSTILE_SECRET: 'secret',
  } as typeof env

  // the ruleset an operator built and uploaded, with refs for one scenario at S0.
  const assembled = await assembleRuleset({ id: RULESET, mode: 'beta', gameVersion: 'test' }) as Package
  const target = assembled.manifest.scenarios.find((def) => def.id.endsWith(TARGET))!
  const pkg = attachRefs(assembled, [{ scenarioId: target.id, sequence: 0, status: 'ok', baselineDps: 20_000, benchDps: 40_000,
    perfectDps: 60_000, programs: { baseline: 'a', bench: 'b', perfect: 'c' } }]) as Package
  for (const [path, text] of pkg.files) await env.LB_DATA.put(`rulesets/${RULESET}/${path}`, text)
  expect((await call('POST', `/admin/rulesets/${RULESET}/publish`, { admin: true, body: { manifestSha256: pkg.manifestSha256 } })).status).toBe(201)
  expect((await call('POST', `/admin/rulesets/${RULESET}/activate`, { admin: true, body: {} })).status).toBe(200)
}, 120_000)

afterAll(() => { vi.unstubAllGlobals() })

let firstBuild: string
let firstCard: string

describe('the leaderboard service', () => {
  it('serves the live ruleset and refuses admin routes without access', async () => {
    const live = await call('GET', '/rulesets/live')
    expect(live.status).toBe(200)
    expect(live.body.rulesetId).toBe(RULESET)
    expect(live.headers.get('access-control-allow-origin')).toBe(APP)
    expect((await call('GET', '/admin/reports')).status).toBe(403)
    // a malformed token is refused, not an error.
    const forged = await handle(new Request('https://api.example.test/api/lb/v1/admin/reports',
      { headers: { 'cf-access-jwt-assertion': 'a.b.c' } }), env, ctx, { services: { reader } })
    expect(forged.status).toBe(403)
    expect((await call('GET', '/nowhere')).body.error.code).toBe('not_found')
  })

  it('refuses links that are not kuro cards', async () => {
    expect((await submit('https://example.com/card.jpeg')).body.error.code).toBe('not_kuro')
    expect((await submit('hello')).body.error.code).toBe('bad_link')
  })

  it('takes a card from submission to the board', async () => {
    const link = card(1, okRead(snapshot(8.1)), Date.now() - 86_400_000)
    const submitted = await submit(link)
    expect(submitted.status).toBe(202)
    firstCard = submitted.body.cardId
    expect(env.CARDS.objects.size).toBe(1)
    await drain()

    const status = await call('GET', `/cards/${firstCard}`)
    expect(status.body).toMatchObject({ status: 'scored', active: true })
    firstBuild = status.body.buildId

    const boardResponse = await call('GET', '/boards/1506')
    expect(boardResponse.body.rows).toHaveLength(1)
    expect(boardResponse.body.rows[0]).toMatchObject({ rank: 1, buildId: firstBuild, uid: UID, sequence: 0 })
    expect(boardResponse.body.rows[0].scenario.id).toMatch(new RegExp(`${TARGET}$`))
    expect(boardResponse.body.rows[0].score).toBeCloseTo(100 + 100 * (53_100 - 40_000) / 20_000)
    expect(boardResponse.headers.get('cache-control')).toContain('s-maxage=120')

    const detail = await call('GET', `/builds/${firstBuild}`)
    expect(detail.body.cells.length).toBeGreaterThan(1)
    expect(detail.body.best.scenario.id).toMatch(new RegExp(`${TARGET}$`))
    // scenarios without refs ran but are not scored.
    expect(detail.body.cells.filter((cell: { reason: string }) => cell.reason === 'no_refs').length).toBe(detail.body.cells.length - 1)

    const rotation = await handle(new Request(`https://api.example.test/api/lb/v1/builds/${firstBuild}/scenarios/${detail.body.best.scenario.id}/rotation`),
      env, ctx, { services: { reader } })
    expect(rotation.status).toBe(200)
    expect((await rotation.json()).scenarioId).toBe(detail.body.best.scenario.id)

    // the same link again is the same card, answered without fetching it from kuro again.
    const fetches = kuroFetches
    expect((await submit(link)).body).toMatchObject({ duplicate: true, cardId: firstCard })
    expect(kuroFetches).toBe(fetches)
  }, 120_000)

  it('keeps an older anonymous card as history and lets the owner choose it after a fresh-card login', async () => {
    const older = await submit(card(2, okRead(snapshot(6.3)), Date.now() - 10 * 86_400_000))
    await drain()
    expect((await call('GET', `/cards/${older.body.cardId}`)).body).toMatchObject({ active: false, inactiveReason: 'older_than_active' })

    const stored = env.CARDS.objects.size
    expect((await call('POST', '/auth/card', { body: { input: card(3, okRead(snapshot(6.3)), Date.now() - 86_400_000), turnstileToken: 'ok' } }))
      .body.error.code).toBe('not_fresh')
    // a refused login keeps nothing.
    expect(env.CARDS.objects.size).toBe(stored)
    const freshLink = card(4, okRead(snapshot(9.9)), Date.now() - 60_000)
    const login = await call('POST', '/auth/card', { body: { input: freshLink, turnstileToken: 'ok' } })
    expect(login.status).toBe(200)
    // a known card logs in again from its stored date, with no second fetch.
    const fetches = kuroFetches
    expect((await call('POST', '/auth/card', { body: { input: freshLink, turnstileToken: 'ok' } })).status).toBe(200)
    expect(kuroFetches).toBe(fetches)
    expect(login.body).toMatchObject({ uid: UID, player: { hideUid: false, optedOut: false } })
    const cookie = cookieOf(login.headers)
    await drain()

    const mine = await call('GET', '/players/me/builds', { cookie })
    const builds = mine.body.resonators['1506'] as Array<{ buildId: string; state: string; snapshot: BuildSnapshot }>
    expect(builds.filter((build) => build.state === 'active')).toHaveLength(1)
    const historic = builds.find((build) => build.snapshot.echoes[0].substats.critRate === 6.3)!
    expect((await call('POST', `/builds/${historic.buildId}/activate`, { cookie })).body.state).toBe('active')
    await drain()
    expect((await call('GET', '/boards/1506')).body.rows[0].buildId).toBe(historic.buildId)

    expect((await call('PATCH', '/players/me', { cookie, body: { hideUid: true } })).body.player.hideUid).toBe(true)
    expect((await call('GET', '/boards/1506')).body.rows[0].uid).toBeNull()

    expect((await call('DELETE', `/builds/${historic.buildId}`, { cookie })).status).toBe(200)
    expect((await call('GET', '/boards/1506')).body.rows).toEqual([])
    expect((await call('DELETE', `/builds/${firstBuild}`)).status).toBe(401)
  }, 120_000)

  it('opts out (images erased, cards refused) and back in with a fresh card', async () => {
    const login = await call('POST', '/auth/card', { body: { input: card(5, okRead(snapshot(7.0)), Date.now() - 30_000), turnstileToken: 'ok' } })
    const cookie = cookieOf(login.headers)
    expect((await call('POST', '/players/me/opt-out', { cookie })).status).toBe(200)
    expect(env.CARDS.objects.size).toBe(0)
    expect((await call('GET', '/me', { cookie })).status).toBe(401)

    const refused = await submit(card(6, okRead(snapshot(7.7)), Date.now() - 1000))
    await drain()
    expect((await call('GET', `/cards/${refused.body.cardId}`)).body).toMatchObject({ status: 'rejected', rejectReason: 'opted_out' })

    const again = await call('POST', '/auth/card', { body: { input: card(7, okRead(snapshot(7.1)), Date.now() - 1000), turnstileToken: 'ok' } })
    expect(again.body.player.optedOut).toBe(true)
    const back = await call('DELETE', '/players/me/opt-out', { cookie: cookieOf(again.headers) })
    expect(back.body.player.optedOut).toBe(false)
    // a card refused while opted out is read again once the uid is back.
    const retried = await submit(card(6, okRead(snapshot(7.7)), Date.now() - 1000))
    expect(retried.body.duplicate).toBe(false)
    await drain()
    expect((await call('GET', `/cards/${retried.body.cardId}`)).body.status).toBe('scored')
  }, 120_000)

  it('takes a report to the admin queue, where resolving it can hide the build', async () => {
    const top = (await call('GET', '/boards/1506')).body.rows[0]
    const report = await call('POST', '/reports', { body: { buildId: top.buildId, reason: 'misread', turnstileToken: 'ok' } })
    expect(report.status).toBe(201)
    const queue = await call('GET', '/admin/reports', { admin: true })
    expect(queue.body.reports.map((entry: { id: string }) => entry.id)).toEqual([report.body.reportId])
    await call('POST', `/admin/reports/${report.body.reportId}`, { admin: true, body: { status: 'resolved', hideBuild: true } })
    expect((await call('GET', '/boards/1506')).body.rows).toEqual([])
    expect((await call('GET', `/builds/${top.buildId}`)).status).toBe(404)
    const audit = env.LB.sqlite.prepare(`SELECT action FROM audit_log ORDER BY at`).all().map((row) => row.action)
    expect(audit).toEqual(expect.arrayContaining(['ruleset.publish', 'ruleset.activate', 'build.submit', 'build.delete',
      'player.opt_out', 'player.opt_in', 'report.create', 'report.resolved']))
  })

  it('refuses a card with empty echo slots as incomplete, but lets a fresh one log in', async () => {
    const incomplete = (): CardReadResult => ({ parserVer: 'test-1', outcome: 'unreadable', uid: UID, resonatorId: '1506',
      snapshot: null, ms: 1, confidence: { frameScore: 1, botFrame: true, uidAgreed: true, resonatorCandidates: [], echoes: [],
        issues: ['echo_missing'] } })
    const refused = await submit(card(11, incomplete(), Date.now() - 86_400_000))
    await drain()
    expect((await call('GET', `/cards/${refused.body.cardId}`)).body).toMatchObject({ status: 'rejected', rejectReason: 'incomplete_build' })
    const login = await call('POST', '/auth/card', { body: { input: card(12, incomplete(), Date.now() - 1000), turnstileToken: 'ok' } })
    expect(login.status).toBe(200)
    expect(login.body.uid).toBe(UID)
  })

  it('records dead-letter outcomes and permits failed reads to be resubmitted', async () => {
    const link = card(8, okRead(snapshot(8.8)), Date.now() - 1000)
    const submitted = await submit(link)
    await settleDeadReads(batchOf(env.READ_QUEUE.take()).batch, env, Date.now())
    expect((await call('GET', `/cards/${submitted.body.cardId}`)).body).toMatchObject({ status: 'rejected', rejectReason: 'read_failed' })

    // the reader was down, not the card: submitting it again reads the kept image, with no new fetch.
    const fetches = kuroFetches
    const again = await submit(link)
    expect(again.status).toBe(202)
    expect(again.body).toMatchObject({ cardId: submitted.body.cardId, duplicate: false })
    expect(kuroFetches).toBe(fetches)
    await drain()
    const status = (await call('GET', `/cards/${submitted.body.cardId}`)).body
    expect(status).toMatchObject({ status: 'scored', active: true })

    // every scenario of a rescore dead-letters: the job completes on error rows and the build leaves the board.
    await env.SCORE_QUEUE.send({ kind: 'fanout', buildId: status.buildId, rulesetId: RULESET })
    await consumeScores(batchOf<unknown>(env.SCORE_QUEUE.take()).batch, env, { generate: fixedProgram, execute: fixedDamage })
    const scenarios = env.SCORE_QUEUE.take()
    expect(scenarios.length).toBeGreaterThan(1)
    await settleDeadScores(batchOf<unknown>(scenarios).batch, env, Date.now())
    const job = env.LB.sqlite.prepare('SELECT status, done, expected FROM score_jobs WHERE build_id = ? AND ruleset_id = ?')
      .get(status.buildId, RULESET) as { status: string; done: number; expected: number }
    expect(job).toMatchObject({ status: 'scored', done: scenarios.length, expected: scenarios.length })
    expect((await call('GET', '/boards/1506')).body.rows).toEqual([])

    const health = (await call('GET', '/admin/health', { admin: true })).body
    expect(health.deadLetters).toEqual({ 'card.dead_letter': 1, 'score.dead_letter': scenarios.length })
    expect(health.scoring).toMatchObject({ rulesetId: RULESET, stale: 0, errorRows: scenarios.length })
    expect(health.cards.stuckPending).toBe(0)
  }, 120_000)

  it('expires sessions, erases rejected images after retention, and requeues stalled reads', async () => {
    const refused = await submit(card(9, { parserVer: 'test-1', outcome: 'unreadable', uid: null, resonatorId: null, snapshot: null,
      ms: 1, confidence: { frameScore: 0, botFrame: false, uidAgreed: false, resonatorCandidates: [], echoes: [], issues: [] } },
    Date.now() - 1000))
    await drain()
    expect((await call('GET', `/cards/${refused.body.cardId}`)).body.rejectReason).toBe('unreadable')
    const lost = await submit(card(10, okRead(snapshot(5.5)), Date.now() - 1000))
    env.READ_QUEUE.take()

    const later = Date.now() + 31 * 86_400_000
    const sessions = Number((env.LB.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n)
    const report = await maintain(env, later)
    // the unreadable card and the two incomplete ones (the refused submit and the login card).
    expect(report).toMatchObject({ sessionsDeleted: sessions, imagesErased: 3, requeued: 1 })
    expect(env.READ_QUEUE.take()).toEqual([{ cardId: lost.body.cardId, ownerUid: null }])
    const row = env.LB.sqlite.prepare('SELECT r2_key, image_erased_at FROM cards WHERE id = ?').get(refused.body.cardId) as
      { r2_key: string; image_erased_at: number | null }
    expect(row.image_erased_at).toBe(later)
    expect(env.CARDS.objects.has(row.r2_key)).toBe(false)
    // a second pass finds nothing left to do.
    expect(await maintain(env, later)).toMatchObject({ sessionsDeleted: 0, imagesErased: 0 })

    // the erased card's link fetches the image again and reads it anew.
    const fetches = kuroFetches
    const resubmitted = await submit(card(9, okRead(snapshot(9.1)), Date.now() - 1000))
    expect(resubmitted.body).toMatchObject({ cardId: refused.body.cardId, duplicate: false })
    expect(kuroFetches).toBe(fetches + 1)
    expect(env.CARDS.objects.has(row.r2_key)).toBe(true)
  }, 120_000)
})
