/*
  Author: Runor Ewhro
  description: anonymous players (rows show only the region, the profile opens
               only for them) and setup uids (filler builds: anonymous, out of
               the uploads, no likes or comments, and taken by the first player
               to send one), through the real routes and sql.
*/

import { describe, expect, it } from 'vitest'
import { boardOf } from '../src/api/stubs.ts'
import { identifyCard } from '../src/api/cards/collect.ts'
import { playerFacts, syncPlayerBoards } from '../src/api/players.ts'
import { A, B, boardDb, call, claimSession, env, seedPlayer, settle, signIn, setUpAccountHarness, buildOf, seededCard } from './accountHarness.ts'

setUpAccountHarness()

type Row = { buildId: string; uid: string | null; name: string | null; region: string | null; anonymous?: boolean }
const rows = async (query = '') => (await call('GET', `/boards/1108${query}`)).body.rows as Row[]
const rowOf = async (buildId: string, query = '') => (await rows(query)).find((row) => row.buildId === buildId)
const uploads = async () => ((await call('GET', '/activity')).body.rows as Row[]).map((row) => row.buildId)
const player = (uid: string) => env.LB.sqlite.prepare('SELECT * FROM players WHERE uid = ?').get(uid) as { setup_at: number | null; anonymous: number }
/** marks a uid as setup, as the local tool does: the player moves on (ver) and its boards hear of it. */
const setup = async (uid: string) => {
  env.LB.sqlite.prepare('UPDATE players SET setup_at = 5, ver = ver + 1 WHERE uid = ?').run(uid)
  await syncPlayerBoards(env, uid)
  await settle()
}

const LINK = `https://kuro.example.test/back/d6/${'d6'.padEnd(40, '0')}.jpeg`
/** LINK's link hash, which makes a card seeded with it the card LINK resends. */
async function linkHash(): Promise<string> {
  const identified = await identifyCard(LINK, { linkHashKey: env.LINK_HASH_KEY, rules: { host: env.KURO_CARD_HOST, pathPrefix: env.KURO_CARD_PATH_PREFIX } })
  if (!identified.ok) throw new Error(identified.message)
  return identified.linkHash
}
const send = (options: { admin?: boolean; cookie?: string } = {}) => call('POST', '/cards', { ...options, body: { input: LINK, turnstileToken: 't' } })

describe('anonymous players', () => {
  it('shows only the region on rows, and keeps the profile to its owner', async () => {
    const mine = await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    const cookie = await claimSession(A)
    const me = await call('PATCH', `/players/me/uids/${A}`, { cookie, body: { anonymous: true } })
    expect(me.body.uids).toMatchObject([{ uid: A, anonymous: true, hideUid: false }])

    expect(await rowOf(mine)).toMatchObject({ uid: null, name: null, region: '5', anonymous: true })
    // the server still shows, so a server filter lists them
    expect(await rowOf(mine, '?region=5')).toBeDefined()
    expect((await rowOf(buildOf(B)))).toMatchObject({ uid: B, name: 'Beta' })

    expect((await call('GET', `/players/${A}`)).status).toBe(404)
    expect((await call('GET', `/builds/${mine}/player`)).status).toBe(404)
    expect((await call('GET', `/players/${mine}/history`)).status).toBe(404)
    expect((await call('GET', `/players/${A}`, { cookie })).body).toMatchObject({ uid: A, name: 'Alpha', anonymous: true })

    // the build still opens, with nothing that names them.
    const detail = (await call('GET', `/builds/${mine}`)).body
    expect(detail).toMatchObject({ uid: null, name: null, anonymous: true })
    expect(detail.snapshot).toMatchObject({ uid: '', name: null })
    expect((await call('GET', `/builds/${mine}`, { cookie })).body).toMatchObject({ uid: A, name: 'Alpha' })

    // no one follows them, by uid or through a build.
    const other = (await signIn('bea', await claimSession(B))).cookie!
    expect((await call('PUT', `/follows/players/${mine}`, { cookie: other })).status).toBe(404)
    expect((await call('PUT', `/follows/players/${A}`, { cookie: other })).status).toBe(404)

    // an earlier follow remains and returns nothing while they are anonymous
    await call('PATCH', `/players/me/uids/${A}`, { cookie, body: { anonymous: false } })
    expect((await call('PUT', `/follows/players/${A}`, { cookie: other })).body.players).toHaveLength(1)
    await call('PATCH', `/players/me/uids/${A}`, { cookie, body: { anonymous: true } })
    expect((await call('GET', '/follows', { cookie: other })).body.players).toEqual([])
    expect((await call('GET', '/feed', { cookie: other })).body.rows).toEqual([])
  })

  it('names a commenter by their account, never through an anonymous uid of theirs', async () => {
    const theirs = await seedPlayer(B, 'Beta', 110)
    await seedPlayer(A, 'Alpha', 120)
    const writer = (await signIn('ana', await claimSession(A))).cookie!
    await call('PATCH', `/players/me/uids/${A}`, { cookie: writer, body: { anonymous: true } })
    expect((await call('POST', `/builds/${theirs}/comments`, { cookie: writer, body: { body: 'nice' } })).status).toBe(201)
    const [comment] = (await call('GET', `/builds/${theirs}/comments`)).body.comments
    // the account's name with no uid or build link; the anonymous uid stays unnamed
    expect(comment.author).toEqual({ uid: null, buildId: null, name: 'Discord ana' })
  })

  it('refuses a patch with nothing to change', async () => {
    await seedPlayer(A, 'Alpha', 120)
    const cookie = await claimSession(A)
    expect((await call('PATCH', `/players/me/uids/${A}`, { cookie, body: {} })).status).toBe(400)
    expect((await call('PATCH', `/players/me/uids/${A}`, { cookie, body: { anonymous: 'yes' } })).status).toBe(400)
    // a uid the session does not have is not its to change.
    expect((await call('PATCH', `/players/me/uids/${B}`, { cookie, body: { anonymous: true } })).status).toBe(404)
  })
})

