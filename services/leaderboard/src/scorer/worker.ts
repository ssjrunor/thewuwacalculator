/*
  Author: Runor Ewhro
  description: consumes lb-score and lb-score-bulk. a message is one cell of one
               build, or (bulk) one cell of a group of builds sharing a program;
               a batch's results go to their boards in one call per board, and a
               message is acked after its board records them. messages failing
               every attempt go to lb-score-dlq, where their cells are recorded
               as errors and their jobs finish on the scored cells. a rollout's
               reuse message (reuse.ts) sends its kept cells to the board with
               the cells it did not keep, which the board scores in groups; a
               reuse message that keeps failing sends every cell to the board.
*/

import { RulesetError, ScoringDataConflict } from '@lb/scoring'
import type { ScorerEnv } from '../env.ts'
import { boardOf } from '../api/stubs.ts'
import { LocalScorerUnavailable, scoreCell, scoreGroup, type ScorerServices } from './job.ts'
import { reuseCells, type ReuseOutcome } from './reuse.ts'
import {
  cellMessagesOfGroup, isCellMessage, isGroupMessage, isReuseMessage, isScoreMessage, scenarioIdOf, type CellMessage, type ReuseMessage,
  type ScoreLane, type ScoreMessage,
} from './messages.ts'
import { auditStatement } from '../lib/audit.ts'
import { formatBuildId } from '../lib/ids.ts'
import type { CellResult, RescoreRequest } from '../board/types.ts'

export const SCORE_DLQ = 'lb-score-dlq'
/** wall time a deployed batch runs before returning its remaining messages, well inside the 5 minute cpu cap. */
export const BATCH_BUDGET_MS = 120_000
/** local dev: seconds a cell waits before retrying an unresponsive local scorer. */
export const SCORER_WAIT_S = 30
/** attempts at a reuse message before its job is scored whole instead. */
export const REUSE_ATTEMPTS = 3

export const laneQueue = (env: Pick<ScorerEnv, 'SCORE_QUEUE' | 'SCORE_BULK_QUEUE'>, lane: ScoreLane | undefined) =>
  lane === 'bulk' ? env.SCORE_BULK_QUEUE ?? env.SCORE_QUEUE : env.SCORE_QUEUE

/** a message's results for its board, and (a reuse message's) the cells the board is to score in groups. */
type Scored = { message: Message<unknown>; body: ScoreMessage; results: CellResult[]; rescore?: RescoreRequest[] }

/** a reuse message's cells to score, as the board takes them back. */
const rescoreOf = (body: ReuseMessage, cells: Array<Pick<CellMessage, 'cell'>>): RescoreRequest[] =>
  cells.length ? [{ rs: body.rs, local: body.local, gen: body.gen, cells: cells.map((cell) => cell.cell) }] : []

/** each board's results (and cells to score) in one call; a board that fails sends its messages back to retry. */
async function deliver(env: ScorerEnv, scored: Scored[]): Promise<void> {
  const byBoard = new Map<number, Scored[]>()
  for (const entry of scored) byBoard.set(entry.body.res, [...byBoard.get(entry.body.res) ?? [], entry])
  await Promise.all([...byBoard].map(async ([resonator, entries]) => {
    try {
      await boardOf(env, resonator).recordScores(resonator, entries.flatMap((entry) => entry.results),
        entries.flatMap((entry) => entry.rescore ?? []))
    } catch (error) {
      console.error('recording scores failed', resonator, error)
      for (const entry of entries) entry.message.retry({ delaySeconds: 10 })
      return
    }
    for (const entry of entries) entry.message.ack()
  }))
}

/** handles a rollout's reuse message: kept cells go to the board, and the rest go out as cells after. */
async function reuseOne(env: ScorerEnv, message: Message<unknown>, body: ReuseMessage, services: ScorerServices, scored: Scored[]) {
  let outcome: ReuseOutcome
  try {
    outcome = await (services.reuse ?? reuseCells)(env, body)
  } catch (error) {
    console.error('reuse failed', `${formatBuildId({ resonator: body.res, local: body.local })}@${body.fid}->${body.rid}`, error)
    if (message.attempts < REUSE_ATTEMPTS) {
      message.retry({ delaySeconds: 30 })
      return
    }
    outcome = { results: [], rescore: body.cells, kept: 0, rescaled: 0 }
  }
  console.log(`reuse ${formatBuildId({ resonator: body.res, local: body.local })} ${body.fid} -> ${body.rid}: ${outcome.kept} kept, ${outcome.rescaled} rescaled, ${outcome.rescore.length} to score`)
  // what it kept and what it did not reach the board together: the board records the one and stages the other.
  scored.push({ message, body, results: outcome.results, rescore: rescoreOf(body, outcome.rescore) })
}

