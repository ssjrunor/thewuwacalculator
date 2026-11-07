/*
  Author: Runor Ewhro
  description: api worker entry: routes /api/lb/v1/* to the handlers, wraps
               every answer in the json envelope and cors for the app origin,
               consumes lb-read (one card per message) and its dead letters,
               and runs the hourly upkeep (maintenance.ts).
*/

import type { ApiEnv, ReadMessage } from '../env.ts'
import { HttpError, errorResponse, preflight, withCors } from '../lib/http.ts'
import { Router, type ApiServices } from './router.ts'
import { getCardStatus, submitCard } from './cards/routes.ts'
import { cardLogin, logout, me, optIn, optOut, patchPlayer } from './auth/routes.ts'
import { activateBuild, deleteOwnBuild, listOwnBuilds } from './builds/routes.ts'
import { getBoard, getBuildDetail, getLiveRuleset, getRotation } from './board/routes.ts'
import { submitReport } from './moderation/reports.ts'
import {
  activateRuleset, blockCard, hideBuild, listReports, publishRuleset, rescoreRuleset, resolveReport, restoreBuild, rulesetProgress,
} from './moderation/admin.ts'
import { browserReader } from './read/dispatch.ts'
import { ingestCard } from './read/ingest.ts'
import { maintain, settleDeadReads } from './maintenance.ts'
import { health } from './moderation/health.ts'

export const READ_DLQ = 'lb-read-dlq'

export const API_PREFIX = '/api/lb/v1'

export const router = new Router()
  .on('POST', '/cards', submitCard)
  .on('GET', '/cards/:id', getCardStatus)
  .on('POST', '/auth/card', cardLogin)
  .on('POST', '/auth/logout', logout)
  .on('GET', '/me', me)
  .on('PATCH', '/players/me', patchPlayer)
  .on('POST', '/players/me/opt-out', optOut)
  .on('DELETE', '/players/me/opt-out', optIn)
  .on('GET', '/players/me/builds', listOwnBuilds)
  .on('DELETE', '/builds/:id', deleteOwnBuild)
  .on('POST', '/builds/:id/activate', activateBuild)
  .on('GET', '/builds/:id', getBuildDetail)
  .on('GET', '/builds/:id/scenarios/:scenarioId/rotation', getRotation)
  .on('GET', '/boards/:resonatorId', getBoard)
  .on('GET', '/rulesets/live', getLiveRuleset)
  .on('POST', '/reports', submitReport)
  .on('GET', '/admin/health', health)
  .on('GET', '/admin/reports', listReports)
  .on('POST', '/admin/reports/:id', resolveReport)
  .on('POST', '/admin/builds/:id/hide', hideBuild)
  .on('POST', '/admin/builds/:id/restore', restoreBuild)
  .on('POST', '/admin/cards/:id/block', blockCard)
  .on('POST', '/admin/rulesets/:id/publish', publishRuleset)
  .on('POST', '/admin/rulesets/:id/rescore', rescoreRuleset)
  .on('GET', '/admin/rulesets/:id/progress', rulesetProgress)
  .on('POST', '/admin/rulesets/:id/activate', activateRuleset)

export async function handle(request: Request, env: ApiEnv, ctx: ExecutionContext,
  options: { now?: number; services?: ApiServices } = {}): Promise<Response> {
  // each handler receives one request timestamp, keeping expiry and audit comparisons consistent within that request.
  const now = options.now ?? Date.now()
  const url = new URL(request.url)
  if (request.method === 'OPTIONS') return preflight(request, env.APP_ORIGIN)
  let response: Response
  try {
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) throw new HttpError('not_found', 'no such route')
    const { handler, params } = router.match(request.method, url.pathname.slice(API_PREFIX.length))
    response = await handler({ request, env, ctx, url, params, now, services: options.services ?? {} })
  } catch (error) {
    if (error instanceof HttpError) response = errorResponse(error)
    else {
      console.error('unhandled', error)
      response = errorResponse(new HttpError('internal', 'something went wrong'))
    }
  }
  return withCors(response, request, env.APP_ORIGIN)
}

// read queue retries await the complete ingest operation; parser evidence and build writes finish before acknowledgement.
export async function consumeReads(batch: MessageBatch<ReadMessage>, env: ApiEnv, services: ApiServices = {}): Promise<void> {
  const reader = services.reader ?? browserReader(env.BROWSER, env.READER_URL, env.READ_MODE)
  for (const message of batch.messages) {
    try {
      const outcome = await ingestCard(env, message.body.cardId, { reader, sessionUid: message.body.ownerUid ?? null, now: Date.now() })
      console.log('read', message.body.cardId, outcome.kind, 'reason' in outcome ? outcome.reason : '')
      message.ack()
    } catch (error) {
      console.error('read failed', message.body.cardId, error)
      message.retry({ delaySeconds: 30 })
    }
  }
}

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx),
  queue: (batch, env) => batch.queue === READ_DLQ
    ? settleDeadReads(batch as MessageBatch<ReadMessage>, env, Date.now())
    : consumeReads(batch as MessageBatch<ReadMessage>, env),
  scheduled: async (_controller, env) => {
    console.log('maintenance', JSON.stringify(await maintain(env, Date.now())))
  },
} satisfies ExportedHandler<ApiEnv, ReadMessage>
