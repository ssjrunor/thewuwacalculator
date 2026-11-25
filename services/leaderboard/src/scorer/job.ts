/*
  Author: Runor Ewhro
  description: scores one cell of a build's job, or one cell of many builds'
               jobs (a group message: builds sharing a program, scored on one
               program with scoreScenarioGroup). messages include the builds'
               snapshots, so only the ruleset is read; results go back to the
               builds' board (worker.ts), which counts each once and finishes a
               job on its last cell.
*/

import {
  cardBuildStats, executeScoringRotation, offlineAnchorExecutor, overPerfect, scoreScenario, scoreScenarioGroup, withStoredRotations,
  type RotationExecutor, type RotationGenerator, type RotationStore, type ScenarioScore, type ScenarioScoringContext,
  type ScoringSession,
} from '@lb/scoring'
import type { BuildSnapshot } from '@lb/contract/snapshot'
import { getRuleset } from '../db/rulesets.ts'
import { packStats } from '../lib/statsPack.ts'
import { unpackSnapshot } from '../lib/snapshotPack.ts'
import type { ScorerEnv } from '../env.ts'
import { loadScoringSession } from './loadRuleset.ts'
import { fromBase64, scenarioIdOf, type CellDetail, type CellMessage, type GroupMessage, type ReuseMessage } from './messages.ts'
import type { ReuseOutcome } from './reuse.ts'
import type { CellResult } from '../board/types.ts'

// the generator sha injected at deploy (npm run deploy:scorer, tools/deploy-scorer.mjs); without it (wrangler dev)
// stored rotations are keyed by the package's generator
declare const LB_GENERATOR_SHA: string | undefined
const runningGenerator = typeof LB_GENERATOR_SHA === 'string' ? LB_GENERATOR_SHA : null

/** display notes on a score. */
export const SCORE_FLAGS = {
  /** generated and executed, but the scenario has no reference values for this sequence. */
  noRefs: 1,
  /** scored past the perfect build (200): its perfect anchor missed a build, a defect to look into (/admin/health). */
  overPerfect: 2,
  /** scored lean: its detail has no breakdown yet (CellDetail.lean); the board fills it when it is asked for. */
  lean: 4,
} as const

/** stored rotations in R2 (src/engine/leaderboard/rotationStore.ts), by content key. */
function bucketRotations(bucket: R2Bucket): RotationStore {
  return {
    async get(key) {
      const object = await bucket.get(`rotation-store/${key}.json`)
      return object ? object.text() : null
    },
    async put(key, text) {
      await bucket.put(`rotation-store/${key}.json`, text, { httpMetadata: { contentType: 'application/json' } })
    },
  }
}

/** executes the generated program with the ruleset's loaded game data and searches its own anchors; sessions with
    offline anchors use them through offlineAnchorExecutor. */
export const executeRotation: RotationExecutor = executeScoringRotation

/** what scoring reaches beyond the bindings; tests substitute these. */
export interface ScorerServices {
  execute?: RotationExecutor
  generate?: RotationGenerator
  /** a rollout's reuse decision (reuse.ts reuseCells). */
  reuse?: (env: ScorerEnv, message: ReuseMessage) => Promise<ReuseOutcome>
}

/** thrown when the local scorer does not respond; the message is retried for it because workerd cannot finish a long
    anchor search and would stall the queue (worker.ts). */
export class LocalScorerUnavailable extends Error {
  constructor(url: string) {
    super(`local scorer not reachable at ${url}`)
    this.name = 'LocalScorerUnavailable'
  }
}

/** local dev only: the scenario scored by tools/local-scorer.mjs in node, off the workerd thread. */
async function scoreInNode(env: ScorerEnv, url: string, message: CellMessage, snapshot: BuildSnapshot): Promise<ScenarioScore> {
  const ruleset = await getRuleset(env.LB, message.rid)
  if (!ruleset) throw new Error(`ruleset ${message.rid} is not published`)
  let response: Response
  try {
    response = await fetch(`${url}/score`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rulesetId: message.rid, manifestSha256: ruleset.manifest_sha256, scenarioId: scenarioIdOf(message),
        lane: message.lane ?? 'interactive', snapshot }) })
  } catch {
    throw new LocalScorerUnavailable(url)
  }
  if (!response.ok) throw new Error(`local scorer: ${response.status} ${await response.text()}`)
  return await response.json() as ScenarioScore
}

/** a substituted generator (tests) neither reads nor stores programs: what it makes is not the generator's. */
const withGenerator = (context: ScenarioScoringContext, services: ScorerServices): ScenarioScoringContext =>
  services.generate ? { ...context, generate: services.generate, programs: undefined } : context

