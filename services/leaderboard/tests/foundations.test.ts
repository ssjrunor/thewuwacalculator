/*
  Author: Runor Ewhro
  description: accounts (durable sign-in, uid links), staff roles, sanctions,
               moderation tools, settings documents and media, through the real
               routes and sql; no ruleset is built, and builds and scores are
               seeded as rows, so these run in seconds.
*/

import { describe, expect, it } from 'vitest'
import { A, accountOf, APP, B, boardIds, call, claimSession, cookieOf, env, PNG, pngOf, seedPlayer, signIn, setUpAccountHarness, buildOf } from './accountHarness.ts'

setUpAccountHarness()

describe('accounts', () => {
  it('renames a player only from a card drawn no earlier than the one their name came from', async () => {
    const { upsertPlayerStatement } = await import('../src/db/identity.ts')
    const seen = async (name: string | null, nameAt: number) => {
      await upsertPlayerStatement(env.LB, { uid: B, name, nameAt }, Date.now()).run()
      return env.LB.sqlite.prepare('SELECT last_name, name_at, ver FROM players WHERE uid = ?').get(B) as { last_name: string; name_at: number; ver: number }
    }
    expect(await seen('Later', 200)).toMatchObject({ last_name: 'Later', name_at: 200 })
    const { ver } = await seen('Older', 100)
    expect(await seen('Older', 100)).toMatchObject({ last_name: 'Later', name_at: 200, ver })
    // a card with no readable name changes nothing; a newer card (or the same card read again) renames the player
    expect(await seen(null, 300)).toMatchObject({ last_name: 'Later', name_at: 200, ver })
    expect(await seen('Newer', 200)).toMatchObject({ last_name: 'Newer', name_at: 200, ver: ver + 1 })
    // an undated stored name is replaced by the next card with a name
    env.LB.sqlite.prepare('UPDATE players SET name_at = NULL WHERE uid = ?').run(B)
    expect(await seen('Any', 50)).toMatchObject({ last_name: 'Any', name_at: 50 })
  })

  it('offers the configured providers and signs a new person in with a long session', async () => {
    expect((await call('GET', '/auth/providers')).body).toEqual({ providers: ['discord'] })
    expect((await call('GET', '/auth/oauth/google/start')).status).toBe(404)
    const { cookie, landed } = await signIn('ana')
    expect(landed).toBe(`${APP}/leaderboard/me?signin=ok`)
    const me = await call('GET', '/me', { cookie: cookie! })
    expect(me.body).toMatchObject({ uids: [], account: { role: 'user', logins: [{ provider: 'discord' }] } })
    // an account session lasts the account lifetime
    expect(me.body.expiresAt).toBeGreaterThan(Date.now() + 100 * 86_400_000)
    // the same person signing in again reaches the same account
    expect(await accountOf((await signIn('ana')).cookie!)).toBe(me.body.account.id)
  })

  it('links the uids of a claim session, and they follow the account to a new device', async () => {
    await seedPlayer(A, 'Alpha', 120)
    const card = await claimSession(A)
    const { cookie } = await signIn('ana', card)
    expect(cookie).toBe(card)
    const uid = { uid: A, name: 'Alpha', linked: true, hideUid: false, anonymous: false, optedOut: false }
    expect((await call('GET', '/me', { cookie: card })).body.uids).toEqual([uid])
    // the account has the uid, and the session has no holds
    expect(env.LB.sqlite.prepare('SELECT COUNT(*) AS n FROM uid_holds').get()).toEqual({ n: 0 })

    // a new device: the account alone acts for the linked uid
    const device = (await signIn('ana')).cookie!
    expect(device).not.toBe(card)
    expect((await call('GET', '/me', { cookie: device })).body.uids).toEqual([uid])
    expect((await call('PATCH', `/builds/${buildOf(A)}`, { cookie: device, body: { hidden: true } })).status).toBe(200)
  })

  it('moves a uid to whoever proves it next with a fresh card', async () => {
    await seedPlayer(A, 'Alpha', 120)
    const card = await claimSession(A)
    const account = (await signIn('ana', card)).cookie!
    // signing out of the session leaves the account's link
    await call('POST', '/auth/logout', { cookie: card })
    const device = (await signIn('ana')).cookie!
    expect((await call('GET', '/me', { cookie: device })).body.uids.map((row: { uid: string }) => row.uid)).toEqual([A])

    // another account's fresh proof moves the uid to that account
    const { claimUid } = await import('../src/api/auth/claims.ts')
    const context = { env, now: Date.now() } as never
    const bea = (await signIn('bea')).cookie!
    const beaSession = { tokenHash: '', accountId: await accountOf(bea), expiresAt: Date.now() + 1000 }
    await claimUid(context, beaSession, { uid: A, cardId: 'card', name: null, drawnAt: 1 })
    expect((await call('GET', '/me', { cookie: device })).body.uids).toEqual([])
    expect((await call('GET', '/me', { cookie: bea })).body.uids.map((row: { uid: string }) => row.uid)).toEqual([A])
    // the account it left is notified
    const told = (cookie: string) => call('GET', '/notifications', { cookie }).then((r) => r.body.notifications)
    expect(await told(device)).toMatchObject([{ kind: 'uid_moved', data: { uid: A } }])
    // a fresh proof by someone without an account moves the uid out of the account into their claim session
    const taken = await claimUid(context, null, { uid: A, cardId: 'card', name: null, drawnAt: 1 })
    expect(taken.token).toBeTruthy()
    expect((await call('GET', '/me', { cookie: bea })).body.uids).toEqual([])
    expect(await told(bea)).toMatchObject([{ kind: 'uid_moved', data: { uid: A } }])
    expect((await call('GET', '/me', { cookie: `lb_session=${taken.token}` })).body.uids).toMatchObject([{ uid: A, linked: false }])
    expect(account).toBeTruthy()
  })

  it('joins only the session that started a sign-in, and uses a state once', async () => {
    await claimSession(A)
    const start = await call('GET', '/auth/oauth/discord/start')
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const stranger = await claimSession(B)
    // finished in a session that did not start it: a new account session, and the other session's uid is not linked
    const back = await call('GET', `/auth/oauth/discord/callback?code=ana&state=${state}`, { cookie: stranger })
    expect(cookieOf(back.headers)).not.toBe(stranger)
    expect((await call('GET', '/me', { cookie: stranger })).body.account).toBeNull()
    const again = await call('GET', `/auth/oauth/discord/callback?code=ana&state=${state}`)
    expect(again.headers.get('location')).toBe(`${APP}/leaderboard?signin=failed`)
    const refused = await call('GET', `/auth/oauth/discord/callback?code=bad&state=${new URL((await call('GET',
      '/auth/oauth/discord/start')).headers.get('location')!).searchParams.get('state')}`)
    expect(refused.headers.get('location')).toBe(`${APP}/leaderboard?signin=failed`)
  })

  it('refuses to unlink the last sign-in method, unlinks a uid, and deletes the account with its sessions and media', async () => {
    await seedPlayer(A, 'Alpha', 120)
    const card = await claimSession(A)
    const cookie = (await signIn('ana', card)).cookie!
    expect((await call('DELETE', '/account/logins/discord', { cookie })).body.error.code).toBe('bad_request')
    expect((await call('POST', '/media?purpose=avatar', { cookie, raw: PNG })).status).toBe(201)
    expect((await call('DELETE', `/account/uids/${A}`, { cookie })).body.uids).toEqual([])
    expect((await call('DELETE', '/account', { cookie })).status).toBe(200)
    expect((await call('GET', '/me', { cookie })).status).toBe(401)
    expect([...env.CARDS.objects.keys()].filter((key) => key.startsWith('media/'))).toEqual([])
  })
})

