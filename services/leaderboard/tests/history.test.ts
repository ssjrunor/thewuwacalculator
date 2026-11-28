/*
  Author: Runor Ewhro
  description: every build ranked as itself, scoring news, privacy, mutes, trust caps,
               appeals, bookmarks, per-resonator cards, card presets, saved board
               views and the document review queue, through the real routes and
               sql on seeded players.
*/

import { describe, expect, it } from 'vitest'
import { A, B, PNG, accountOf, boardIds, buildOf, call, claimSession, placeScored, scoreQueued, seedPlayer, signIn, setUpAccountHarness } from './accountHarness.ts'

setUpAccountHarness()

let serial = 0

// a signed-in account with `uid` linked to it
const member = async (person: string, uid: string) => (await signIn(person, await claimSession(uid))).cookie!

// a newer card of the uid's 1108, with another weapon, placed by its owner and scored (ranked as itself)
const newBuild = (uid: string, score: number, weapon = '21020016') => {
  const n = ++serial
  return placeScored(uid, score, { seq: 1, weapon, owner: true, at: 10 + n, drawnAt: 10 + n })
}

const inbox = (cookie: string) => call('GET', '/notifications', { cookie }).then((r) => r.body.notifications as Array<Record<string, unknown>>)
const sanction = (body: Record<string, unknown>) => call('POST', '/admin/sanctions', { admin: true, body })

describe('every build ranked', () => {
  it('ranks every build as itself, and lists them all on the profile', async () => {
    const old = await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    // a newer card scoring lower is ranked as itself, under the older one
    const lower = await newBuild(A, 100)
    expect(await boardIds()).toEqual([old, buildOf(B), lower])
    const ids = (body: { builds: Array<{ buildId: string }> }) => body.builds.map((build) => build.buildId).sort()
    expect(ids((await call('GET', `/players/${A}`)).body)).toEqual([old, lower].sort())
    expect((await call('GET', `/builds/${lower}`)).body).toMatchObject({ scoringStatus: 'scored' })

    const next = await newBuild(A, 130)
    expect(await boardIds()).toEqual([next, old, buildOf(B), lower])
    expect(ids((await call('GET', `/players/${A}`)).body)).toEqual([next, old, lower].sort())
  })

  it('takes a hidden or deleted build off the board, and leaves the player\'s others ranked', async () => {
    const old = await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    const lower = await newBuild(A, 100)
    const cookie = await claimSession(A)

    expect((await call('PATCH', `/builds/${old}`, { cookie, body: { hidden: true } })).status).toBe(200)
    expect(await boardIds()).toEqual([buildOf(B), lower])
    await call('PATCH', `/builds/${old}`, { cookie, body: { hidden: false } })
    expect(await boardIds()).toEqual([old, buildOf(B), lower])

    expect((await call('POST', `/admin/builds/${old}/hide`, { admin: true, body: {} })).status).toBe(200)
    expect(await boardIds()).toEqual([buildOf(B), lower])
    await call('POST', `/admin/builds/${old}/restore`, { admin: true, body: {} })
    // hiding dropped its scores: it is ranked again once it has scored again
    expect(await boardIds()).toEqual([buildOf(B), lower])
    expect(await scoreQueued(120)).toBe(1)
    expect(await boardIds()).toEqual([old, buildOf(B), lower])

    expect((await call('DELETE', `/builds/${old}`, { cookie })).status).toBe(200)
    expect(await boardIds()).toEqual([buildOf(B), lower])
  })

  it('notifies the owner that a build scored, and the dethroned #1 that they lost it', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    const ana = await member('ana', A)
    const ben = await member('ben', B)
    const next = await newBuild(B, 130)
    expect(await inbox(ana)).toMatchObject([{ kind: 'dethroned', buildId: buildOf(A), data: { resonatorId: '1108', score: 130, previousScore: 120 } }])
    expect(await inbox(ben)).toMatchObject([{ kind: 'scored', buildId: next, data: { resonatorId: '1108', score: 130, rank: 1, total: 3 } }])
    // beating the player's own #1 dethrones no one
    await newBuild(B, 140)
    expect(await inbox(ana)).toHaveLength(1)
  })

  it('hides the follower count when the player chooses', async () => {
    await seedPlayer(A, 'Alpha', 120)
    const cookie = (await signIn('plain-ana', await claimSession(A))).cookie!
    await call('PUT', '/players/me/documents/profile', { cookie, body: { privacy: { followers: false } } })
    expect((await call('GET', `/players/${A}/social`)).body.followers).toBeNull()
    expect((await call('GET', `/players/${A}/social`, { cookie })).body.followers).toBe(0)
  })
})

