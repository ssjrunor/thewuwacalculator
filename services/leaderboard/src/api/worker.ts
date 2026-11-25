/*
  Author: Runor Ewhro
  description: api worker entry: routes /api/lb/* to the handlers, wraps every
               response in the json envelope with cors for the app origin,
               consumes lb-read (one card per message) and its dead letters, and
               runs the hourly upkeep (maintenance.ts).
*/

import type { ApiEnv, ReadMessage } from '../env.ts'
import { HttpError, errorResponse, json, preflight, withCors } from '../lib/http.ts'
import { API_PREFIX, Router, type ApiServices } from './router.ts'
import { getCardStatus, submitCard, submitCards } from './cards/routes.ts'
import { cardLogin, logout, me, optIn, optOut, patchPlayer, releaseUid } from './auth/routes.ts'
import { deleteOwnBuild, hideOwnBuild, ownProfile } from './builds/routes.ts'
import {
  getActivity, getBoard, getBoardStats, getBoards, getBuildDetail, getBuildPlayer, getLiveRuleset, getPlayerProfile, getBoardCounts, getCellDetail,
} from './board/routes.ts'
import { submitReport } from './moderation/reports.ts'
import {
  activateRuleset, adminSubmitCard, blockCard, hideBuild, listReports, publishRuleset, resolveReport, restoreBuild, rulesetProgress,
} from './moderation/admin.ts'
import { browserReader } from './read/dispatch.ts'
import { ingestCard } from './read/ingest.ts'
import { maintain, settleDeadReads } from './maintenance.ts'
import { withSlowSql } from '../lib/slowSql.ts'
import { health, timings } from './moderation/health.ts'
import { markSetupPlayers } from './moderation/setup.ts'
import { createSeedBatch, finishSeedBatch, insertSeedRows, listSeedBatches, purgeSeedBatches } from './moderation/seed.ts'
import { checkSamples, recordCheck } from './moderation/checks.ts'
import { cancelRollout, listRulesets, rescoreBuilds, stampFingerprint, startRollout, sweepNow, uploadRulesetFile } from './moderation/rollouts.ts'
import {
  assignReport, assignRole, clearDocument, listDocuments, reviewDocument, issueSanction, liftSanction, listMedia, noteReport, reportDetail, reviewMedia, subjectHistory,
} from './moderation/tools.ts'
import { deleteAccount, finishSignIn, getProviders, removeLogin, startSignIn, unlinkUid } from './auth/account.ts'
import {
  deleteAccountDocument, deleteBuildDocument, deleteCardDocument, deletePlayerDocument, getAccountDocument, putAccountDocument,
  putBuildDocument, putCardDocument, putPlayerDocument,
} from './documents/routes.ts'
import { deleteOwnMedia, getMediaFile, listOwnMedia, uploadMedia } from './media/routes.ts'
import { buildSocial, editComment, likeBuild, listComments, postComment, removeComment, unlikeBuild } from './social/comments.ts'
import {
  blockPlayer, followBoard, followPlayer, getFeed, importFollows, listBlocks, listFollows, markFeedSeen, playerSocial, unblockPlayer,
  unfollowBoard, unfollowPlayer,
} from './social/follows.ts'
import { listNotifications, readNotifications } from './social/notifications.ts'
import { bookmarkBuild, listBookmarks, unbookmarkBuild } from './social/bookmarks.ts'
import { getHistory } from './board/history.ts'
import { decideAppeal, fileAppeal, listAppeals, ownSanctions } from './moderation/appeals.ts'
import { createPreset, deletePreset, getSharedPreset, listPresets, updatePreset } from './presets/routes.ts'
import { paceState, serving } from '../board/pace.ts'

export const READ_DLQ = 'lb-read-dlq'

