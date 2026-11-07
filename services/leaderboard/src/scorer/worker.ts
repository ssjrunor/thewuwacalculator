/*
  Author: Runor Ewhro
  description: processes score messages, retries failures, and records dead-letter outcomes.
*/

import { RulesetError, ScoringDataConflict } from '@/engine/leaderboard'
import type { ScorerEnv } from '../env.ts'
import { fanOut, scoreOne, type ScorerServices } from './job.ts'
import { isScoreMessage, type ScoreMessage } from './messages.ts'
import { failJobStatement, recordScore } from '../db/scores.ts'
import { auditStatement } from '../lib/audit.ts'
import { finalizeJob } from './finalize.ts'

export const SCORE_DLQ = 'lb-score-dlq'

// acknowledge malformed input immediately; successful work is acknowledged only after all awaited writes finish.
export async function consumeScores(batch: MessageBatch<unknown>, env: ScorerEnv, services: ScorerServices = {}): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body
    if (!isScoreMessage(body)) {
      console.error('dropping malformed score message', body)
      message.ack()
      continue
    }
    try {
      if (body.kind === 'fanout') await fanOut(env, body, Date.now())
      else await scoreOne(env, body, { now: Date.now(), ...services })
      message.ack()
    } catch (error) {
      // snapshot conflicts retry in another isolate; scorer-version mismatches receive a longer delay before another attempt.
      const delaySeconds = error instanceof ScoringDataConflict ? 60
        : error instanceof RulesetError && error.code === 'version' ? 600 : 30
      console.error('score failed', describe(body), error)
      message.retry({ delaySeconds })
    }
  }
}

/**
 * lb-score-dlq: a scenario that failed every attempt is recorded as an error
 * row, so the job still completes and the build is boarded on what did score.
 * a fan-out that never ran fails its job (a rescore starts it again).
 */
// record exhausted scenario attempts as error rows and finalize complete jobs; an exhausted fan-out fails its job.
export async function settleDeadScores(batch: MessageBatch<unknown>, env: ScorerEnv, now: number): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body
    if (isScoreMessage(body)) {
      if (body.kind === 'scenario') {
        const job = await recordScore(env.LB, body.buildId, body.rulesetId, {
          scenario_id: body.scenarioId, status: 'error', damage: null, duration: null, dps: null, score: null, flags: 0,
          program_sha256: null, error: 'dead_lettered',
        }, now)
        if (job && job.status === 'scoring' && job.done >= job.expected) await finalizeJob(env, body.buildId, body.rulesetId, now)
      } else {
        await failJobStatement(env.LB, body.buildId, body.rulesetId, now).run()
      }
      await auditStatement(env.LB, { actorKind: 'system', actorId: null, action: 'score.dead_letter', subjectKind: 'build',
        subjectId: body.buildId, data: { ruleset: body.rulesetId, scenario: body.kind === 'scenario' ? body.scenarioId : null,
          attempts: message.attempts } }, now).run()
    }
    message.ack()
  }
}

const describe = (message: ScoreMessage) =>
  message.kind === 'fanout' ? `${message.buildId}@${message.rulesetId}` : `${message.buildId}@${message.scenarioId}`

export default {
  queue: (batch, env) => batch.queue === SCORE_DLQ ? settleDeadScores(batch, env, Date.now()) : consumeScores(batch, env),
} satisfies ExportedHandler<ScorerEnv, unknown>
