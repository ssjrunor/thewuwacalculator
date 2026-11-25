/*
  Author: Runor Ewhro
  description: oauth sign-in (authorization code with pkce). the provider's
               stable user id is the login subject, and discord's public profile
               (name, avatar, banner, accent) fills the account's empty profile.
               no email is requested; a provider is listed only when its client
               id and secret are configured.
*/

import type { LoginProvider } from '@lb/contract/api'
import type { ProviderProfile } from '../../db/accounts.ts'
import type { ApiEnv } from '../../env.ts'
import { HttpError } from '../../lib/http.ts'

export interface OAuthProvider {
  /** where the browser goes to approve the sign-in. */
  authorizeUrl(request: { state: string; challenge: string; redirectUri: string }): string
  /** who approved the code: the provider's stable user id, and its public profile when it gives one. */
  identify(request: { code: string; verifier: string; redirectUri: string }): Promise<{ subject: string; profile: ProviderProfile | null }>
}

const DISCORD_CDN = 'https://cdn.discordapp.com'
const snowflake = (value: unknown): value is string => typeof value === 'string' && /^\d{1,20}$/.test(value)
const imageHash = (value: unknown): value is string => typeof value === 'string' && /^(a_)?[0-9a-f]{32}$/.test(value)

/** maps discord's /users/@me to a profile; image urls are built from the user id and hashes as fixed-size
    still pngs on discord's cdn. */
export function discordProfile(user: Record<string, unknown>): ProviderProfile | null {
  if (!snowflake(user.id)) return null
  const name = [user.global_name, user.username].find((value): value is string => typeof value === 'string' && value.trim() !== '')
  const accent = typeof user.accent_color === 'number' && Number.isInteger(user.accent_color) && user.accent_color >= 0
    && user.accent_color <= 0xffffff ? `#${user.accent_color.toString(16).padStart(6, '0')}` : null
  return {
    name: name?.trim() ?? null,
    avatarUrl: imageHash(user.avatar) ? `${DISCORD_CDN}/avatars/${user.id}/${user.avatar}.png?size=512` : null,
    bannerUrl: imageHash(user.banner) ? `${DISCORD_CDN}/banners/${user.id}/${user.banner}.png?size=1024` : null,
    accent,
  }
}

/** true for an address discordProfile built; the only images the service fetches on a profile's behalf. */
export const isProviderImage = (url: string): boolean =>
  /^https:\/\/cdn\.discordapp\.com\/(avatars|banners)\/\d{1,20}\/(a_)?[0-9a-f]{32}\.png\?size=\d{3,4}$/.test(url)

interface ClientConfig {
  clientId: string
  clientSecret: string
  authorize: string
  token: string
  /** the user endpoint and the response field with the stable id. */
  user: { url: string; field: string }
  /** reads the public profile from the user endpoint response, for providers that return one. */
  profile?: (user: Record<string, unknown>) => ProviderProfile | null
  scope: string
}

function codeFlow(config: ClientConfig, fetchImpl: typeof fetch): OAuthProvider {
  return {
    authorizeUrl({ state, challenge, redirectUri }) {
      const url = new URL(config.authorize)
      url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, scope: config.scope, state,
        redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'consent' }).toString()
      return url.toString()
    },
    async identify({ code, verifier, redirectUri }) {
      const tokenResponse = await fetchImpl(config.token, { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier,
          client_id: config.clientId, client_secret: config.clientSecret }) })
      if (!tokenResponse.ok) throw new HttpError('unauthorized', 'the sign-in was not approved')
      const { access_token: accessToken } = await tokenResponse.json() as { access_token?: string }
      if (!accessToken) throw new HttpError('unauthorized', 'the sign-in was not approved')
      const userResponse = await fetchImpl(config.user.url, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } })
      if (!userResponse.ok) throw new HttpError('unauthorized', 'the provider did not say who signed in')
      const user = await userResponse.json() as Record<string, unknown>
      const subject = user[config.user.field]
      if (typeof subject !== 'string' || !subject) throw new HttpError('unauthorized', 'the provider did not say who signed in')
      return { subject, profile: config.profile?.(user) ?? null }
    },
  }
}

/** the providers configured for this deployment. */
export function configuredProviders(env: ApiEnv, fetchImpl: typeof fetch = fetch): Partial<Record<LoginProvider, OAuthProvider>> {
  const out: Partial<Record<LoginProvider, OAuthProvider>> = {}
  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
    out.discord = codeFlow({ clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET, scope: 'identify',
      authorize: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token',
      user: { url: 'https://discord.com/api/users/@me', field: 'id' }, profile: discordProfile }, fetchImpl)
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    out.google = codeFlow({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, scope: 'openid',
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
      user: { url: 'https://openidconnect.googleapis.com/v1/userinfo', field: 'sub' } }, fetchImpl)
  }
  return out
}

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** a pkce verifier and its S256 challenge. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  return { verifier, challenge }
}

/** an app path to land on after signing in: same-origin and relative only, else the leaderboard. */
export function safeReturn(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.length > 512) return '/leaderboard'
  return value
}
