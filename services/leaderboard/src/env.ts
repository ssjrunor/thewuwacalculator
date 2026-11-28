/*
  Author: Runor Ewhro
  description: binding and secret types for the api and scorer workers. the
               names match wrangler.jsonc and wrangler.scorer.jsonc.
*/

import type { BrowserWorker } from '@cloudflare/puppeteer'
import type { ScoreMessage } from './scorer/messages.ts'
import type { ObjectBindings } from './api/stubs.ts'

// lb-read: one card to read
export interface ReadMessage {
  // the registry card's public id
  cardId: string
  // every uid the submitter's session has; any of them read from the card makes it the owner's submission
  ownerUids?: string[]
  // a player sent it: a re-read or an admin submission leaves it out, so only a player ends a uid's setup
  byPlayer?: boolean
  // sent with other cards (a bulk submit, a requeue): the reader browser stays up for the rest of them
  bulk?: boolean
}

export interface ApiVars {
  APP_ORIGIN: string
  KURO_CARD_HOST: string
  KURO_CARD_PATH_PREFIX: string
  CARD_MAX_BYTES: string
  FRESH_CARD_MAX_AGE_S: string
  // a claim session's lifetime (no account), extended while it is used
  SESSION_TTL_S: string
  // a signed-in account session's lifetime, extended while it is used
  ACCOUNT_SESSION_TTL_S: string
  READER_URL: string
  // game data mode the reader page resolves ids against: 'live' or 'beta'
  READ_MODE: string
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
  // days a refused card's image is kept for a re-read after a parser update, then erased
  REFUSED_IMAGE_KEEP_DAYS: string
}

export interface ApiSecrets {
  LINK_HASH_KEY: string
  SESSION_KEY: string
  TURNSTILE_SECRET: string
  // oauth clients; a provider without both is not offered
  DISCORD_CLIENT_ID?: string
  DISCORD_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  // local dev only (.dev.vars): admin token for tools/lb.mjs requests to localhost; unset in deployments
  DEV_ADMIN_TOKEN?: string
  // local dev only (dev:full): the node scorer url for scenarios; the job sweep pauses while it is down
  LOCAL_SCORER_URL?: string
  // local dev only (.dev.vars): log every d1 statement slower than this many ms (src/lib/slowSql.ts)
  SLOW_SQL_MS?: string
  // ms staged bulk cells wait for more builds of their program before a smaller group is sent (board/store.ts
  // GROUP_WAIT_MS); tests set 0 to send groups at once
  GROUP_WAIT_MS?: string
}

export interface ApiEnv extends ApiVars, ApiSecrets, ObjectBindings {
  LB: D1Database
  CARDS: R2Bucket
  LB_DATA: R2Bucket
  READ_QUEUE: Queue<ReadMessage>
  SCORE_QUEUE: Queue<ScoreMessage>
  // lb-score-bulk: rescores and rollouts, queued apart from new builds; without it (tests) SCORE_QUEUE takes them
  SCORE_BULK_QUEUE?: Queue<ScoreMessage>
  // the scorer worker (its fetch: POST /fill), for breakdowns omitted by lean scores (BoardDO.fill); without it
  // (tests) lean cells stay lean
  SCORER?: Fetcher
  BROWSER: BrowserWorker
  SUBMIT_LIMIT: RateLimit
  REPORT_LIMIT: RateLimit
}

export interface ScorerEnv extends Pick<ObjectBindings, 'BOARDS'> {
  // the ruleset catalog only (a package's manifest hash); the scorer reads and writes no build
  LB: D1Database
  LB_DATA: R2Bucket
  SCORE_QUEUE: Queue<ScoreMessage>
  // lb-score-bulk: rescores; without it (tests) bulk work uses SCORE_QUEUE
  SCORE_BULK_QUEUE?: Queue<ScoreMessage>
  // local dev only (dev:full): url of tools/local-scorer.mjs, which scores scenarios outside the worker
  LOCAL_SCORER_URL?: string
  // share (0 to 1) of builds given a shared program that generate their own to check it; 0.02 when unset (job.ts)
  LB_PROGRAM_CHECK?: string
  // the share (0 to 1) of builds measured by a group's compiled program also replayed to check it; 0.02 when unset
  // (job.ts)
  LB_DAMAGE_CHECK?: string
  // '0' scores bulk groups with full breakdowns (job.ts leanOf)
  LB_LEAN_BULK?: string
}

// the numeric vars, parsed once per request
export function limits(env: ApiVars) {
  return {
    cardMaxBytes: Number(env.CARD_MAX_BYTES),
    freshMaxAgeSeconds: Number(env.FRESH_CARD_MAX_AGE_S),
    sessionTtlMs: Number(env.SESSION_TTL_S) * 1000,
    accountSessionTtlMs: Number(env.ACCOUNT_SESSION_TTL_S) * 1000,
  }
}
