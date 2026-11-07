/*
  Author: Runor Ewhro
  description: queues scenario jobs and records their generated programs and scores.
*/

import {
  pendingRotationExecutor, scoreScenario, type RotationExecutor, type RotationGenerator, type ScenarioScore,
} from '@/engine/leaderboard'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import { getBuild } from '../db/builds.ts'
import { getRead } from '../db/cards.ts'
import { scenariosFor } from '../db/rulesets.ts'
import { recordScore, SCORE_FLAGS, startJobStatements, type NewScore } from '../db/scores.ts'
import type { ScorerEnv } from '../env.ts'
import { loadScoringSession } from './loadRuleset.ts'
import { finalizeJob } from './finalize.ts'
import type { ScoreMessage } from './messages.ts'

/** returns `rotation_execution_pending` until a damage executor is connected. */
export const executeRotation: RotationExecutor = pendingRotationExecutor

// reset the job before sending scenario messages; an empty scenario set finalizes immediately.
export async function fanOut(env: ScorerEnv, message: Extract<ScoreMessage, { kind: 'fanout' }>, now: number): Promise<number> {
  const build = await getBuild(env.LB, message.buildId)
  if (!build || build.state !== 'active') return 0
  const scenarios = await scenariosFor(env.LB, message.rulesetId, build.resonator_id)
  await env.LB.batch(startJobStatements(env.LB, build.id, message.rulesetId, scenarios.length, now))
  if (scenarios.length === 0) {
    await finalizeJob(env, build.id, message.rulesetId, now)
    return 0
  }
  // send scenarios in groups of at most 100 while preserving each scenario's stable id.
  for (let start = 0; start < scenarios.length; start += 100) {
    await env.SCORE_QUEUE.sendBatch(scenarios.slice(start, start + 100).map((scenario) => ({
      body: { kind: 'scenario' as const, buildId: build.id, rulesetId: message.rulesetId, scenarioId: scenario.id },
    })))
  }
  return scenarios.length
}

/** a ScenarioScore as a build_scores row. a scored run without refs keeps its numbers but is not `ok`. */
export function scoreRow(score: ScenarioScore): NewScore {
  const unrated = score.status === 'ok' && score.score == null
  return {
    scenario_id: score.scenarioId,
    status: unrated ? 'unsupported' : score.status,
    damage: score.damage,
    duration: score.duration,
    dps: score.dps,
    score: unrated ? null : score.score,
    flags: unrated ? SCORE_FLAGS.noRefs : 0,
    program_sha256: score.programSha256,
    error: score.reason,
  }
}

/** what scoring reaches beyond the bindings; tests substitute these. */
export interface ScorerServices {
  execute?: RotationExecutor
  generate?: RotationGenerator
}

export async function scoreOne(env: ScorerEnv, message: Extract<ScoreMessage, { kind: 'scenario' }>,
  options: { now: number } & ScorerServices): Promise<'scored' | 'skipped'> {
  const build = await getBuild(env.LB, message.buildId)
  if (!build || build.state !== 'active') return 'skipped'
  const read = await getRead(env.LB, build.read_id)
  if (!read?.snapshot) return 'skipped'
  const session = await loadScoringSession(env, message.rulesetId)
  const def = session.ruleset.defById.get(message.scenarioId)
  if (!def) throw new Error(`scenario ${message.scenarioId} is not in ruleset ${message.rulesetId}`)
  const snapshot = JSON.parse(read.snapshot) as BuildSnapshot
  const context = session.context(options.execute ?? executeRotation)
  const score = await scoreScenario(snapshot, def, options.generate ? { ...context, generate: options.generate } : context)
  // content-addressed program keys reuse identical generated rotations across builds and retries.
  if (score.programSha256 && score.programText) {
    const key = `rotations/${score.programSha256}.json`
    if (!await env.LB_DATA.head(key)) {
      await env.LB_DATA.put(key, score.programText, { httpMetadata: { contentType: 'application/json' } })
    }
  }
  // the score write returns the current completion count; only complete scoring jobs attempt finalization.
  const job = await recordScore(env.LB, build.id, message.rulesetId, scoreRow(score), options.now)
  if (job && job.status === 'scoring' && job.done >= job.expected) await finalizeJob(env, build.id, message.rulesetId, options.now)
  return 'scored'
}