describe('writers', () => {
  it('mutes a writer (documents, uploads) until lifted', async () => {
    await seedPlayer(A, 'Alpha', 120)
    const ana = await member('ana', A)
    const id = await accountOf(ana)
    expect((await sanction({ subjectKind: 'account', subjectId: id, kind: 'warn', reason: 'x', days: 2 })).status).toBe(400)
    const mute = (await sanction({ subjectKind: 'account', subjectId: id, kind: 'mute', reason: 'spam' })).body
    expect(mute).toMatchObject({ kind: 'mute', expiresAt: null })
    expect((await call('PUT', '/players/me/documents/profile', { cookie: ana, body: { bio: 'x' } })).body.error.code).toBe('muted')
    expect((await call('POST', '/media?purpose=avatar', { cookie: ana, raw: PNG })).body.error.code).toBe('muted')
    // a mute stops writing and allows acting
    expect((await call('GET', '/feed', { cookie: ana })).status).toBe(200)
    await call('POST', `/admin/sanctions/${mute.id}/lift`, { admin: true, body: {} })
    expect((await call('PUT', '/players/me/documents/profile', { cookie: ana, body: { bio: 'x' } })).status).toBe(200)
  })

  it('lets a suspended account appeal, and lifts the sanction when the appeal is granted', async () => {
    const ana = (await signIn('ana')).cookie!
    const id = await accountOf(ana)
    const held = (await sanction({ subjectKind: 'account', subjectId: id, kind: 'suspend', reason: 'spam', days: 7 })).body
    expect((await call('GET', '/me', { cookie: ana })).body.account.suspension).toMatchObject({ sanctionId: held.id, kind: 'suspend' })
    const filed = await call('POST', `/sanctions/${held.id}/appeal`, { cookie: ana, body: { body: 'it was not spam' } })
    expect(filed.body).toMatchObject({ status: 'open', body: 'it was not spam' })
    expect((await call('POST', `/sanctions/${held.id}/appeal`, { cookie: ana, body: { body: 'again' } })).body.error.code).toBe('duplicate')
    const queue = (await call('GET', '/admin/appeals', { admin: true })).body.appeals
    expect(queue).toMatchObject([{ id: filed.body.id, accountId: id, sanction: { id: held.id } }])
    expect((await call('POST', `/admin/appeals/${filed.body.id}`, { admin: true, body: { status: 'granted', response: 'sorry' } })).body)
      .toMatchObject({ status: 'granted', response: 'sorry' })
    const me = (await call('GET', '/me', { cookie: ana })).body
    expect(me.account.suspension).toBeNull()
    expect((await inbox(ana)).map((n) => n.kind)).toEqual(['appeal', 'sanction'])
    expect((await inbox(ana))[0]).toMatchObject({ data: { status: 'granted', response: 'sorry' } })
    expect((await call('POST', `/sanctions/${held.id}/appeal`, { cookie: ana, body: { body: 'x' } })).status).toBe(400)
  })
})