export const router = new Router()
  .on('POST', '/cards', submitCard)
  .on('POST', '/cards/batch', submitCards)
  .on('GET', '/cards/:id', getCardStatus)
  .on('POST', '/auth/card', cardLogin)
  .on('POST', '/auth/logout', logout)
  .on('POST', '/auth/release', releaseUid)
  .on('GET', '/me', me)
  .on('GET', '/auth/providers', getProviders)
  .on('GET', '/auth/oauth/:provider/start', startSignIn)
  .on('GET', '/auth/oauth/:provider/callback', finishSignIn)
  .on('DELETE', '/account', deleteAccount)
  .on('DELETE', '/account/logins/:provider', removeLogin)
  .on('DELETE', '/account/uids/:uid', unlinkUid)
  .on('PUT', '/players/me/documents/:kind', putPlayerDocument)
  .on('DELETE', '/players/me/documents/:kind', deletePlayerDocument)
  .on('PUT', '/players/me/cards/:resonatorId', putCardDocument)
  .on('DELETE', '/players/me/cards/:resonatorId', deleteCardDocument)
  .on('PUT', '/builds/:id/documents/:kind', putBuildDocument)
  .on('DELETE', '/builds/:id/documents/:kind', deleteBuildDocument)
  .on('GET', '/account/documents/:kind', getAccountDocument)
  .on('PUT', '/account/documents/:kind', putAccountDocument)
  .on('DELETE', '/account/documents/:kind', deleteAccountDocument)
  .on('POST', '/media', uploadMedia)
  .on('GET', '/media', listOwnMedia)
  .on('GET', '/media/:id', getMediaFile)
  .on('DELETE', '/media/:id', deleteOwnMedia)
  .on('GET', '/follows', listFollows)
  .on('POST', '/follows/import', importFollows)
  .on('PUT', '/follows/players/:ref', followPlayer)
  .on('DELETE', '/follows/players/:ref', unfollowPlayer)
  .on('PUT', '/follows/boards/:resonatorId', followBoard)
  .on('DELETE', '/follows/boards/:resonatorId', unfollowBoard)
  .on('GET', '/feed', getFeed)
  .on('POST', '/feed/seen', markFeedSeen)
  .on('GET', '/players/:ref/social', playerSocial)
  .on('GET', '/players/:ref/history', getHistory)
  .on('GET', '/bookmarks', listBookmarks)
  .on('PUT', '/builds/:id/bookmark', bookmarkBuild)
  .on('DELETE', '/builds/:id/bookmark', unbookmarkBuild)
  .on('GET', '/presets', listPresets)
  .on('POST', '/presets', createPreset)
  .on('GET', '/presets/:id', getSharedPreset)
  .on('PATCH', '/presets/:id', updatePreset)
  .on('DELETE', '/presets/:id', deletePreset)
  .on('GET', '/account/sanctions', ownSanctions)
  .on('POST', '/sanctions/:id/appeal', fileAppeal)
  .on('GET', '/blocks', listBlocks)
  .on('PUT', '/blocks/:ref', blockPlayer)
  .on('DELETE', '/blocks/:ref', unblockPlayer)
  .on('GET', '/builds/:id/social', buildSocial)
  .on('PUT', '/builds/:id/like', likeBuild)
  .on('DELETE', '/builds/:id/like', unlikeBuild)
  .on('GET', '/builds/:id/comments', listComments)
  .on('POST', '/builds/:id/comments', postComment)
  .on('PATCH', '/comments/:id', editComment)
  .on('DELETE', '/comments/:id', removeComment)
  .on('GET', '/notifications', listNotifications)
  .on('POST', '/notifications/read', readNotifications)
  .on('PATCH', '/players/me/uids/:uid', patchPlayer)
  .on('POST', '/players/me/uids/:uid/opt-out', optOut)
  .on('DELETE', '/players/me/uids/:uid/opt-out', optIn)
  .on('GET', '/players/me/profile', ownProfile)
  .on('DELETE', '/builds/:id', deleteOwnBuild)
  .on('PATCH', '/builds/:id', hideOwnBuild)
  .on('GET', '/builds/:id', getBuildDetail)
  .on('GET', '/builds/:id/player', getBuildPlayer)
  .on('GET', '/builds/:id/cells/:scenarioId', getCellDetail)
  .on('GET', '/boards', getBoards)
  .on('GET', '/boards/:resonatorId', getBoard)
  .on('GET', '/boards/:resonatorId/stats', getBoardStats)
  .on('GET', '/boards/:resonatorId/counts', getBoardCounts)
  .on('GET', '/players/:uid', getPlayerProfile)
  .on('GET', '/activity', getActivity)
  .on('GET', '/rulesets/live', getLiveRuleset)
  // answers without touching storage: whether the isolate's thread is free. dev's watchdog asks it (tools/dev-wrangler.mjs).
  .on('GET', '/healthz', async ({ now }) => json({ ok: true, ...paceState(now) }))
  .on('POST', '/reports', submitReport)
  .on('GET', '/admin/health', health)
  .on('GET', '/admin/timings', timings)
  .on('POST', '/admin/cards', adminSubmitCard)
  .on('GET', '/admin/reports', listReports)
  .on('POST', '/admin/reports/:id', resolveReport)
  .on('GET', '/admin/reports/:id', reportDetail)
  .on('POST', '/admin/reports/:id/assign', assignReport)
  .on('POST', '/admin/reports/:id/notes', noteReport)
  .on('POST', '/admin/sanctions', issueSanction)
  .on('POST', '/admin/sanctions/:id/lift', liftSanction)
  .on('GET', '/admin/history/:kind/:id', subjectHistory)
  .on('POST', '/admin/accounts/:id/role', assignRole)
  .on('DELETE', '/admin/documents/:kind/:ownerId', clearDocument)
  .on('GET', '/admin/documents', listDocuments)
  .on('POST', '/admin/documents/:kind/:ownerId/reviewed', reviewDocument)
  .on('GET', '/admin/appeals', listAppeals)
  .on('POST', '/admin/appeals/:id', decideAppeal)
  .on('GET', '/admin/media', listMedia)
  .on('POST', '/admin/media/:id', reviewMedia)
  .on('POST', '/admin/builds/:id/hide', hideBuild)
  .on('POST', '/admin/builds/:id/restore', restoreBuild)
  .on('POST', '/admin/players/setup', markSetupPlayers)
  .on('GET', '/admin/seed', listSeedBatches)
  .on('POST', '/admin/seed', createSeedBatch)
  .on('POST', '/admin/seed/purge', purgeSeedBatches)
  .on('POST', '/admin/seed/:id/rows', insertSeedRows)
  .on('POST', '/admin/seed/:id/finish', finishSeedBatch)
  .on('POST', '/admin/cards/:id/block', blockCard)
  .on('GET', '/admin/rulesets', listRulesets)
  .on('PUT', '/admin/rulesets/:id/files', uploadRulesetFile)
  .on('POST', '/admin/rulesets/:id/publish', publishRuleset)
  .on('POST', '/admin/rulesets/:id/rollout', startRollout)
  .on('POST', '/admin/rulesets/:id/fingerprint', stampFingerprint)
  .on('POST', '/admin/rulesets/:id/rollout/cancel', cancelRollout)
  .on('POST', '/admin/rulesets/:id/rescore', rescoreBuilds)
  .on('GET', '/admin/rulesets/:id/progress', rulesetProgress)
  .on('GET', '/admin/rulesets/:id/samples', checkSamples)
  .on('POST', '/admin/rulesets/:id/verify', recordCheck)
  .on('POST', '/admin/sweep', sweepNow)
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
      response = errorResponse(new HttpError('internal', "oopsies... something went wrong on our side. try again in a little while :("))
    }
  }
  return withCors(response, request, env.APP_ORIGIN)
}