/** a ruleset's scoring context as the scorer scores with it: programs found and kept in the stored rotations (R2). */
export function storedContext(env: ScorerEnv, session: ScoringSession, services: ScorerServices = {}): ScenarioScoringContext {
  const { context } = withStoredRotations(session.context(services.execute ?? offlineAnchorExecutor((id) => session.ruleset.anchorsFor(id))),
    bucketRotations(env.LB_DATA), session.ruleset, runningGenerator)
  return withGenerator(context, services)
}

/** share of builds given a shared program that also generate their own to check it (LB_PROGRAM_CHECK). */
const PROGRAM_CHECK = 0.02
/** the share of builds measured by a group's compiled program that are also replayed to check it (LB_DAMAGE_CHECK). */
const DAMAGE_CHECK = 0.02

/** a group of this many builds or more records one build's timing in this many (scoreGroup). */
export const TIMING_SAMPLE = 20

/** the board record of a scored cell and its detail; unrated injected-executor results are unsupported. */
export function cellResult(message: Pick<CellMessage, 'rs' | 'local' | 'gen' | 'cell' | 'key'>, score: ScenarioScore): CellResult {
  const unrated = score.status === 'ok' && score.score == null
  const over = !unrated && overPerfect(score.score)
  if (over) console.warn(`over perfect: ${score.scenarioId} scored ${score.score} (anchors ${JSON.stringify(score.anchors)})`)
  const status = unrated ? 'unsupported' : score.status
  const detail: CellDetail = {
    contribution: score.contribution, input: score.input,
    anchors: score.anchors ? { baselineDamage: score.anchors.baselineDamage, benchDamage: score.anchors.benchDamage,
      perfectDamage: score.anchors.perfectDamage } : null,
    deps: score.reads ? { reads: score.reads, energyRegen: score.energyRegen, anchorKey: score.anchorKey, anchorSource: score.anchorSource,
      ...(score.erRepair ? { erRepair: score.erRepair } : {}) } : null,
    program: score.programSha256,
    ...(status === 'ok' ? {} : { detail: score.detail }),
    ...(score.lean ? { lean: true as const } : {}),
  }
  return {
    rs: message.rs, local: message.local, gen: message.gen, cell: message.cell, status,
    score: unrated ? null : score.score, damage: score.damage, dpr: score.dpr ?? score.contribution?.damage ?? null,
    flags: (unrated ? SCORE_FLAGS.noRefs : 0) | (over ? SCORE_FLAGS.overPerfect : 0) | (score.lean ? SCORE_FLAGS.lean : 0), reason: score.reason,
    weapon: Number(message.key.split(':')[2]), stats: score.stats ? packStats(score.stats) : null, detail: JSON.stringify(detail),
  }
}

export async function scoreCell(env: ScorerEnv, message: CellMessage, services: ScorerServices = {}): Promise<CellResult> {
  const snapshot = unpackSnapshot(fromBase64(message.snap))
  const local = env.LOCAL_SCORER_URL && !services.execute && !services.generate ? env.LOCAL_SCORER_URL : null
  // a worker's clock advances only on i/o: this reads the last i/o time, and the read after scoring closes the span
  const started = Date.now()
  let score = local ? await scoreInNode(env, local, message, snapshot) : null
  const runner = local ? 'node' : 'worker'
  const session = !score || message.cs ? await loadScoringSession(env, message.rid) : null
  if (!score) {
    const def = session!.ruleset.defById.get(scenarioIdOf(message))
    if (!def) throw new Error(`scenario ${scenarioIdOf(message)} is not in ruleset ${message.rid}`)
    score = await scoreScenario(snapshot, def, storedContext(env, session!, services))
  }
  const result = cellResult(message, score)
  // card stats: the submitted build alone (its weapon, no teammates), shown until a cell scores it; a failed rebuild
  // leaves the board's stats unchanged
  if (message.cs) {
    try {
      const stats = await cardBuildStats(snapshot)
      result.cardStats = stats ? packStats(stats) : null
    } catch {
      // kept out: the board keeps what it has.
    }
  }
  // `ms` is the scenario's own work: the node thread's clock (the wall span includes waiting for a free thread), or
  // the wall span in a worker
  const wall = Math.max(0, Date.now() - started)
  result.timing = {
    lane: message.lane ?? 'interactive', runner, wallMs: wall,
    ms: runner === 'node' && score.timing?.total != null ? Math.round(score.timing.total) : wall,
    stages: score.timing ? JSON.stringify(Object.fromEntries(Object.entries(score.timing).map(([stage, ms]) => [stage, Math.round(ms)]))) : null,
    anchorSource: score.anchorSource,
  }
  return result
}

