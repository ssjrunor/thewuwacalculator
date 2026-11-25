/*
  Author: Runor Ewhro
  description: shared setup for tests running the real routes and sql without
               a ruleset: an in-memory service with one live ruleset and one
               scenario, a fake oauth provider, card-claimed sessions, sign-in,
               and players seeded with one scored build. a test file calls
               setUpAccountHarness() once, then the helpers.
*/

import { afterAll, beforeAll, beforeEach, expect, vi } from 'vitest'
import type { ApiEnv, ReadMessage } from '../src/env.ts'
import { discordProfile, type OAuthProvider } from '../src/api/auth/oauth.ts'
import type { ScoreMessage } from '../src/scorer/messages.ts'
import { handle } from '../src/api/worker.ts'
import { cellMessagesOfGroup, isGroupMessage, type CellMessage } from '../src/scorer/messages.ts'
import { sessionTokenHash } from '../src/lib/session.ts'
import { packSnapshot } from '../src/lib/snapshotPack.ts'
import { playerFacts } from '../src/api/players.ts'
import { boardOf, shardOfLink } from '../src/api/stubs.ts'
import { formatBuildId } from '../src/lib/ids.ts'
import { BoardDO } from '../src/board/BoardDO.ts'
import { CardRegistryDO } from '../src/cards/CardRegistryDO.ts'
import type { BuildSnapshot } from '@lb/contract/snapshot'
import { accessIssuer, allowAll, memoryD1, memoryQueue, memoryR2 } from './support.ts'
import { memoryNamespace, runAlarms, type MemoryNamespace } from './durableObjects.ts'

export const APP = 'https://app.example.test'
const TEAM = 'team.example.test'
const AUD = 'aud'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
export const A = '500000001'
export const B = '500000002'
/** a png header for `width` by `height`: the signature and the IHDR chunk, the only bytes the service reads. */
export const pngOf = (width: number, height: number) => {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}
export const PNG = pngOf(64, 64)

export let env: ApiEnv & { LB: ReturnType<typeof memoryD1>; CARDS: ReturnType<typeof memoryR2>; SCORE_QUEUE: ReturnType<typeof memoryQueue<ScoreMessage>>
  BOARDS: MemoryNamespace<BoardDO>; CARD_REGISTRY: MemoryNamespace<CardRegistryDO> }
let issuer: Awaited<ReturnType<typeof accessIssuer>>
let serial = 0

/** a provider that approves any code: the code names the person signing in. */
const fakeDiscord: OAuthProvider = {
  authorizeUrl: ({ state, challenge, redirectUri }) =>
    `https://discord.test/authorize?state=${state}&challenge=${challenge}&redirect=${encodeURIComponent(redirectUri)}`,
  identify: async ({ code, verifier }) => {
    if (!verifier) throw new Error('no verifier')
    if (code === 'bad') throw new Error('refused')
    // a person named `plain-*` has a bare discord profile; anyone else has a name, avatar, banner and accent.
    const id = String(1000 + [...code].reduce((sum, char) => sum + char.charCodeAt(0), 0))
    const profile = discordProfile(code.startsWith('plain-') ? { id, username: code }
      : { id, username: code, global_name: `Discord ${code}`, avatar: 'a'.repeat(32), banner: 'b'.repeat(32), accent_color: 0x3366cc })
    return { subject: `person-${code}`, profile }
  },
}

/** `devAdmin` signs in as the local `lb` tool does: the dev token, on a request to this machine. */
export async function call(method: string, path: string,
  options: { body?: unknown; raw?: Uint8Array; cookie?: string; admin?: boolean; devAdmin?: boolean; devToken?: string; origin?: string } = {}) {
  const headers = new Headers({ origin: APP, 'cf-connecting-ip': '203.0.113.9' })
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  if (options.cookie) headers.set('cookie', options.cookie)
  if (options.admin) headers.set('cf-access-jwt-assertion', await issuer.token())
  if (options.devAdmin) headers.set('x-lb-dev-admin', options.devToken ?? DEV_TOKEN)
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
  const origin = options.origin ?? (options.devAdmin ? 'http://127.0.0.1:8787' : 'https://api.example.test')
  const response = await handle(new Request(`${origin}/api/lb${path}`, { method, headers, body }), env, ctx,
    { services: { oauth: { discord: fakeDiscord } } })
  const type = response.headers.get('content-type') ?? ''
  const parsed = type.includes('json') ? await response.json() as any : null // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: response.status, headers: response.headers, body: parsed }
}

const DEV_TOKEN = 'd'.repeat(40)

