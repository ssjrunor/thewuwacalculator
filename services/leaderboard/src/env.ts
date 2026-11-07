/*
  Author: Runor Ewhro
  description: binding and secret types for the api and scorer workers. the
               names match wrangler.jsonc and wrangler.scorer.jsonc.
*/

import type { BrowserWorker } from '@cloudflare/puppeteer'
import type { ScoreMessage } from './scorer/messages.ts'

/** lb-read: one card to read. */
export interface ReadMessage {
  cardId: string
  /** set when the submitter held a session for the card's uid (owner submission). */
  ownerUid?: string | null
}

export interface ApiVars {
  APP_ORIGIN: string
  KURO_CARD_HOST: string
  KURO_CARD_PATH_PREFIX: string
  CARD_MAX_BYTES: string
  FRESH_CARD_MAX_AGE_S: string
  SESSION_TTL_S: string
  READER_URL: string
  /** game data mode the reader page resolves ids against: 'live' or 'beta'. */
  READ_MODE: string
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
  /** days a refused card's image is kept for a re-read after a parser fix, then erased. */
  REFUSED_IMAGE_KEEP_DAYS: string
}

export interface ApiSecrets {
  LINK_HASH_KEY: string
  SESSION_KEY: string
  TURNSTILE_SECRET: string
}

export interface ApiEnv extends ApiVars, ApiSecrets {
  LB: D1Database
  CARDS: R2Bucket
  LB_DATA: R2Bucket
  READ_QUEUE: Queue<ReadMessage>
  SCORE_QUEUE: Queue<ScoreMessage>
  BROWSER: BrowserWorker
  SUBMIT_LIMIT: RateLimit
  REPORT_LIMIT: RateLimit
}

export interface ScorerEnv {
  LB: D1Database
  LB_DATA: R2Bucket
  SCORE_QUEUE: Queue<ScoreMessage>
}

/** the numeric vars, parsed once per request. */
export function limits(env: ApiVars) {
  return {
    cardMaxBytes: Number(env.CARD_MAX_BYTES),
    freshMaxAgeSeconds: Number(env.FRESH_CARD_MAX_AGE_S),
    sessionTtlMs: Number(env.SESSION_TTL_S) * 1000,
  }
}
