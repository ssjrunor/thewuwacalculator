/*
  Author: Runor Ewhro
  description: staff commands across every board of a ruleset: sync each board
               with the catalog now (boards sync every 30 seconds otherwise) and
               sum their jobs. installs, rollouts and go-live run per board from
               the catalog (BoardDO.syncCatalog).
*/

import type { ApiEnv } from '../env.ts'
import { rulesetResonators } from '../db/rulesets.ts'
import { boardOf } from './stubs.ts'

export interface JobTotals {
  scoring: number
  scored: number
  failed: number
  /** kept builds on the boards counted. */
  builds: number
  /** boards that have sent every kept build its job on the ruleset, and written its entries. */
  settled: number
  /** boards that have the ruleset installed, of those it scores. */
  installed: number
  boards: number
}

/** every board the ruleset scores looks at the catalog now; returns their job totals. */
export async function rulesetJobs(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, rulesetId: string, { force = true } = {}): Promise<JobTotals> {
  const resonators = await rulesetResonators(env.LB, rulesetId)
  const each = await Promise.all(resonators.map((id) => boardOf(env, id).jobs(Number(id), rulesetId, { force })))
  const totals: JobTotals = { scoring: 0, scored: 0, failed: 0, builds: 0, settled: 0, installed: 0, boards: resonators.length }
  for (const jobs of each) {
    if (!jobs) continue
    totals.installed += 1
    if (jobs.settled) totals.settled += 1
    totals.scoring += jobs.scoring
    totals.scored += jobs.scored
    totals.failed += jobs.failed
    totals.builds += jobs.builds
  }
  return totals
}

/** every board the ruleset scores looks at the catalog now. */
export async function syncBoards(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, rulesetId: string): Promise<void> {
  await rulesetJobs(env, rulesetId)
}

/** every board has the ruleset, has sent each kept build its job and written its entries, and no job is still scoring. */
export const rolledOut = (totals: JobTotals) =>
  totals.installed === totals.boards && totals.settled === totals.boards && totals.scoring === 0