describe('staff', () => {
  it('grants permissions by role, with cloudflare access as admin', async () => {
    const cookie = (await signIn('mod')).cookie!
    expect((await call('GET', '/admin/reports', { cookie })).status).toBe(403)
    const id = await accountOf(cookie)
    expect((await call('POST', `/admin/accounts/${id}/role`, { admin: true, body: { role: 'moderator' } })).body).toEqual({ id, role: 'moderator' })
    expect((await call('GET', '/admin/reports', { cookie })).status).toBe(200)
    expect((await call('POST', `/admin/accounts/${id}/role`, { cookie, body: { role: 'admin' } })).status).toBe(403)
    expect((await call('POST', '/admin/rulesets/ruleset/activate', { cookie, body: {} })).status).toBe(403)
    const history = await call('GET', `/admin/history/account/${id}`, { cookie })
    expect(history.body.events.map((event: { action: string }) => event.action)).toEqual(expect.arrayContaining(['account.create', 'account.role']))
  })

  it('takes, notes and reads a report', async () => {
    const build = await seedPlayer(A, 'Alpha', 120)
    env.LB.sqlite.exec(`INSERT INTO reports (id, build_id, reason, status, created_at) VALUES ('report', '${build}', 'misread', 'open', 1)`)
    expect((await call('POST', '/admin/reports/report/assign', { admin: true, body: { take: true } })).body.assignedTo)
      .toBe('admin:admin@example.test')
    expect((await call('POST', '/admin/reports/report/notes', { admin: true, body: { body: 'checked the card' } })).status).toBe(201)
    const detail = await call('GET', '/admin/reports/report', { admin: true })
    expect(detail.body).toMatchObject({ report: { id: 'report', assignedTo: 'admin:admin@example.test' }, notes: [{ body: 'checked the card' }] })
    expect((await call('GET', '/admin/reports', { admin: true })).body.reports[0]).toMatchObject({ id: 'report', buildId: build })
  })
})