export const cookieOf = (headers: Headers) => headers.get('set-cookie')?.split(';')[0] ?? null

/** a claim session (no account) holding `uid`, proved with a fresh card. */
export async function claimSession(uid: string): Promise<string> {
  const token = `token-${++serial}`
  const hash = await sessionTokenHash(env.SESSION_KEY, token)
  const claim = `claim-${serial}`
  env.LB.sqlite.prepare(`INSERT OR IGNORE INTO players (uid, region, hide_uid, first_seen_at, last_seen_at) VALUES (?, '5', 0, 1, 1)`).run(uid)
  env.LB.sqlite.prepare(`INSERT INTO claims (id, uid, card_id, kind, created_at) VALUES (?, ?, 'card', 'fresh_card', ?)`).run(claim, uid, serial)
  env.LB.sqlite.prepare(`INSERT INTO sessions (token_hash, account_id, claim_id, created_at, expires_at) VALUES (?, NULL, ?, ?, ?)`)
    .run(hash, claim, serial, Date.now() + 86_400_000)
  env.LB.sqlite.prepare(`INSERT OR REPLACE INTO uid_holds (uid, token_hash, claim_id, created_at) VALUES (?, ?, ?, ?)`).run(uid, hash, claim, serial)
  return `lb_session=${token}`
}

/** signs in with the fake provider as `person` from the session in `cookie` (if any) and returns the resulting cookie. */
export async function signIn(person: string, cookie?: string): Promise<{ cookie: string | null; landed: string }> {
  const start = await call('GET', '/auth/oauth/discord/start?return=/leaderboard/me', { cookie })
  expect(start.status).toBe(302)
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!
  const back = await call('GET', `/auth/oauth/discord/callback?code=${person}&state=${state}`, { cookie })
  expect(back.status).toBe(302)
  return { cookie: cookieOf(back.headers) ?? cookie ?? null, landed: back.headers.get('location')! }
}

const seeded = new Map<string, { build: string; card: string; snapHash: string }>()
/** the build seedPlayer stored last for a uid, and its card and snapshot hash. */
export const buildOf = (uid: string) => seeded.get(uid)?.build ?? `1108-zz${uid.slice(-3)}`
export const seededCard = (uid: string) => seeded.get(uid)!

/** the boards' alarms (outbox to D1, detail objects) until they are still. */
export const settle = (soonMs?: number) => runAlarms([env.BOARDS, env.CARD_REGISTRY] as Array<MemoryNamespace<unknown>>, { soonMs })

/** a board's sqlite database. */
export const boardDb = (resonator = '1108') => env.BOARDS.instances.get(resonator)!.storage.db

/** what was queued, a group message (bulk work, many builds) taken apart into one cell message per build. */
export const cellsOf = (messages: unknown[]): CellMessage[] =>
  messages.flatMap((message) => isGroupMessage(message) ? cellMessagesOfGroup(message) : [message as CellMessage])

/** the queued messages, as cells (cellsOf). */
export const takeCells = () => cellsOf(env.SCORE_QUEUE.take())

/** the scorer's part: every cell queued (a group's, each of its builds) scores `score` on its board. */
export async function scoreQueued(score: number, weapon = 21020086): Promise<number> {
  const sent = takeCells()
  for (const message of sent) {
    await boardOf(env, message.res).recordScores(message.res, [{ rs: message.rs, local: message.local, gen: message.gen, cell: message.cell,
      status: 'ok' as const, score, damage: score * 100, dpr: null, flags: 0, reason: null, weapon, stats: null, detail: null }])
  }
  await settle()
  return sent.length
}

/** a player with one active build, scored and on its board; `at` is the upload time and `hide` hides the uid. repeat
    calls for a uid store another build (a different weapon level), ranked by its score like an upload. */
export async function seedPlayer(uid: string, name: string, score: number,
  { at = 1, hide = false, linkHash }: { at?: number; hide?: boolean; linkHash?: string } = {}) {
  env.LB.sqlite.prepare(`INSERT OR IGNORE INTO players (uid, region, last_name, hide_uid, first_seen_at, last_seen_at) VALUES (?, '5', ?, ?, 1, 1)`)
    .run(uid, name, hide ? 1 : 0)
  return placeScored(uid, score, { at, linkHash, name })
}

/** a read 1108 card of an existing player, placed on its board and scored `score` (null leaves its job scoring);
    each call creates a new build with a different weapon level. */
