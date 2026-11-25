/*
  Author: Runor Ewhro
  description: follows (the app's pins on the account), the follow feed, likes,
               comments and replies, blocks, notifications and comment
               moderation, through the real routes and sql on seeded players.
*/

import { describe, expect, it } from 'vitest'
import { A, B, C, accountOf, call, claimSession, env, seedPlayer, signIn, setUpAccountHarness, buildOf } from './accountHarness.ts'

setUpAccountHarness()

/** a signed-in account with `uid` linked to it (claimed with a fresh card, then signed in). */
async function member(person: string, uid: string): Promise<string> {
  return (await signIn(person, await claimSession(uid))).cookie!
}

const comment = (cookie: string, buildId: string, body: string, parentId?: string) =>
  call('POST', `/builds/${buildId}/comments`, { cookie, body: { body, parentId } })
const threads = (buildId: string, cookie?: string) => call('GET', `/builds/${buildId}/comments`, { cookie }).then((r) => r.body.comments)
const inbox = (cookie: string) => call('GET', '/notifications', { cookie }).then((r) => r.body)
const unread = (cookie: string) => call('GET', '/me', { cookie }).then((r) => r.body.account.unread)

describe('follows', () => {
  it('follows players and boards, reaches a hidden player through a build, and imports local pins', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110, { hide: true })
    expect((await call('GET', '/follows')).status).toBe(401)
    const ana = (await signIn('ana')).cookie!
    expect((await call('PUT', `/follows/players/${A}`, { cookie: ana })).body.players)
      .toEqual([{ uid: A, buildId: buildOf(A), name: 'Alpha', faces: ['1108'] }])
    // a hidden uid is not followed by uid (that would confirm it), only through a build.
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

    // a player does not follow themselves; a ban takes a followed player out of the list until it is lifted.
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
    // what was there before the account counts as seen.
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

describe('likes', () => {
  it('takes one like per account, gathers them into one notice for the owner, and refuses the owner\'s own', async () => {
    await seedPlayer(A, 'Alpha', 120)
    const ana = await member('ana', A)
    const ben = (await signIn('ben')).cookie!
    const cat = (await signIn('cat')).cookie!
    expect((await call('PUT', `/builds/${buildOf(A)}/like`)).status).toBe(401)
    expect((await call('PUT', `/builds/${buildOf(A)}/like`, { cookie: ana })).body.error.code).toBe('bad_request')
    expect((await call('PUT', `/builds/${buildOf(A)}/like`, { cookie: ben })).body).toEqual({ likes: 1, liked: true })
    expect((await call('PUT', `/builds/${buildOf(A)}/like`, { cookie: ben })).body).toEqual({ likes: 1, liked: true })
    expect((await call('PUT', `/builds/${buildOf(A)}/like`, { cookie: cat })).body.likes).toBe(2)
    const box = await inbox(ana)
    expect(box.unread).toBe(1)
    expect(box.notifications).toMatchObject([{ kind: 'like', count: 2, buildId: buildOf(A), resonatorId: '1108', read: false, actor: null }])
    expect((await unread(ana)).notifications).toBe(1)
    expect((await call('POST', '/notifications/read', { cookie: ana, body: {} })).body).toEqual({ unread: 0 })
    expect((await call('DELETE', `/builds/${buildOf(A)}/like`, { cookie: cat })).body).toEqual({ likes: 1, liked: false })
    expect((await call('GET', `/builds/${buildOf(A)}/social`, { cookie: ben })).body)
      .toEqual({ likes: 1, liked: true, comments: 0, following: false, commentsOpen: true, bookmarked: false })
    // a deleted account takes its likes with it.
    await call('DELETE', '/account', { cookie: ben })
    expect((await call('GET', `/builds/${buildOf(A)}/social`)).body.likes).toBe(0)
  })
})

describe('comments', () => {
  it('threads comments written by accounts, tells the owner and the replied-to, and keeps a removed comment while replies hang off it', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    await seedPlayer(C, 'Gamma', 100)
    const ana = await member('ana', A)
    const ben = await member('ben', B)
    // writing needs an account, and no uid: a claim session alone cannot, an account with no uid yet can, by its name.
    expect((await comment(await claimSession(C), buildOf(A), 'hi')).body.error.code).toBe('unauthorized')
    const dan = await comment((await signIn('dan')).cookie!, buildOf(A), 'hi')
    expect(dan.status).toBe(201)
    expect(dan.body.author).toEqual({ uid: null, buildId: null, name: 'Discord dan' })
    expect((await call('DELETE', `/comments/${dan.body.id}`, { cookie: ana })).status).toBe(200)
    expect((await comment(ben, buildOf(A), '   ')).status).toBe(400)

    const first = await comment(ben, buildOf(A), '  nice\r\n\n\n\ncrit\u0007  ')
    expect(first.status).toBe(201)
    // named as the account's profile names it, and reached through its uid.
    expect(first.body).toMatchObject({ body: 'nice\n\ncrit', author: { uid: B, name: 'Discord ben', buildId: buildOf(B) }, own: true, parentId: null })
    const id = first.body.id as string
    expect((await inbox(ana)).notifications).toMatchObject([{ kind: 'comment', commentId: id, excerpt: 'nice\n\ncrit', actor: { uid: B } }])

    const reply = await comment(ana, buildOf(A), 'thanks', id)
    expect(reply.status).toBe(201)
    expect((await comment(ben, buildOf(A), 'deeper', reply.body.id)).body.error.code).toBe('bad_request')
    expect((await inbox(ben)).notifications).toMatchObject([{ kind: 'reply', commentId: reply.body.id, actor: { uid: A } }])
    // owners are not notified of their own replies
    expect((await inbox(ana)).notifications).toHaveLength(1)

    const open = await threads(buildOf(A))
    expect(open).toMatchObject([{ id, body: 'nice\n\ncrit', own: false, canRemove: false, replies: [{ body: 'thanks', parentId: id }] }])
    expect((await threads(buildOf(A), ana))[0]).toMatchObject({ canRemove: true, replies: [{ own: true, canRemove: true }] })

    expect((await call('PATCH', `/comments/${id}`, { cookie: ana, body: { body: 'edited' } })).status).toBe(404)
    expect((await call('PATCH', `/comments/${id}`, { cookie: ben, body: { body: 'nice crit' } })).body).toMatchObject({ body: 'nice crit' })
    expect((await threads(buildOf(A)))[0].editedAt).toBeTypeOf('number')

    expect((await call('DELETE', `/comments/${id}`, { cookie: ben })).status).toBe(200)
    expect(await threads(buildOf(A))).toMatchObject([{ id, removed: true, body: null, author: null, replies: [{ body: 'thanks' }] }])
    // the removed comment's notice goes with it.
    expect((await inbox(ana)).notifications).toEqual([])
    await call('DELETE', `/comments/${reply.body.id}`, { cookie: ana })
    expect(await threads(buildOf(A))).toEqual([])
    expect((await call('GET', `/builds/${buildOf(A)}/social`)).body.comments).toBe(0)
  })

  it('lets the owner close a build to comments and block a player, whose comments then hide from them', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    await seedPlayer(C, 'Gamma', 100)
    const ana = await member('ana', A)
    const ben = await member('ben', B)
    const cat = await member('cat', C)
    const said = (await comment(ben, buildOf(A), 'hi')).body.id as string
    const blocked = (await call('PUT', `/blocks/${B}`, { cookie: ana })).body.players
    expect(blocked).toMatchObject([{ id: expect.any(String), uid: B, name: 'Discord ben' }])
    expect(await threads(buildOf(A), ana)).toEqual([])
    expect(await threads(buildOf(A))).toHaveLength(1)
    expect((await inbox(ana)).notifications).toEqual([])
    expect((await comment(ben, buildOf(A), 'again')).body.error.code).toBe('forbidden')
    expect((await call('GET', `/players/${B}/social`, { cookie: ana })).body.blocked).toBe(true)

    expect((await call('PUT', `/builds/${buildOf(A)}/documents/build`, { cookie: ana, body: { commentsOpen: false } })).status).toBe(200)
    expect((await call('GET', `/builds/${buildOf(A)}/social`)).body.commentsOpen).toBe(false)
    expect((await comment(cat, buildOf(A), 'hello')).body.error.code).toBe('forbidden')
    expect((await comment(ana, buildOf(A), 'mine')).status).toBe(201)

    expect((await call('DELETE', `/blocks/${blocked[0].id}`, { cookie: ana })).body.players).toEqual([])
    // the owner removes a comment on their build; its words stay in the history for staff.
    expect((await call('DELETE', `/comments/${said}`, { cookie: ana })).status).toBe(200)
    const history = await call('GET', `/admin/history/comment/${said}`, { admin: true })
    expect(history.body.events).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'comment.remove', data: { by: 'owner', body: 'hi' } })]))
  })
  it('blocks the person, not a uid: through a comment when they show no uid, across all their uids, never a uid on no account', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    await seedPlayer(C, 'Gamma', 100)
    const ana = await member('ana', A)
    const dan = (await signIn('dan')).cookie!
    // dan has no uid: only the comment names them.
    const said = (await comment(dan, buildOf(A), 'hey')).body.id as string
    const list = (await call('PUT', `/blocks/${said}`, { cookie: ana })).body.players
    expect(list).toEqual([{ id: expect.any(String), uid: null, buildId: null, name: 'Discord dan', at: expect.any(Number) }])
    expect(await threads(buildOf(A), ana)).toEqual([])
    expect((await comment(dan, buildOf(A), 'again')).body.error.code).toBe('forbidden')
    // a uid dan proves later is also blocked
    await signIn('dan', await claimSession(B))
    expect((await call('GET', `/players/${B}/social`, { cookie: ana })).body.blocked).toBe(true)
    expect((await call('DELETE', `/blocks/${B}`, { cookie: ana })).body.players).toEqual([])
    expect((await call('GET', `/players/${B}/social`, { cookie: ana })).body.blocked).toBe(false)

    // a uid on no account cannot comment: there is nothing to block; nor is anyone themselves.
    expect((await call('PUT', `/blocks/${C}`, { cookie: ana })).body.error.code).toBe('bad_request')
    expect((await call('PUT', `/blocks/${A}`, { cookie: ana })).body.error.code).toBe('bad_request')
    expect((await call('PUT', '/blocks/nobody', { cookie: ana })).status).toBe(404)
  })
})

