/*
  Author: Runor Ewhro
  description: selects a completed job's best scenario and updates the build's board entry.
*/

import { pickBest } from '@/engine/leaderboard'
import { getBuild } from '../db/builds.ts'
import { finishJob, scoresFor } from '../db/scores.ts'
import type { ScorerEnv } from '../env.ts'

export async function finalizeJob(env: ScorerEnv, buildId: string, rulesetId: string, now: number): Promise<boolean> {
  const build = await getBuild(env.LB, buildId)
  if (!build) return false
  const rows = await scoresFor(env.LB, buildId, rulesetId)
  // inactive builds remove their board entry even when the completed job contains a valid score.
  const best = pickBest(rows.map((row) => ({ ...row, scenarioId: row.scenario_id })))
  return finishJob(env.LB, { buildId, rulesetId }, {
    resonatorId: build.resonator_id, uid: build.uid, sequence: build.sequence,
    best: best && build.state === 'active' ? { scenario_id: best.scenario_id, score: best.score!, dps: best.dps! } : null,
  }, now)
}