// read queue retries await the complete ingest operation; parser evidence and build writes finish before acknowledgement.
export async function consumeReads(batch: MessageBatch<ReadMessage>, env: ApiEnv, services: ApiServices = {}): Promise<void> {
  const reader = services.reader ?? browserReader(env.BROWSER, env.READER_URL, env.READ_MODE)
  for (const message of batch.messages) {
    try {
      const outcome = await ingestCard(env, message.body.cardId, { reader, sessionUids: message.body.ownerUids ?? [],
        byPlayer: message.body.byPlayer === true, now: Date.now() })
      console.log('read', message.body.cardId, outcome.kind, 'reason' in outcome ? outcome.reason : '')
      message.ack()
    } catch (error) {
      console.error('read failed', message.body.cardId, error)
      message.retry({ delaySeconds: 30 })
    }
  }
}

/** dev-sweep's window: a job idle this long after a hot reload is resumed. */
const DEV_STALL_MS = 3 * 60_000

export default {
  // counted in pace.ts: a board in this isolate pauses its heavy background steps while a request runs
  fetch: (request, env, ctx) => serving(async () => {
    const started = Date.now()
    const response = await handle(request, withSlowSql(env, `${request.method} ${new URL(request.url).pathname}`), ctx)
    // the app's timing logs split a wait into this server time and network time; workerd's clock advances only across
    // I/O, so this measures waits on boards and D1 and excludes synchronous work in the isolate
    if (response.status === 101) return response
    const timed = new Response(response.body, response)
    timed.headers.append('server-timing', `app;dur=${Date.now() - started}`)
    return timed
  }),
  queue: (batch, env) => batch.queue === READ_DLQ
    ? settleDeadReads(batch as MessageBatch<ReadMessage>, env, Date.now())
    : consumeReads(batch as MessageBatch<ReadMessage>, env),
  // local dev only: dev:full calls /__scheduled?cron=startup once wrangler is up, and a restart drops the local
  // queue, so every unfinished job resumes immediately
  scheduled: async (controller, env) => {
    // local dev only (tools/dev-sweep.mjs): 'startup' resumes everything and 'dev' runs every few minutes with a short
    // window because hot reloads drop the local queue; deployed workers run only their configured cron
    const stallMs = controller.cron === 'startup' ? 0 : controller.cron === 'dev' ? DEV_STALL_MS : undefined
    console.log('maintenance', JSON.stringify(await maintain(withSlowSql(env, `maintenance ${controller.cron}`), Date.now(), stallMs === undefined ? {} : { stallMs })))
  },
} satisfies ExportedHandler<ApiEnv, ReadMessage>