// malformed input is acked at once; a cell is acked only after its board recorded it.
export async function consumeScores(batch: MessageBatch<unknown>, env: ScorerEnv, services: ScorerServices = {}): Promise<void> {
  const scored: Scored[] = []
  const one = async (message: Message<unknown>) => {
    const body = message.body
    if (isReuseMessage(body)) {
      await reuseOne(env, message, body, services, scored)
      return
    }
    if (!isCellMessage(body) && !isGroupMessage(body)) {
      console.error('dropping malformed score message', body)
      message.ack()
      return
    }
    try {
      scored.push({ message, body, results: isGroupMessage(body) ? await scoreGroup(env, body, services) : [await scoreCell(env, body, services)] })
    } catch (error) {
      // the local scorer is down: the cell goes back as a new message, so waiting for it spends no attempt.
      if (error instanceof LocalScorerUnavailable) {
        await laneQueue(env, body.lane).send(body, { delaySeconds: SCORER_WAIT_S })
        message.ack()
        return
      }
      // snapshot conflicts retry in another isolate; scorer-version mismatches wait longer before another attempt.
      const delaySeconds = error instanceof ScoringDataConflict ? 60
        : error instanceof RulesetError && error.code === 'version' ? 600 : 30
      console.error('score failed', isGroupMessage(body) ? `${body.builds.length} builds of ${body.res}@${body.rid}:${body.key}`
        : `${formatBuildId({ resonator: body.res, local: body.local })}@${body.rid}:${body.key}`, error)
      message.retry({ delaySeconds })
    }
  }
  // local dev sends cells to the node scorer pool and only awaits it, so a batch goes out at once and the pool queues
  // it (dev:full gives the bulk lane batches of 100; tools/lib/devScorerConfig.mjs); a deployed isolate scores on its
  // own thread one message at a time and resends the rest of a batch past the budget as new messages
  if (env.LOCAL_SCORER_URL && !services.execute && !services.generate) {
    await Promise.all(batch.messages.map(one))
    await deliver(env, scored)
    return
  }
  const started = Date.now()
  for (const [index, message] of batch.messages.entries()) {
    if (index > 0 && Date.now() - started > BATCH_BUDGET_MS) {
      const rest = batch.messages.slice(index)
      const bodies = rest.map((m) => m.body).filter(isScoreMessage)
      for (const lane of ['interactive', 'bulk'] as const) {
        const sent = bodies.filter((body) => (body.lane ?? 'interactive') === lane)
        if (sent.length) await laneQueue(env, lane).sendBatch(sent.map((body) => ({ body })))
      }
      for (const m of rest) m.ack()
      break
    }
    await one(message)
  }
  await deliver(env, scored)
}

/** lb-score-dlq: records cells that failed every attempt as errors on their board, which lets their jobs finish. */
export async function settleDeadScores(batch: MessageBatch<unknown>, env: ScorerEnv, now = Date.now()): Promise<void> {
  const audits: D1PreparedStatement[] = []
  for (const message of batch.messages) {
    const body = message.body
    // a reuse message that died is its job scored whole: every cell goes to the board to be scored in groups.
    if (isReuseMessage(body)) {
      try {
        await boardOf(env, body.res).recordScores(body.res, [], rescoreOf(body, body.cells))
      } catch (error) {
        console.error('dead reuse not handed back', body.res, body.local, error)
        message.retry({ delaySeconds: 30 })
        continue
      }
    } else if (isCellMessage(body) || isGroupMessage(body)) {
      // a dead group is each of its builds' cell dead.
      const cells = isGroupMessage(body) ? cellMessagesOfGroup(body) : [body]
      try {
        for (const cell of cells) await boardOf(env, cell.res).deadCell(cell.res, cell)
      } catch (error) {
        console.error('dead cell not recorded', body.res, error)
        message.retry({ delaySeconds: 30 })
        continue
      }
      // what /admin/health counts.
      for (const cell of cells) {
        audits.push(auditStatement(env.LB, { actorKind: 'system', actorId: null, action: 'score.dead_letter', subjectKind: 'build',
          subjectId: formatBuildId({ resonator: cell.res, local: cell.local }),
          data: { ruleset: cell.rid, scenario: scenarioIdOf(cell), attempts: message.attempts } }, now))
      }
    }
    message.ack()
  }
  if (audits.length) await env.LB.batch(audits)
}

/**
 * POST /fill { a group message }: scores the group's builds with full breakdowns and returns cell results for the
 * requesting board (BoardDO.fill) to record; reachable only through the api's SCORER binding, since the scorer has no url.
 */
export async function fillRequest(request: Request, env: ScorerEnv, services: ScorerServices = {}): Promise<Response> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/fill') return new Response('not found', { status: 404 })
  const body = await request.json().catch(() => null)
  if (!isGroupMessage(body)) return Response.json({ error: 'a group message' }, { status: 400 })
  try {
    const results = await scoreGroup(env, body, services, 'full')
    return Response.json(results.map((result) => ({ ...result, timing: undefined })))
  } catch (error) {
    console.error('fill failed', `${body.builds.length} builds of ${body.res}@${body.rid}:${body.key}`, error)
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export default {
  // lb-score and lb-score-bulk run the same consumer; only their backlogs are apart.
  queue: (batch, env) => batch.queue === SCORE_DLQ ? settleDeadScores(batch, env, Date.now()) : consumeScores(batch, env),
  fetch: (request, env) => fillRequest(request, env),
} satisfies ExportedHandler<ScorerEnv, unknown>