describe('activity', () => {
  it('counts every upload per board over the requested days, including uploads past the returned rows', async () => {
    const a = await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    const { activity } = await import('../src/api/board/queries.ts')
    // the seeded uploads are dated a few ms in: a clock sixteen days on still spans them
    const now = 16 * 24 * 3600 * 1000
    const feed = await activity(env, 'ruleset', 1, now, 0)
    expect(feed.rows).toHaveLength(1)
    expect(feed.boards.counts).toEqual([{ resonatorId: '1108', entries: 2 }])
    expect(feed.builds).toEqual({ ranked: 2, unranked: 0 })
    expect(feed.rows[0].buildId).not.toBe(a)
    // days before `from` are left out; a `from` past the sixteen days is clamped to them
    expect((await activity(env, 'ruleset', 1, now, now)).boards.counts).toEqual([])
  })
})

describe('sanctions', () => {
  it('takes a banned uid off every list and its board, and puts it back when lifted', async () => {
    const a = await seedPlayer(A, 'Alpha', 120)
    const b = await seedPlayer(B, 'Beta', 110)
    expect(await boardIds()).toEqual([a, b])
    const ban = await call('POST', '/admin/sanctions', { admin: true, body: { subjectKind: 'uid', subjectId: A, kind: 'ban', reason: 'stolen card' } })
    expect(ban.status).toBe(201)
    expect(await boardIds()).toEqual([b])
    expect((await call('GET', `/players/${A}`)).status).toBe(404)
    expect((await call('GET', `/builds/${a}`)).status).toBe(404)
    expect(((await call('GET', '/activity')).body.rows as Array<{ buildId: string }>).map((row) => row.buildId)).toEqual([b])
    expect((await call('POST', `/admin/sanctions/${ban.body.id}/lift`, { admin: true })).body.liftedBy).toBe('admin:admin@example.test')
    expect(await boardIds()).toEqual([a, b])
    const history = await call('GET', `/admin/history/player/${A}`, { admin: true })
    expect(history.body.sanctions).toHaveLength(1)
    expect(history.body.events.map((event: { action: string }) => event.action)).toEqual(expect.arrayContaining(['sanction.issue', 'sanction.lift']))
  })

  it('stops a suspended uid from acting and a suspended account from signing in, until it ends', async () => {
    await seedPlayer(A, 'Alpha', 120)
    const card = await claimSession(A)
    expect((await call('GET', '/me', { cookie: card })).body.uids).toMatchObject([{ uid: A }])
    await call('POST', '/admin/sanctions', { admin: true, body: { subjectKind: 'uid', subjectId: A, kind: 'suspend', reason: 'spam', days: 3 } })
    expect((await call('GET', '/me', { cookie: card })).body.uids).toEqual([])
    expect((await call('PATCH', `/builds/${buildOf(A)}`, { cookie: card, body: { hidden: true } })).status).toBe(404)
    // a suspension stops acting and leaves listing
    expect((await call('GET', `/players/${A}`)).status).toBe(200)

    const cookie = (await signIn('ana')).cookie!
    const id = await accountOf(cookie)
    expect((await call('POST', '/admin/sanctions', { admin: true, body: { subjectKind: 'account', subjectId: id, kind: 'suspend',
      reason: 'spam', days: 1 } })).status).toBe(201)
    // the suspended account retains its session, which reads the suspension and can only appeal
    const stopped = (await call('GET', '/me', { cookie })).body
    expect(stopped).toMatchObject({ uids: [], account: { id, suspension: { kind: 'suspend', reason: 'spam' } } })
    expect((await call('GET', '/feed', { cookie })).status).toBe(401)
    expect((await call('GET', '/account/sanctions', { cookie })).body.sanctions).toMatchObject([{ kind: 'suspend', appeal: null }])
    const again = await signIn('ana')
    expect(again.landed).toBe(`${APP}/leaderboard/me?signin=suspended`)
    expect(again.cookie).toBeTruthy()
    expect((await call('POST', '/admin/sanctions', { admin: true, body: { subjectKind: 'uid', subjectId: A, kind: 'suspend',
      reason: 'x' } })).body.error.code).toBe('bad_request')
  })
})