export async function placeScored(uid: string, score: number | null, { at = 1, drawnAt = 1, seq = 0, weapon = '21020086', owner = false,
  linkHash, name = null }: { at?: number; drawnAt?: number; seq?: number; weapon?: string; owner?: boolean; linkHash?: string
  name?: string | null } = {}): Promise<string> {
  const n = ++serial
  const snapshot: BuildSnapshot = { v: 1, gameVer: 'test', uid, name, resonator: { id: '1108', level: 90, sequence: seq, skillLevels: {} },
    weapon: { id: weapon, level: 90 - (n % 10) }, echoes: [] }
  // its card, read and placed in the registry as ingest leaves one.
  const hash = linkHash ?? n.toString(16).padStart(64, '0')
  const registry = shardOfLink(env, hash)
  const { card } = await registry.stub.record(registry.shard, { linkHash: hash, contentType: 'image/jpeg', byteSize: 1,
    imageSha256: `image-${n}`, lastModified: drawnAt })
  const snapHash = `hash-${uid}-${n}`
  const board = boardOf(env, 1108)
  const { placement } = await board.place(1108, { uid: Number(uid), player: (await playerFacts(env.LB, uid))!, card: card.id,
    snap: packSnapshot(snapshot), snapHash, seq, drawnAt, owner, now: at })
  expect(env.SCORE_QUEUE.sent).toHaveLength(1)
  if (score != null) await scoreQueued(score, Number(weapon))
  await settle()
  const id = formatBuildId({ resonator: 1108, local: placement.local })
  await registry.stub.setPlaced(registry.shard, card.no, Number(uid), 1108, id)
  seeded.set(uid, { build: id, card: card.id, snapHash })
  return id
}

export const boardIds = async () => ((await call('GET', '/boards/1108')).body.rows as Array<{ buildId: string }>).map((row) => row.buildId)
export const accountOf = (cookie: string) => call('GET', '/me', { cookie }).then((me) => me.body.account?.id as string)

export const C = '500000003'
/** the one scenario the harness's ruleset scores. */
export const SCENARIO = 'ruleset:1108:t1:21020086'

/** registers the setup hooks; call once at the top of a test file. */
export function setUpAccountHarness(): void {
  beforeAll(async () => {
    issuer = await accessIssuer(TEAM, AUD)
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json(issuer.certs)
      if (String(input) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return Response.json({ success: true })
      // the discord image cdn returns the same png for every avatar and banner
      if (String(input).startsWith('https://cdn.discordapp.com/')) return new Response(PNG, { headers: { 'content-type': 'image/png' } })
      return realFetch(input as RequestInfo, init)
    })
  })

  afterAll(() => { vi.unstubAllGlobals() })

  beforeEach(async () => {
    seeded.clear()
    env = {
      LB: memoryD1(), CARDS: memoryR2(), LB_DATA: memoryR2(), READ_QUEUE: memoryQueue<ReadMessage>(), SCORE_QUEUE: memoryQueue<ScoreMessage>(),
      BROWSER: {} as never, SUBMIT_LIMIT: allowAll, REPORT_LIMIT: allowAll,
      APP_ORIGIN: APP, KURO_CARD_HOST: 'kuro.example.test', KURO_CARD_PATH_PREFIX: '/back/', CARD_MAX_BYTES: '4194304',
      FRESH_CARD_MAX_AGE_S: '900', SESSION_TTL_S: '2592000', ACCOUNT_SESSION_TTL_S: '15552000', READER_URL: 'https://app.example.test/reader',
      READ_MODE: 'beta', REFUSED_IMAGE_KEEP_DAYS: '30', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, GROUP_WAIT_MS: '0',
      LINK_HASH_KEY: 'link-key', SESSION_KEY: 'session-key', TURNSTILE_SECRET: 'secret', DEV_ADMIN_TOKEN: DEV_TOKEN,
      BOARDS: memoryNamespace(BoardDO, () => env), CARD_REGISTRY: memoryNamespace(CardRegistryDO, () => env),
    } as typeof env
    env.LB.sqlite.exec(`
      INSERT INTO rulesets (id, no, game_ver, engine_ver, rotation_ver, manifest_key, manifest_sha256, status, created_at)
        VALUES ('ruleset', 1, 'test', 'test', 'test', 'manifest', 'hash', 'live', 1);
      INSERT INTO scenarios (id, rs, ruleset_id, resonator_id, cell, team_id, recipe_sha256, team_key, weapon_id, weapon_rank, weapon_role,
        team_rank, members)
        VALUES ('${SCENARIO}', 1, 'ruleset', '1108', 0, 't1', 'hash', '1108-1109-1110', '21020086', 1, 'signature', 1, '["1108","1109","1110"]');
      INSERT INTO settings (key, value, updated_at) VALUES ('live_ruleset', 'ruleset', 1);
    `)
  })
}