describe('comment moderation', () => {
  it('takes a reported comment down through the queue, tells its author, and hides a banned account\'s comments', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    await seedPlayer(C, 'Gamma', 100)
    const ana = await member('ana', A)
    const ben = await member('ben', B)
    const cat = await member('cat', C)
    const rude = (await comment(ben, buildOf(A), 'rude')).body.id as string
    const report = await call('POST', '/reports', { cookie: ana, body: { commentId: rude, reason: 'abuse', turnstileToken: 'ok' } })
    expect(report.status).toBe(201)
    expect((await call('GET', '/admin/reports', { admin: true })).body.reports).toMatchObject([{ commentId: rude, buildId: buildOf(A) }])
    expect((await call('GET', `/admin/reports/${report.body.reportId}`, { admin: true })).body.comment)
      .toMatchObject({ id: rude, body: 'rude', accountId: await accountOf(ben) })
    expect((await call('POST', `/admin/reports/${report.body.reportId}`, { admin: true, body: { status: 'resolved', removeComment: true } })).status)
      .toBe(200)
    expect(await threads(buildOf(A))).toEqual([])
    expect((await inbox(ben)).notifications).toMatchObject([{ kind: 'comment_removed', commentId: rude, buildId: buildOf(A) }])

    await comment(cat, buildOf(A), 'fine')
    const catId = await accountOf(cat)
    await call('POST', '/admin/sanctions', { admin: true, body: { subjectKind: 'account', subjectId: catId, kind: 'ban', reason: 'spam' } })
    expect(await threads(buildOf(A))).toEqual([])
    const told = env.LB.sqlite.prepare(`SELECT data FROM notifications WHERE account_id = ? AND kind = 'sanction'`).get(catId) as { data: string }
    expect(JSON.parse(told.data)).toMatchObject({ kind: 'ban', reason: 'spam', uid: null })
    // a moderator account removes any comment without a report.
    const mod = (await signIn('mod')).cookie!
    const modId = (await call('GET', '/me', { cookie: mod })).body.account.id
    await call('POST', `/admin/accounts/${modId}/role`, { admin: true, body: { role: 'moderator' } })
    const again = (await comment(ben, buildOf(A), 'again')).body.id as string
    expect((await call('DELETE', `/comments/${again}`, { cookie: cat })).status).toBe(404)
    expect((await call('DELETE', `/comments/${again}`, { cookie: mod })).status).toBe(200)

    // a deleted account's comments are removed with it.
    const kept = (await comment(ben, buildOf(A), 'last')).body.id as string
    await comment(ana, buildOf(A), 'reply', kept)
    await call('DELETE', '/account', { cookie: ben })
    expect(await threads(buildOf(A))).toMatchObject([{ id: kept, removed: true, replies: [{ body: 'reply' }] }])
  })
})