/** local dev only: a group scored by tools/local-scorer.mjs on one node thread. */
async function scoreGroupInNode(env: ScorerEnv, url: string, message: GroupMessage, snapshots: BuildSnapshot[],
  detail: 'full' | 'lean'): Promise<ScenarioScore[]> {
  const ruleset = await getRuleset(env.LB, message.rid)
  if (!ruleset) throw new Error(`ruleset ${message.rid} is not published`)
  let response: Response
  try {
    response = await fetch(`${url}/score-group`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rulesetId: message.rid, manifestSha256: ruleset.manifest_sha256, scenarioId: scenarioIdOf(message), snapshots,
        programCheck: programCheckOf(env), damageCheck: damageCheckOf(env), detail }) })
  } catch {
    throw new LocalScorerUnavailable(url)
  }
  if (!response.ok) throw new Error(`local scorer: ${response.status} ${await response.text()}`)
  return await response.json() as ScenarioScore[]
}

/** a setting that reads as a share (0 to 1), else `fallback`. */
const shareOf = (setting: string | undefined, fallback: number) => {
  const value = Number(setting)
  return setting != null && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback
}

/** what share of reused programs a group checks: LB_PROGRAM_CHECK when it reads as a share, else PROGRAM_CHECK. */
export const programCheckOf = (env: Pick<ScorerEnv, 'LB_PROGRAM_CHECK'>): number => shareOf(env.LB_PROGRAM_CHECK, PROGRAM_CHECK)

/** what share of compiled measurements a group checks against the replay: LB_DAMAGE_CHECK, else DAMAGE_CHECK. */
export const damageCheckOf = (env: Pick<ScorerEnv, 'LB_DAMAGE_CHECK'>): number => shareOf(env.LB_DAMAGE_CHECK, DAMAGE_CHECK)

/** detail level of bulk group scores: lean (no breakdown, filled when a board page or build requests it) unless
    LB_LEAN_BULK is '0'; the interactive lane always scores full. */
export const detailOf = (env: Pick<ScorerEnv, 'LB_LEAN_BULK'>): 'full' | 'lean' => env.LB_LEAN_BULK === '0' ? 'full' : 'lean'

/**
 * scores one cell of every build in a group message with one program per program key (scoreScenarioGroup), each build
 * with its own result; builds whose reused program differed in a check are logged and scored on their own program.
 */
export async function scoreGroup(env: ScorerEnv, message: GroupMessage, services: ScorerServices = {},
  detail: 'full' | 'lean' = detailOf(env)): Promise<CellResult[]> {
  const snapshots = message.builds.map((build) => unpackSnapshot(fromBase64(build.snap)))
  const local = env.LOCAL_SCORER_URL && !services.execute && !services.generate ? env.LOCAL_SCORER_URL : null
  const started = Date.now()
  let scores = local ? await scoreGroupInNode(env, local, message, snapshots, detail) : null
  const runner = local ? 'node' : 'worker'
  const session = !scores || message.builds.some((build) => build.cs) ? await loadScoringSession(env, message.rid) : null
  if (!scores) {
    const def = session!.ruleset.defById.get(scenarioIdOf(message))
    if (!def) throw new Error(`scenario ${scenarioIdOf(message)} is not in ruleset ${message.rid}`)
    // one executor for the group, so builds that share an evaluation context measure on one (execute.ts).
    scores = await scoreScenarioGroup(snapshots, def, storedContext(env, session!, services),
      { programCheck: programCheckOf(env), damageCheck: damageCheckOf(env), detail })
  }
  const wall = Math.max(0, Date.now() - started)
  const results: CellResult[] = []
  // large groups time one build in TIMING_SAMPLE from a random start, which keeps the board's means unbiased (the first
  // build includes the group's compile) and writes a twentieth of the rows in a rollout
  const sampled = message.builds.length >= TIMING_SAMPLE ? Math.floor(Math.random() * TIMING_SAMPLE) : -1
  for (const [index, build] of message.builds.entries()) {
    const score = scores[index]
    if (score.programMismatch) console.error(`program key mismatch: ${score.scenarioId} build ${build.local}; the scenario no longer shares programs`)
    if (score.damageMismatch) console.error(`compiled damage mismatch: ${score.scenarioId} build ${build.local}; the group was replayed`)
    const result = cellResult({ rs: message.rs, local: build.local, gen: build.gen, cell: message.cell, key: message.key }, score)
    if (build.cs) {
      try {
        const stats = await cardBuildStats(snapshots[index])
        result.cardStats = stats ? packStats(stats) : null
      } catch {
        // kept out: the board keeps what it has.
      }
    }
    results.push(result)
    if (sampled >= 0 && index % TIMING_SAMPLE !== sampled) continue
    // a node thread times each build; in a worker the clock advances only on i/o, so each build gets an equal share of the span
    result.timing = {
      lane: 'bulk', runner, wallMs: Math.round(wall / message.builds.length),
      ms: runner === 'node' && score.timing?.total != null ? Math.round(score.timing.total) : Math.round(wall / message.builds.length),
      stages: score.timing ? JSON.stringify(Object.fromEntries(Object.entries(score.timing).map(([stage, ms]) => [stage, Math.round(ms)]))) : null,
      anchorSource: score.anchorSource,
    }
  }
  return results
}