describe('setup uids', () => {
  it('show wherever builds show, as anonymous', async () => {
    const filler = await seedPlayer(A, 'Alpha', 120, { at: 50 })
    await seedPlayer(B, 'Beta', 110, { at: 40 })
    await setup(A)
    expect(await rowOf(filler)).toMatchObject({ uid: null, name: null, region: '5', anonymous: true })
    expect((await rows()).map((row) => row.buildId)).toEqual([filler, buildOf(B)])
    expect(await uploads()).toEqual([filler, buildOf(B)])
    expect((await call('GET', `/builds/${filler}/player`)).status).toBe(404)

    const viewer = (await signIn('bea', await claimSession(B))).cookie!
    expect((await call('PUT', `/builds/${filler}/like`, { cookie: viewer })).status).toBe(403)
    expect((await call('GET', `/builds/${filler}/social`, { cookie: viewer })).body.commentsOpen).toBe(false)
    expect((await call('POST', `/builds/${filler}/comments`, { cookie: viewer, body: { body: 'hi' } })).status).toBe(403)
  })

  it('takes a card sent again by a player as new, with the scores it has, and ends the setup', async () => {
    const filler = await seedPlayer(A, 'Alpha', 120, { at: 50, linkHash: await linkHash() })
    await setup(A)

    // staff sending it again is still a card the boards already have.
    const staff = await send({ admin: true })
    expect(staff).toMatchObject({ status: 200, body: { duplicate: true } })
    expect(player(A).setup_at).toBe(5)

    const sent = await send()
    expect(sent.status).toBe(202)
    expect(sent.body).toMatchObject({ duplicate: false, status: 'scored', buildId: filler, active: true })
    expect(player(A).setup_at).toBeNull()
    // nothing is read or scored again.
    expect((env.READ_QUEUE as unknown as { sent: unknown[] }).sent).toEqual([])
    expect((env.SCORE_QUEUE as unknown as { sent: unknown[] }).sent).toEqual([])
    // it is a fresh upload now, from a named player.
    expect((await call('GET', '/activity')).body.rows[0]).toMatchObject({ buildId: filler, uid: A, name: 'Alpha', at: expect.any(Number) })
    expect(await rowOf(filler)).toMatchObject({ uid: A, name: 'Alpha' })

    // later sends return the same card
    expect((await send()).body.duplicate).toBe(true)
  })

  it('takes a stored build as new when a player sends it on another card', async () => {
    const filler = await seedPlayer(A, 'Alpha', 120, { at: 50 })
    const { card, snapHash } = seededCard(A)
    const local = Number(boardDb().prepare('SELECT id FROM builds').get()!.id)
    const { placement } = await boardOf(env, 1108).place(1108, { uid: Number(A), player: (await playerFacts(env.LB, A))!, card,
      snap: boardDb().prepare('SELECT snap FROM builds WHERE id = ?').get(local)!.snap as Uint8Array, snapHash, seq: 0, drawnAt: 1,
      owner: false, claimSetup: true, now: 900 })
    expect(placement).toMatchObject({ local, active: true, repeated: false, claimed: true })
    expect(filler).toBe(buildOf(A))
    expect(boardDb().prepare('SELECT created_at FROM builds WHERE id = ?').get(local)).toEqual({ created_at: 900 })
  })

  it('are marked by the local tool only, never a uid a player took', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    await claimSession(B)
    expect((await call('POST', '/admin/players/setup', { admin: true, body: { since: 0 } })).status).toBe(403)

    const listed = await call('POST', '/admin/players/setup', { devAdmin: true, body: { since: 0 } })
    expect(listed.body).toMatchObject({ changed: 0, wouldChange: 1 })
    expect(listed.body.rows).toEqual(expect.arrayContaining([expect.objectContaining({ uid: B, skipped: 'a player took it' })]))
    expect(player(A).setup_at).toBeNull()

    expect((await call('POST', '/admin/players/setup', { devAdmin: true, body: { since: 0, apply: true } })).body.changed).toBe(1)
    expect(player(A).setup_at).not.toBeNull()
    expect(player(B).setup_at).toBeNull()
    expect((await call('POST', '/admin/players/setup', { devAdmin: true, body: { uids: [A], undo: true, apply: true } })).body.changed).toBe(1)
    expect(player(A).setup_at).toBeNull()
  })
})
