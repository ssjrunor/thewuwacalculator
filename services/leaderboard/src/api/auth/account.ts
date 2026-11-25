/*
  Author: Runor Ewhro
  description: handles the signed-in account: provider sign-in (start and
               callback), its sign-in methods and linked uids, and account
               deletion. sign-in links the uids of the claim session that
               started it and fills empty profile fields from discord.
*/

import type { LoginProvider, ProvidersResponse } from '@lb/contract/api'
import { limits } from '../../env.ts'
import { auditStatement, type AuditAction } from '../../lib/audit.ts'
import { sha256Hex } from '../../lib/hash.ts'
import { HttpError, clientIp, json } from '../../lib/http.ts'
import { randomToken } from '../../lib/ids.ts'
import { clearedSessionCookie, newSessionToken, sessionCookie, SESSION_COOKIE_MAX_AGE_S } from '../../lib/session.ts'
import {
  deleteAccountStatements, deleteLoginStatement, insertAccountSessionStatement, insertAccountStatement, insertLoginStatement,
  insertOAuthStateStatement, linkOf, linkUidStatement, loginFor, loginsOf, setSessionAccountStatement, takeOAuthState,
  touchAccountStatement, touchLoginStatement, unlinkUidStatement, type ProviderProfile,
} from '../../db/accounts.ts'
import { deleteSessionHoldsStatement, holdsOf } from '../../db/identity.ts'
import { mediaOf } from '../../db/media.ts'
import { stoppedBy } from '../../db/sanctions.ts'
import { deleteAccountSocialStatements } from '../../db/social.ts'
import { rateLimit } from '../cards/routes.ts'
import { API_PREFIX, type RouteContext } from '../router.ts'
import { configuredProviders, pkcePair, safeReturn, type OAuthProvider } from './oauth.ts'
import { meFor } from './routes.ts'
import { fillProfile } from './providerProfile.ts'
import { optionalSession, requireAccount } from './sessions.ts'

/** a pending sign-in lasts this long. */
const STATE_TTL_MS = 10 * 60 * 1000

const providersOf = (context: RouteContext) => context.services.oauth ?? configuredProviders(context.env)

function providerFor(context: RouteContext): { id: LoginProvider; provider: OAuthProvider } {
  const id = context.params.provider as LoginProvider
  const provider = Object.hasOwn(providersOf(context), id) ? providersOf(context)[id] : undefined
  if (!provider) throw new HttpError('not_found', "hmm... that sign-in method isn't available. reopen your account window and try another one.")
  return { id, provider }
}

const redirectUri = (context: RouteContext, provider: LoginProvider) =>
  `${context.env.APP_ORIGIN}${API_PREFIX}/auth/oauth/${provider}/callback`

const stateHash = (state: string) => sha256Hex(new TextEncoder().encode(state))

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location, 'cache-control': 'private, no-store' })
  if (cookie) headers.set('set-cookie', cookie)
  return new Response(null, { status: 302, headers })
}

export async function getProviders(context: RouteContext): Promise<Response> {
  const body: ProvidersResponse = { providers: Object.keys(providersOf(context)) as LoginProvider[] }
  return json(body)
}

/** GET /auth/oauth/:provider/start?return=/path: off to the provider, remembering where to come back to. */
export async function startSignIn(context: RouteContext): Promise<Response> {
  const { env, now, url } = context
  await rateLimit(env.SUBMIT_LIMIT, `signin:${clientIp(context.request)}`)
  const { id, provider } = providerFor(context)
  const session = await optionalSession(context)
  const state = randomToken(32)
  const { verifier, challenge } = await pkcePair()
  await insertOAuthStateStatement(env.LB, { state_hash: await stateHash(state), provider: id, verifier,
    return_to: safeReturn(url.searchParams.get('return')), token_hash: session?.tokenHash ?? null, expires_at: now + STATE_TTL_MS }, now).run()
  return redirect(provider.authorizeUrl({ state, challenge, redirectUri: redirectUri(context, id) }))
}

