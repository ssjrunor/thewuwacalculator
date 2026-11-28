/*
  Author: Runor Ewhro
  description: follows (the app's pins on the account), the follow feed, and
               blocks, through the real routes and sql on seeded players.
*/

import { describe, expect, it } from 'vitest'
import { A, B, C, call, claimSession, env, seedPlayer, signIn, setUpAccountHarness, buildOf } from './accountHarness.ts'

setUpAccountHarness()

// a signed-in account with `uid` linked to it (claimed with a fresh card, then signed in)
async function member(person: string, uid: string): Promise<string> {
  return (await signIn(person, await claimSession(uid))).cookie!
}

const unread = (cookie: string) => call('GET', '/me', { cookie }).then((r) => r.body.account.unread)

describe('follows', () => {
  it('follows players and boards, reaches a hidden player through a build, and imports local pins', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110, { hide: true })
    expect((await call('GET', '/follows')).status).toBe(401)
    const ana = (await signIn('ana')).cookie!
    expect((await call('PUT', `/follows/players/${A}`, { cookie: ana })).body.players)
      .toEqual([{ uid: A, buildId: buildOf(A), name: 'Alpha', faces: ['1108'] }])
    // a hidden uid is not followed by uid (that would confirm it), only through a build
    expect((await call('PUT', `/follows/players/${B}`, { cookie: ana })).status).toBe(404)
    const both = await call('PUT', `/follows/players/${buildOf(B)}`, { cookie: ana })
    expect(both.body.players[1]).toEqual({ uid: null, buildId: buildOf(B), name: 'Beta', faces: ['1108'] })
    expect((await call('PUT', '/follows/boards/1108', { cookie: ana })).body.boards).toEqual(['1108'])
    expect((await call('PUT', '/follows/boards/nope', { cookie: ana })).status).toBe(404)

    const merged = await call('POST', '/follows/import', { cookie: ana, body: { boards: ['1108', '1209', 'x'],
      players: [{ uid: A, buildId: buildOf(A) }, { uid: null, buildId: 'gone' }, { uid: '500000009', buildId: 'gone' }] } })
    expect(merged.body.boards).toEqual(['1108', '1209'])
    expect(merged.body.players).toHaveLength(2)
    expect((await call('DELETE', `/follows/players/${buildOf(B)}`, { cookie: ana })).body.players.map((p: { name: string }) => p.name)).toEqual(['Alpha'])

    // a player does not follow themselves; a ban removes a followed player from the list until it is lifted
    expect((await call('PUT', `/follows/players/${A}`, { cookie: await member('alpha', A) })).body.error.code).toBe('bad_request')
    const ban = await call('POST', '/admin/sanctions', { admin: true, body: { subjectKind: 'uid', subjectId: A, kind: 'ban', reason: 'x' } })
    expect((await call('GET', '/follows', { cookie: ana })).body.players).toEqual([])
    await call('POST', `/admin/sanctions/${ban.body.id}/lift`, { admin: true })
    expect((await call('GET', '/follows', { cookie: ana })).body.players).toHaveLength(1)
    expect((await call('GET', `/players/${A}/social`, { cookie: ana })).body).toEqual({ followers: 1, following: true, blocked: false })
  })

  it('counts uploads from what the account follows until the feed is read', async () => {
    await seedPlayer(A, 'Alpha', 120)
    const ana = (await signIn('ana')).cookie!
    const { created_at: made } = env.LB.sqlite.prepare('SELECT created_at FROM accounts').get() as { created_at: number }
    await call('PUT', `/follows/players/${A}`, { cookie: ana })
    // uploads from before the account count as seen
    expect((await unread(ana)).feed).toBe(0)
    await seedPlayer(C, 'Gamma', 100, { at: made + 1 })
    expect((await unread(ana)).feed).toBe(0)
    await call('PUT', '/follows/boards/1108', { cookie: ana })
    expect((await unread(ana)).feed).toBe(1)
    const feed = (await call('GET', '/feed', { cookie: ana })).body
    expect(feed.rows.map((row: { buildId: string }) => row.buildId)).toEqual([buildOf(C), buildOf(A)])
    expect(feed).toMatchObject({ fresh: 1, seenAt: null })
    await call('POST', '/feed/seen', { cookie: ana })
    expect((await unread(ana)).feed).toBe(0)
  })
})

describe('blocks', () => {
  it('blocks a person across all their uids, lifts by id or uid, and rejects a uid on no account', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    await seedPlayer(C, 'Gamma', 100)
    const ana = await member('ana', A)
    await member('dan', C)
    const blocked = (await call('PUT', `/blocks/${C}`, { cookie: ana })).body.players
    expect(blocked).toMatchObject([{ id: expect.any(String), uid: C, name: 'Discord dan' }])
    expect((await call('GET', '/blocks', { cookie: ana })).body.players).toHaveLength(1)
    expect((await call('GET', `/players/${C}/social`, { cookie: ana })).body.blocked).toBe(true)

    // a uid on no account has nothing to block; once dan proves it, it is blocked with them
    expect((await call('PUT', `/blocks/${B}`, { cookie: ana })).body.error.code).toBe('bad_request')
    await signIn('dan', await claimSession(B))
    expect((await call('GET', `/players/${B}/social`, { cookie: ana })).body.blocked).toBe(true)
    // lifting by any of their uids lifts the person; so does the block's id
    expect((await call('DELETE', `/blocks/${B}`, { cookie: ana })).body.players).toEqual([])
    expect((await call('GET', `/players/${C}/social`, { cookie: ana })).body.blocked).toBe(false)
    const again = (await call('PUT', `/blocks/${C}`, { cookie: ana })).body.players
    expect((await call('DELETE', `/blocks/${again[0].id}`, { cookie: ana })).body.players).toEqual([])

    // nobody blocks themselves, and an unknown ref is not found
    expect((await call('PUT', `/blocks/${A}`, { cookie: ana })).body.error.code).toBe('bad_request')
    expect((await call('PUT', '/blocks/nobody', { cookie: ana })).status).toBe(404)
  })
})