describe('saves and styles', () => {
  it('bookmarks a build, and the bookmark remains after the player uploads a newer build', async () => {
    const old = await seedPlayer(A, 'Alpha', 120)
    const ben = (await signIn('ben')).cookie!
    expect((await call('PUT', `/builds/${old}/bookmark`, { cookie: ben })).body).toEqual({ bookmarked: true })
    expect((await call('GET', `/builds/${old}/social`, { cookie: ben })).body.bookmarked).toBe(true)
    await newBuild(A, 130)
    expect((await call('GET', '/bookmarks', { cookie: ben })).body.builds).toMatchObject([{ buildId: old, player: { uid: A, name: 'Alpha' } }])
    await call('DELETE', `/builds/${old}/bookmark`, { cookie: ben })
    expect((await call('GET', '/bookmarks', { cookie: ben })).body.builds).toEqual([])
  })

  it('stores one card per resonator and applies it to each new build of it', async () => {
    await seedPlayer(A, 'Alpha', 120)
    // the card looks are the account's: a claim session has none to write
    const claim = await claimSession(A)
    expect((await call('PUT', '/players/me/cards/1108', { cookie: claim, body: { style: {}, hidden: {} } })).status).toBe(401)
    const cookie = (await signIn('plain-ana', claim)).cookie!
    expect((await call('PUT', '/players/me/cards/1209', { cookie, body: { style: {}, hidden: {} } })).status).toBe(404)
    expect((await call('PUT', '/players/me/cards/1108', { cookie, body: { style: { accent: '#ff0000' }, hidden: { score: true } } })).status).toBe(200)
    const next = await newBuild(A, 130)
    expect((await call('GET', `/builds/${next}`)).body.card).toMatchObject({ style: { accent: '#ff0000' }, hidden: { score: true } })
  })

  it('stores card presets, shares them by id, and saves board views on the account', async () => {
    const ana = (await signIn('ana')).cookie!
    const ben = (await signIn('ben')).cookie!
    expect((await call('POST', '/presets', { cookie: ana, body: { name: 'x', style: { customCss: 'a{}' } } })).status).toBe(400)
    const made = (await call('POST', '/presets', { cookie: ana, body: { name: ' Red ', style: { accent: '#f00' } } })).body
    expect(made).toMatchObject({ name: 'Red', shared: false, own: true, style: { accent: '#f00' } })
    expect((await call('GET', `/presets/${made.id}`, { cookie: ben })).status).toBe(404)
    await call('PATCH', `/presets/${made.id}`, { cookie: ana, body: { shared: true } })
    expect((await call('GET', `/presets/${made.id}`, { cookie: ben })).body).toMatchObject({ name: 'Red', own: false, shared: true })
    expect((await call('GET', '/presets', { cookie: ana })).body.presets).toHaveLength(1)
    expect((await call('DELETE', `/presets/${made.id}`, { cookie: ben })).status).toBe(404)
    expect((await call('DELETE', `/presets/${made.id}`, { cookie: ana })).body).toEqual({ ok: true })

    const views = { views: [{ name: 'S0 crit', resonatorId: '1108', sequence: 0 }] }
    expect((await call('GET', '/account/documents/views', { cookie: ana })).body).toBeNull()
    expect((await call('PUT', '/account/documents/views', { cookie: ana, body: views })).body.body).toEqual(views)
    expect((await call('GET', '/account/documents/views', { cookie: ana })).body.body).toEqual(views)
    expect((await call('PUT', '/account/documents/views', { body: views })).status).toBe(401)
  })
})

describe('document review', () => {
  it('queues written text until a moderator has reviewed that version', async () => {
    await seedPlayer(A, 'Alpha', 120)
    const cookie = (await signIn('plain-ana', await claimSession(A))).cookie!
    const owner = await accountOf(cookie)
    await call('PUT', '/players/me/documents/profile', { cookie, body: { bio: 'hello' } })
    const queue = (await call('GET', '/admin/documents', { admin: true })).body.documents
    expect(queue).toMatchObject([{ kind: 'profile', ownerId: owner, reviewedAt: null }])
    expect((await call('POST', `/admin/documents/profile/${owner}/reviewed`, { admin: true, body: { updatedAt: queue[0].updatedAt - 1 } })).body.error.code)
      .toBe('duplicate')
    expect((await call('POST', `/admin/documents/profile/${owner}/reviewed`, { admin: true, body: { updatedAt: queue[0].updatedAt } })).body)
      .toEqual({ ok: true })
    expect((await call('GET', '/admin/documents', { admin: true })).body.documents).toEqual([])
    expect((await call('GET', '/admin/documents?status=reviewed', { admin: true })).body.documents).toHaveLength(1)
    await call('PUT', '/players/me/documents/profile', { cookie, body: { bio: 'changed' } })
    expect((await call('GET', '/admin/documents', { admin: true })).body.documents).toHaveLength(1)
  })
})
