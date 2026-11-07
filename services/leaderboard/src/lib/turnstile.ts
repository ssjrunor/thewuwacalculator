/*
  Author: Runor Ewhro
  description: checks a turnstile token with cloudflare's siteverify before a
               submission, a card login or a report is accepted.
*/

import { HttpError } from './http.ts'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function requireTurnstile(token: unknown, secret: string, ip: string,
  fetchImpl: typeof fetch = fetch): Promise<void> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    throw new HttpError('turnstile_failed', 'missing turnstile token')
  }
  const body = new FormData()
  body.set('secret', secret)
  body.set('response', token)
  if (ip !== 'unknown') body.set('remoteip', ip)
  // an unsuccessful verification response rejects the request before submission, login, or report writes.
  const response = await fetchImpl(SITEVERIFY, { method: 'POST', body })
  const outcome = response.ok ? await response.json() as { success?: boolean } : { success: false }
  if (!outcome.success) throw new HttpError('turnstile_failed', 'turnstile check failed')
}