/** GET /auth/oauth/:provider/callback: finishes sign-in and redirects to the app with a `signin=` result. */
export async function finishSignIn(context: RouteContext): Promise<Response> {
  const { env, now, url } = context
  const db = env.LB
  const { id, provider } = providerFor(context)
  const back = (result: 'ok' | 'denied' | 'failed' | 'suspended', path = '/leaderboard', cookie?: string) =>
    redirect(`${env.APP_ORIGIN}${path}${path.includes('?') ? '&' : '?'}signin=${result}`, cookie)

  const stateParam = url.searchParams.get('state')
  const state = stateParam ? await takeOAuthState(db, await stateHash(stateParam), now) : null
  if (!state || state.provider !== id) return back('failed')
  const code = url.searchParams.get('code')
  if (!code || url.searchParams.has('error')) return back('denied', state.return_to)
  let subject: string
  let profile: ProviderProfile | null
  try {
    ({ subject, profile } = await provider.identify({ code, verifier: state.verifier, redirectUri: redirectUri(context, id) }))
  } catch {
    return back('failed', state.return_to)
  }

  // the sign-in joins the session that started it, and only that one: a sign-in finished in another browser starts afresh.
  const current = await optionalSession(context)
  const session = current && current.tokenHash === state.token_hash ? current : null
  const login = await loginFor(db, id, subject)
  const statements: D1PreparedStatement[] = []
  const audit = (accountId: string, action: AuditAction, data?: unknown) =>
    auditStatement(db, { actorKind: 'account', actorId: accountId, action, subjectKind: 'account', subjectId: accountId, data }, now)
  let accountId: string
  if (login) {
    accountId = login.account_id
    statements.push(touchLoginStatement(db, { provider: id, subject, profile }, now), audit(accountId, 'account.sign_in', { provider: id }))
  } else if (session?.accountId) {
    // signed in already: this provider becomes another way into the same account.
    accountId = session.accountId
    statements.push(insertLoginStatement(db, { provider: id, subject, accountId, profile }, now), audit(accountId, 'account.login_add', { provider: id }))
  } else {
    const made = insertAccountStatement(db, now)
    accountId = made.id
    statements.push(made.statement, insertLoginStatement(db, { provider: id, subject, accountId, profile }, now),
      audit(accountId, 'account.create', { provider: id }))
  }
  statements.push(touchAccountStatement(db, accountId, now))

  // link the uids from this browser's claim session to the account; account sessions store no uids
  const expiresAt = now + limits(env).accountSessionTtlMs
  let cookie: string | undefined
  if (session && !session.accountId) {
    for (const hold of await holdsOf(db, session.tokenHash)) {
      statements.push(linkUidStatement(db, { uid: hold.uid, accountId, claimId: hold.claim_id }, now),
        auditStatement(db, { actorKind: 'account', actorId: accountId, action: 'uid.link', subjectKind: 'player', subjectId: hold.uid }, now))
    }
    statements.push(deleteSessionHoldsStatement(db, session.tokenHash))
  }
  if (session) {
    statements.push(setSessionAccountStatement(db, session.tokenHash, accountId, expiresAt))
  } else {
    const made = await newSessionToken(env.SESSION_KEY)
    statements.push(insertAccountSessionStatement(db, { tokenHash: made.tokenHash, accountId, now, expiresAt }))
    cookie = sessionCookie(made.token, SESSION_COOKIE_MAX_AGE_S)
  }
  await db.batch(statements)
  // a stopped account still gets its session, which can only read its sanctions and appeal them.
  const stopped = await stoppedBy(db, 'account', accountId, now)
  // a new account, or the first login to bring a profile, starts the account's profile from the provider's.
  if (!stopped && profile && !login?.profile) await fillProfile(context, accountId)
  return back(stopped ? 'suspended' : 'ok', state.return_to, cookie)
}

/** DELETE /account/logins/:provider: removes one sign-in method while at least one remains. */
export async function removeLogin(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  const logins = await loginsOf(db, session.accountId)
  if (!logins.some((login) => login.provider === context.params.provider)) throw new HttpError('not_found', "hmm... that sign-in method isn't available. reopen your account window and try another one.")
  if (logins.length < 2) throw new HttpError('bad_request', "hold on... keep at least one sign-in method so you can get back into your account :P")
  await db.batch([deleteLoginStatement(db, session.accountId, context.params.provider as LoginProvider),
    auditStatement(db, { actorKind: 'account', actorId: session.accountId, action: 'account.login_remove', subjectKind: 'account',
      subjectId: session.accountId, data: { provider: context.params.provider } }, context.now)])
  return json(await meFor(db, session))
}

/** DELETE /account/uids/:uid: unlinks the uid and removes its builds from the account's profile;
    relinking it needs a fresh card. */
export async function unlinkUid(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  const uid = context.params.uid
  if ((await linkOf(db, uid))?.account_id !== session.accountId) throw new HttpError('not_found', "hmm... that UID isn't linked to this account. refresh your account details and try again.")
  await db.batch([unlinkUidStatement(db, uid),
    auditStatement(db, { actorKind: 'account', actorId: session.accountId, action: 'uid.unlink', subjectKind: 'player', subjectId: uid }, context.now)])
  return json(await meFor(db, session, context.now))
}

/** DELETE /account: deletes the account, its sign-in methods, profile and links, and ends its sessions;
    uids and their builds remain for a fresh card to claim. */
export async function deleteAccount(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  const media = await mediaOf(db, session.accountId)
  await db.batch([...deleteAccountSocialStatements(db, session.accountId, context.now), ...deleteAccountStatements(db, session.accountId, context.now),
    auditStatement(db, { actorKind: 'account', actorId: session.accountId, action: 'account.delete', subjectKind: 'account',
      subjectId: session.accountId, data: { media: media.length } }, context.now)])
  // delete the media rows before their r2 objects; image reads look up the row first
  if (media.length) await context.env.CARDS.delete(media.map((item) => item.r2_key))
  return json({ ok: true }, { headers: { 'set-cookie': clearedSessionCookie() } })
}