describe('documents and media', () => {
  it('stores the person\'s profile as parsed, features only their builds, and requires an account', async () => {
    const build = await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    // a claim session has the uid's builds; the profile belongs to the account
    const claim = await claimSession(A)
    expect((await call('PUT', '/players/me/documents/profile', { cookie: claim, body: {} })).body.error.code).toBe('unauthorized')
    const cookie = (await signIn('plain-ana', claim)).cookie!
    const bad = await call('PUT', '/players/me/documents/profile', { cookie, body: { links: [{ label: 'x', url: 'javascript:alert(1)' }] } })
    expect(bad.status).toBe(400)
    expect(bad.body.error.message).toContain('https://')
    expect(bad.body.error.message).not.toContain('Invalid URL')
    const longName = await call('PUT', '/players/me/documents/profile', { cookie, body: { displayName: 'x'.repeat(25) } })
    expect(longName.status).toBe(400)
    expect(longName.body.error.message).toContain('display name')
    expect(longName.body.error.message).toContain('24 characters')
    expect((await call('PUT', '/players/me/documents/profile', { cookie, body: { featured: [buildOf(B)] } })).body.error.code).toBe('bad_request')
    const put = await call('PUT', '/players/me/documents/profile', { cookie, body: { displayName: '  Ana  ', bio: 'hi', featured: [build], extra: 1 } })
    const privacy = { followers: true }
    expect(put.body.body).toEqual({ displayName: 'Ana', bio: 'hi', links: [], featured: [build], privacy })
    expect((await call('GET', `/players/${A}`)).body.profile).toEqual({ displayName: 'Ana', bio: 'hi', links: [], featured: [build], privacy })
  })

  it('refuses custom css on a card, and shows uploaded images to the public only once approved', async () => {
    const build = await seedPlayer(A, 'Alpha', 120)
    const card = await claimSession(A)
    const cookie = (await signIn('ana', card)).cookie!
    expect((await call('POST', '/media?purpose=avatar', { cookie, raw: new TextEncoder().encode('<svg/>') })).body.error.code).toBe('bad_image')
    expect((await call('POST', '/media?purpose=avatar', { raw: PNG })).status).toBe(401)
    // clamped to its purpose's longest side, read from the header: an avatar this wide is refused, a banner is not
    expect((await call('POST', '/media?purpose=avatar', { cookie, raw: pngOf(4000, 400) })).body.error.code).toBe('too_large')
    const wide = await call('POST', '/media?purpose=banner', { cookie, raw: pngOf(4000, 400) })
    expect(wide.status).toBe(201)
    expect((await call('DELETE', `/media/${wide.body.id}`, { cookie })).status).toBe(200)
    expect((await call('POST', '/media?purpose=banner', { cookie, raw: pngOf(0, 400) })).body.error.code).toBe('bad_image')
    const upload = await call('POST', '/media?purpose=card', { cookie, raw: PNG })
    expect(upload.body).toMatchObject({ purpose: 'card', contentType: 'image/png', status: 'pending' })
    const id = upload.body.id as string

    const style = { customCss: '.x{background:url(https://evil.test)}' }
    expect((await call('PUT', '/players/me/cards/1108', { cookie, body: { style, hidden: {} } })).status).toBe(400)
    expect((await call('PUT', '/players/me/cards/1108', { cookie, body: { style: { portraitImage: 'https://elsewhere.test/a.png' },
      hidden: {} } })).status).toBe(400)
    expect((await call('PUT', '/players/me/cards/1108', { cookie, body: { style: { portraitImage: `media:${id}` }, hidden: {} } })).status)
      .toBe(200)

    // pending media shows to the owner only
    expect((await call('GET', `/builds/${build}`, { cookie })).body.card.style.portraitImage).toBe(`media:${id}`)
    const publicView = await call('GET', `/builds/${build}`)
    expect(publicView.body.card.style.portraitImage).toBeNull()
    expect((await call('GET', `/media/${id}`)).status).toBe(404)
    expect((await call('GET', `/media/${id}`, { cookie })).status).toBe(200)

    expect((await call('GET', '/admin/media', { admin: true })).body.media.map((item: { id: string }) => item.id)).toEqual([id])
    expect((await call('POST', `/admin/media/${id}`, { admin: true, body: { status: 'approved' } })).body.status).toBe('approved')
    const file = await call('GET', `/media/${id}`)
    expect(file.headers.get('cache-control')).toContain('immutable')
    expect((await call('GET', `/builds/${build}`)).body.card.style.portraitImage).toBe(`media:${id}`)

    // deleting the build leaves the resonator's card and the uid's profile (filled from discord on joining the
    // account)
    expect((await call('DELETE', `/builds/${build}`, { cookie })).status).toBe(200)
    const account = await accountOf(cookie)
    expect(env.LB.sqlite.prepare('SELECT kind, owner_id FROM documents ORDER BY kind').all())
      .toEqual([{ kind: 'card', owner_id: `${account}:1108` }, { kind: 'profile', owner_id: account }])
  })

  it('fills the account\'s empty profile from discord once, approved, and shows it on every uid of theirs', async () => {
    const a = await seedPlayer(A, 'Alpha', 120)
    const b = await seedPlayer(B, 'Beta', 110)
    const cookie = (await signIn('ana', await claimSession(A))).cookie!
    const profile = (await call('GET', `/players/${A}`)).body.profile
    expect(profile).toMatchObject({ displayName: 'Discord ana', accent: '#3366cc' })
    // the images are copies in media, approved by discord: public at once and in no queue
    for (const id of [profile.avatar, profile.banner]) expect((await call('GET', `/media/${id}`)).status).toBe(200)
    expect((await call('GET', '/admin/media', { admin: true })).body.media).toEqual([])
    expect((await call('GET', '/admin/documents', { admin: true })).body.documents).toEqual([])

    // the player clears the avatar; signing in again does not restore it
    expect((await call('PUT', '/players/me/documents/profile', { cookie, body: { ...profile, avatar: undefined } })).status).toBe(200)
    await signIn('ana')
    expect((await call('GET', `/players/${A}`)).body.profile.avatar).toBeUndefined()

    // B joins the same account later as the same person, so either uid opens one profile with both uids' builds
    await signIn('ana', await claimSession(B))
    for (const uid of [A, B]) {
      const person = (await call('GET', `/players/${uid}`)).body
      expect(person).toMatchObject({ uid, profile: { displayName: 'Discord ana' } })
      expect(person.profile.avatar).toBeUndefined()
      expect(person.builds.map((x: { buildId: string }) => x.buildId).sort()).toEqual([a, b].sort())
    }
    expect((await call('GET', '/players/me/profile', { cookie })).body.builds).toHaveLength(2)
  })

  it('skips the staff queue for an admin and queues a moderator\'s work', async () => {
    await seedPlayer(A, 'Alpha', 120)
    await seedPlayer(B, 'Beta', 110)
    const queued = async () => ({
      media: ((await call('GET', '/admin/media', { admin: true })).body.media as Array<{ id: string }>).map((item) => item.id),
      documents: ((await call('GET', '/admin/documents', { admin: true })).body.documents as Array<{ ownerId: string }>).map((doc) => doc.ownerId),
    })
    const staffMember = async (person: string, uid: string, role: 'moderator' | 'admin') => {
      const cookie = (await signIn(person, await claimSession(uid))).cookie!
      await call('POST', `/admin/accounts/${await accountOf(cookie)}/role`, { admin: true, body: { role } })
      return cookie
    }

    const admin = await staffMember('ada', A, 'admin')
    const upload = await call('POST', '/media?purpose=avatar', { cookie: admin, raw: PNG })
    expect(upload.body.status).toBe('approved')
    expect((await call('GET', `/media/${upload.body.id}`)).status).toBe(200)
    expect((await call('PUT', '/players/me/documents/profile', { cookie: admin, body: { bio: 'hi', avatar: upload.body.id } })).status).toBe(200)
    expect((await call('GET', `/players/${A}`)).body.profile.avatar).toBe(upload.body.id)
    expect(await queued()).toEqual({ media: [], documents: [] })

    const moderator = await staffMember('mo', B, 'moderator')
    const held = await call('POST', '/media?purpose=avatar', { cookie: moderator, raw: PNG })
    expect(held.body.status).toBe('pending')
    expect((await call('PUT', '/players/me/documents/profile', { cookie: moderator, body: { bio: 'hey' } })).status).toBe(200)
    expect(await queued()).toEqual({ media: [held.body.id], documents: [await accountOf(moderator)] })
  })
})
