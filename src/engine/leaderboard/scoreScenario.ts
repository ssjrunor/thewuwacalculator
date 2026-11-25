/*
  Author: Runor Ewhro
  description: scores one build in one scenario: card + scenario -> scenario
               input -> CombatScenario -> generated rotation program -> executed
               full team build evaluation -> score and display contribution. a
               step that cannot continue ends the row as `unsupported` (build or
               kit outside what can be scored) or `error` (a failure), with no
               zero score. running the program for damage is the injected
               `execute` step, which lets callers pick the executor.
*/

import type { CombatScenario } from '@/domain/entities/combatScenario'
import type { ScenarioDef, ScenarioRefs } from '@/domain/leaderboard/ruleset'
import type { BuildStats, ScoredContribution } from '@/domain/leaderboard/api'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import type { ScenarioInput } from '@/domain/leaderboard/scenarioInput'
import type { ActionPlan } from '@/domain/rotationActions/types'
import { ensureResonatorData } from '@/data/gameData'
import { interpretTeamActions, interpretedProgram, rebaseInterpretation, type InterpretationResult, type InterpretedProgram,
  type InterpreterEnvironment } from '@/engine/rotationGen'
import { canonicalJson, sha256Hex } from '@/domain/leaderboard/canonical'
import { createScenario, scenarioResonatorIds } from './scenario'
import { buildScenarioInput, type ScenarioInputDeps } from './scenarioInput'
import { buildScore } from './scoreFormula'
import { scenarioBuildStats } from './buildStats'
import type { ResolvedTeammate } from './teammateBuilds'
import { hasScoringData } from './coverage'
import type { ScoreAnchors } from './scoreFormula'
import { withInputPeaks, type PeakControls } from './peakControls'
import { scenarioReads } from './scoreReads'
import type { ErRepair } from '@/engine/evaluation/erRepair'
import type { ProgramShelf } from './rotationStore'

/** milliseconds per scoring stage, used only for health and cost ordering and not stored with the score; in a worker
    isolate the clock advances only on i/o, so stages there read 0. */
export type ScoreTiming = Record<string, number>

const clock = () => globalThis.performance?.now() ?? Date.now()

/** the group a build is scored in (scoreScenarioGroup), with the state an executor may share across its builds; one
    object per group, so executors distinguish groups by identity. */
export interface ExecutionGroup {
  /** every (echo id, set) pair the group's builds wear in the scored seat. */
  worn: ReadonlyArray<readonly [string, number]>
  /** the group's builds still to execute, this one included. */
  left(): number
  /** the share (0 to 1) of builds measured compiled that are also replayed and compared. */
  damageCheck: number
  /** minimum remaining builds for compiling to pay off; the executor's default when absent. */
  compileMin?: number
  random: () => number
}

/** what the executor is handed: the scenario with its generated program. */
export interface ExecutionRequest {
  def: ScenarioDef
  input: ScenarioInput
  scenario: CombatScenario
  /** absent when the build is scored alone. */
  group?: ExecutionGroup
  /** 'lean' lets an executor skip breakdown-only work (the run's contribution, contribution.team and peaks) when it can
        compute the scored seat's DPR without them; full when absent. */
  detail?: 'full' | 'lean'
}

export type ExecutionResult =
  | { status: 'ok'; damage: number; score?: number; anchors?: ScoreAnchors; contribution?: ScoredContribution
      /** the offline anchor state the score used (offlineAnchors.ts anchorStateKey); absent when anchors were searched. */
      anchorKey?: string
      /** the build's final energy regen, when the executor measured it. */
      energyRegen?: number
      /** each member's conditions at the highest value the run held them; kept on the stored input. */
      peaks?: PeakControls
      /** the energy regen repair the score was taken on (evaluation/erRepair.ts); absent when none was needed. */
      erRepair?: ErRepair
      /** the executor's stage timings (execute.ts): run, damage, search. */
      timing?: ScoreTiming
      /** how damage was measured (execute.ts measureFor): the program replayed, or compiled for the group. */
      damageModel?: 'replay' | 'compiled'
      /** the compiled program measured a build unlike the replay: it and the rest of its group were replayed. */
      damageMismatch?: true
      /** the scored seat's own damage per rotation from its breakdown (contribution.damage), set without a contribution
                on a lean result. */
      dpr?: number
      /** a lean result: no contribution or peaks; `dpr` stands for the contribution's damage. */
      lean?: true
      /** the compiled DPR differed from a full run's: the context went back to full runs. */
      dprMismatch?: true }
  | { status: 'unsupported' | 'error'; reason: string; detail?: unknown; timing?: ScoreTiming }

/** runs a generated program and totals its damage. */
export type RotationExecutor = (request: ExecutionRequest) => Promise<ExecutionResult>

/** the executor until rotation execution is connected: every program is reported, nothing is scored. */
export const pendingRotationExecutor: RotationExecutor = async () =>
  ({ status: 'unsupported', reason: 'rotation_execution_pending' })

/** generates a team's program on a scenario; the rotation generator unless a caller substitutes one. */
export type RotationGenerator = (plan: ActionPlan, scenario: CombatScenario) => Promise<InterpretationResult>

/** the stored, content-addressed rotation behind a score (LB_DATA rotations/<sha256>.json). */
export interface ProgramDocument {
  v: 1
  scenarioId: string
  teamId: string
  initialOnFieldMemberId: string
  members: Array<{ id: string; resonatorId: string }>
  program: CombatScenario['program']['program']
}

export interface ScenarioScore {
  scenarioId: string
  status: 'ok' | 'unsupported' | 'error'
  damage: number | null
  contribution: ScoredContribution | null
  /** null when evaluation is unsupported or an injected executor supplies no usable score. */
  score: number | null
  program: ProgramDocument | null
  programText: string | null
  programSha256: string | null
  /** the scored seat's build stats; null when the scenario input could not be built. */
  stats: BuildStats | null
  input: ScenarioInput | null
  anchors: ScoreAnchors | null
  /** the offline anchor state behind `anchors`, null when they were searched or read from refs. */
  anchorKey: string | null
  /** the scored build's final energy regen, when the executor measured it (after any energy regen repair). */
  energyRegen: number | null
  /** the energy regen repair used for the score; null when the build met its case's requirement. a short repair scores
        0 because the build cannot sustain the rotation, and `contribution` stays the submitted build's. */
  erRepair: ErRepair | null
  /** the scored seat's own damage per rotation (the board's DPR): contribution.damage, or the compiled figure on a lean
        score; null without either. */
  dpr: number | null
  /** scored lean (ExecutionRequest.detail): no contribution or peaks; they are made when the breakdown is asked for. */
  lean?: true
  /** source of `anchors`: the ruleset's offline anchors, the executor's own search, or the ruleset's refs. */
  anchorSource: 'offline' | 'search' | 'refs' | null
  /** the ruleset units the score read (scoreReads.ts); null when the scenario input could not be built. */
  reads: string[] | null
  /** why the row is not ok: a short code, e.g. 'scenario_input', 'unconverted-character-rules'. */
  reason: string | null
  detail: unknown
  /** where the time went (ScoreTiming); absent on rows that stopped before any stage ran. */
  timing?: ScoreTiming
  /** source of the program: generated for this build, read from the store, or shared by an earlier build of the
        group; absent when no program was reached. */
  programSource?: 'generated' | 'stored' | 'shared'
  /** set when a reused program was checked against the build's own and differed; the score used the build's own. */
  programMismatch?: boolean
  /** how the executor measured damage; absent when it does not say. */
  damageModel?: 'replay' | 'compiled'
  /** the compiled program disagreed with the replay on this build; its score is the replay's. */
  damageMismatch?: boolean
  /** the compiled DPR differed from a full run's on this build's context (execute.ts). */
  dprMismatch?: boolean
}

export interface ScenarioScoringContext {
  interpreter: InterpreterEnvironment
  /** defaults to interpretTeamActions on `interpreter`. */
  generate?: RotationGenerator
  plans: Readonly<Record<string, ActionPlan>>
  teammates: ReadonlyMap<string, ResolvedTeammate>
  deps: ScenarioInputDeps
  refsFor(scenarioId: string, sequence: number): ScenarioRefs | null
  execute: RotationExecutor
  /** where programs are found and kept (rotationStore.ts withStoredRotations); without it every build generates. */
  programs?: ProgramShelf
}

/** how a group checks the programs it reuses. */
export interface GroupScoringOptions {
  /** share (0 to 1) of builds given a reused program that also generate their own and compare; default 0. */
  programCheck?: number
  /** the draw behind programCheck; Math.random by default. */
  random?: () => number
  /** called for each build's score as it finishes, in order. */
  onScore?: (score: ScenarioScore, index: number) => void
  /** share (0 to 1) of builds measured by a compiled program that are also replayed and compared; default 0. the first
        build of a group on each evaluation context is always compared (execute.ts measureFor). */
  damageCheck?: number
  /** minimum remaining builds in the group for an executor to compile a program; the executor's default when unset. */
  compileMin?: number
  /** detail level of each build's score (ExecutionRequest.detail): one for the group or one per snapshot; full when unset. */
  detail?: 'full' | 'lean' | ReadonlyArray<'full' | 'lean'>
}

/** a group's cached result per program key: the program, or the generator's refusal. */
type Remembered = { program: InterpretedProgram } | { refused: Extract<InterpretationResult, { status: 'unsupported' }> }
/** the programs a run of scores has made or read, by key: builds after the first take them from here. */
export type ProgramMemo = Map<string, Remembered>

function row(def: ScenarioDef, status: ScenarioScore['status'], reason: string | null, detail: unknown,
  extra: Partial<ScenarioScore> = {}): ScenarioScore {
  return { scenarioId: def.id, status, damage: null, dpr: null, contribution: null, score: null,
    program: null, programText: null, programSha256: null, stats: null, input: null, anchors: null, anchorKey: null,
    energyRegen: null, erRepair: null, anchorSource: null, reads: null, reason, detail, ...extra }
}

export async function scoreScenario(snapshot: BuildSnapshot, def: ScenarioDef,
  context: ScenarioScoringContext): Promise<ScenarioScore> {
  return (await scoreScenarioGroup([snapshot], def, context))[0]
}

/**
 * scores builds in one scenario in order. builds whose scored seat the generator reads the same way (programKey.ts)
 * share one program, generated once or read from `context.programs` and rebased onto each build's scenario; programs
 * the generator marks as reading build stats are not shared. each score has its own timing, with generation counted
 * on the build that generated the program.
 */
export async function scoreScenarioGroup(snapshots: readonly BuildSnapshot[], def: ScenarioDef, context: ScenarioScoringContext,
  options: GroupScoringOptions = {}): Promise<ScenarioScore[]> {
  const remembered = new Map<string, Remembered>()
  const scores: ScenarioScore[] = []
  // a ruleset parses its plans on each read (rulesetReader.ts): the group reads its scenario's once, and every build
  // keys, rebases and generates on that one (read-only) object.
  const plan = context.plans[def.teamId]
  // (spreading plans would read, and parse, every one: the others stay behind the ruleset's getters.)
  const planned: ScenarioScoringContext = plan ? { ...context,
    plans: Object.create(context.plans, { [def.teamId]: { value: plan, enumerable: true } }) as Record<string, ActionPlan> } : context
  let at = 0
  const worn = new Map<string, readonly [string, number]>()
  for (const snapshot of snapshots) for (const echo of snapshot.echoes) worn.set(`${echo.id}|${echo.set}`, [echo.id, echo.set])
  const group: ExecutionGroup | undefined = snapshots.length > 1 ? { worn: [...worn.values()], left: () => snapshots.length - at,
    damageCheck: options.damageCheck ?? 0, ...(options.compileMin != null ? { compileMin: options.compileMin } : {}),
    random: options.random ?? Math.random } : undefined
  for (const [index, snapshot] of snapshots.entries()) {
    at = index
    const timing: ScoreTiming = {}
    const started = clock()
    let mark = started
    const lap = (stage: string) => { const now = clock(); timing[stage] = now - mark; mark = now }
    const detail = typeof options.detail === 'string' ? options.detail : options.detail?.[index] ?? 'full'
    const score = { ...await scoreTimed(snapshot, def, planned, lap, timing, remembered, options, group, detail),
      timing: { ...timing, total: clock() - started } }
    scores.push(score)
    options.onScore?.(score, index)
  }
  return scores
}

/** the program text compared between a reused program and the build's own. */
const programIdentity = (result: Extract<InterpretationResult, { status: 'interpreted' }>) =>
  canonicalJson({ opener: result.scenario.initialOnFieldMemberId, program: result.scenario.program.program })

/**
 * the build's interpretation: the group's or the store's program for its key when there is one, else generated
 * (and kept under the key when it may be shared).
 */
async function programFor(plan: ActionPlan, scenario: CombatScenario, context: ScenarioScoringContext,
  remembered: Map<string, Remembered>, options: GroupScoringOptions): Promise<{ result: InterpretationResult; source: 'generated' | 'stored' | 'shared'; mismatch?: boolean }> {
  const generate = context.generate ?? ((teamPlan, teamScenario) => interpretTeamActions(context.interpreter, teamPlan, teamScenario))
  const shelf = context.programs
  const key = shelf ? await shelf.keyOf(plan, scenario, true) : null
  let reused: { program: InterpretedProgram; source: 'stored' | 'shared' } | null = null
  if (key) {
    const known = remembered.get(key)
    if (known && 'refused' in known) return { result: known.refused, source: 'shared' }
    if (known) reused = { program: known.program, source: 'shared' }
    else {
      const stored = await shelf!.get(key)
      if (stored) {
        remembered.set(key, { program: stored })
        reused = { program: stored, source: 'stored' }
      }
    }
  }
  // a program that read build stats is specific to its build: generate it (or find it under the build's own key)
  if (reused?.program.diagnostics.readsBuildStats) {
    const own = await shelf!.keyOf(plan, scenario, false)
    const stored = own ? await shelf!.get(own) : null
    if (stored) return { result: rebaseInterpretation(stored, plan, scenario, { shared: true }), source: 'stored' }
    const result = await generate(plan, scenario)
    if (own && result.status === 'interpreted') await shelf!.put(own, interpretedProgram(result))
    return { result, source: 'generated' }
  }
  if (reused) {
    const result = rebaseInterpretation(reused.program, plan, scenario, { shared: true })
    if ((options.programCheck ?? 0) > 0 && (options.random ?? Math.random)() < options.programCheck!) {
      const own = await generate(plan, scenario)
      if (own.status !== 'interpreted' || programIdentity(own) !== programIdentity(result)) {
        // the key missed something this scenario's generator reads, so every later build generates its own, here and through
        // the store; builds that used the shared program earlier keep their scores
        const unshared = { ...reused.program, diagnostics: { ...reused.program.diagnostics, readsBuildStats: true } }
        remembered.set(key!, { program: unshared })
        await shelf!.put(key!, unshared)
        return { result: own, source: 'generated', mismatch: true }
      }
    }
    return { result, source: reused.source }
  }
  const result = await generate(plan, scenario)
  if (key && result.status === 'interpreted') {
    const program = interpretedProgram(result)
    remembered.set(key, { program })
    // store under the shared key either way, where a later build reads readsBuildStats and generates its own
    await shelf!.put(key, program)
  } else if (key && result.status === 'unsupported') {
    remembered.set(key, { refused: result })
  }
  return { result, source: 'generated' }
}

/** the generator's output for evaluation as a score records it: the opener, the seats in order and the program. */
function programDocumentOf(def: ScenarioDef, scenario: CombatScenario): ProgramDocument {
  return {
    v: 1,
    scenarioId: def.id,
    teamId: def.teamId,
    initialOnFieldMemberId: scenario.initialOnFieldMemberId,
    members: scenario.team.members.map((member) => ({ id: member.id, resonatorId: member.resonatorId })),
    program: scenario.program.program,
  }
}

/**
 * hash of the program document a build would be scored with in a scenario (ScenarioScore.programSha256), using the
 * stored or shared program for its key when present, as scoring does. a rollout whose scorer changed only its
 * generator keeps old scores whose hash still matches. null when the build has no program there; `memo` caches
 * programs between calls (one per scenario).
 */
export async function scenarioProgramSha(snapshot: BuildSnapshot, def: ScenarioDef, context: ScenarioScoringContext,
  memo: ProgramMemo = new Map()): Promise<string | null> {
  if (!hasScoringData(def)) return null
  const built = buildScenarioInput(snapshot, def, context.teammates, context.deps)
  const plan = context.plans[def.teamId]
  if (!built.ok || !plan) return null
  await ensureResonatorData(scenarioResonatorIds(built.input))
  const made = await programFor(plan, createScenario(built.input), context, memo, {})
  return made.result.status === 'interpreted' ? (await programDocumentText(programDocumentOf(def, made.result.scenario))).sha : null
}

/** each shared program's document texts and hashes, keyed by the document's other contents: builds rebasing one
    program write one document, which is serialized and hashed once. shared programs are read-only (rebaseInterpretation). */
const documentTexts = new WeakMap<object, Map<string, { text: string; sha: string }>>()

async function programDocumentText(document: ProgramDocument): Promise<{ text: string; sha: string }> {
  const { program, ...rest } = document
  const head = JSON.stringify(rest)
  let byHead = documentTexts.get(program)
  const known = byHead?.get(head)
  if (known) return known
  const text = canonicalJson(document)
  const made = { text, sha: await sha256Hex(text) }
  if (!byHead) documentTexts.set(program, byHead = new Map())
  byHead.set(head, made)
  return made
}

async function scoreTimed(snapshot: BuildSnapshot, def: ScenarioDef, context: ScenarioScoringContext,
  lap: (stage: string) => void, timing: ScoreTiming, remembered: Map<string, Remembered>, options: GroupScoringOptions,
  group: ExecutionGroup | undefined, detail: 'full' | 'lean'): Promise<ScenarioScore> {
  if (!hasScoringData(def)) return row(def, 'unsupported', 'insufficient_data', { case: `${def.resonatorId}:${def.teamId}:${def.weapon.id}` })
  try {
    const built = buildScenarioInput(snapshot, def, context.teammates, context.deps)
    if (!built.ok) return row(def, 'unsupported', 'scenario_input', { issues: built.issues, detail: built.detail })
    const input = structuredClone(built.input)
    const reads = scenarioReads(def, context.teammates, context.deps, snapshot.echoes)
    await ensureResonatorData(scenarioResonatorIds(built.input))
    // stats apply to the build regardless of its rotation, so every later row includes them; one scenario serves both,
    // since stats only read it and generation seats a copy (rebaseInterpretation)
    const created = createScenario(built.input)
    const stats = scenarioBuildStats(built.input, created)
    const plan = context.plans[def.teamId]
    if (!plan) return row(def, 'error', 'no_action_plan', { teamId: def.teamId }, { stats, reads })
    lap('input')

    const made = await programFor(plan, created, context, remembered, options)
    const interpreted = made.result
    lap(made.source === 'generated' ? 'generate' : 'rebase')
    const provenance = { programSource: made.source, ...(made.mismatch ? { programMismatch: true } : {}) }
    if (interpreted.status !== 'interpreted') {
      return row(def, 'unsupported', String(interpreted.diagnostics.code ?? 'interpretation'), interpreted.diagnostics, { stats, reads, ...provenance })
    }

    const { scenario } = interpreted
    const program = programDocumentOf(def, scenario)
    const { text: programText, sha: programSha256 } = await programDocumentText(program)
    const generated = { program, programText, programSha256, stats, input, reads, ...provenance }
    lap('program')

    const executed = await context.execute({ def, input: built.input, scenario, ...(group ? { group } : {}),
      ...(detail === 'lean' ? { detail } : {}) })
    lap('execute')
    if (executed.timing) for (const [stage, ms] of Object.entries(executed.timing)) timing[`execute.${stage}`] = ms
    if (executed.status !== 'ok') return row(def, executed.status, executed.reason, executed.detail ?? null, generated)
    const measured = { ...(executed.damageModel ? { damageModel: executed.damageModel } : {}),
      ...(executed.damageMismatch ? { damageMismatch: true } : {}), ...(executed.dprMismatch ? { dprMismatch: true } : {}),
      ...(executed.lean ? { lean: true as const } : {}) }
    if (!Number.isFinite(executed.damage) || executed.damage < 0 ||
      (executed.score != null && !Number.isFinite(executed.score))) {
      return row(def, 'error', 'bad_execution', { damage: executed.damage }, generated)
    }
    const sequence = built.input.members.find((member) => member.slot === built.input.scoredSlot)!.sequence
    const refs = executed.score == null ? context.refsFor(def.id, sequence) : null
    const score = executed.score ?? (refs?.status === 'ok' ? buildScore(executed.damage, refs) : null)
    const anchors = executed.anchors ?? (refs?.status === 'ok' ? {
      baselineDamage: refs.baselineDamage, benchDamage: refs.benchDamage, perfectDamage: refs.perfectDamage,
    } : null)
    return row(def, 'ok', score == null ? 'no_refs' : null, null,
      { ...generated, input: executed.peaks ? withInputPeaks(input, executed.peaks) : input,
        damage: executed.damage, score, anchors, anchorKey: executed.anchorKey ?? null, energyRegen: executed.energyRegen ?? null,
        erRepair: executed.erRepair ?? null,
        anchorSource: !anchors ? null : executed.anchorKey ? 'offline' : executed.anchors ? 'search' : 'refs',
        contribution: executed.contribution ?? null, dpr: executed.contribution?.damage ?? executed.dpr ?? null, ...measured })
  } catch (error) {
    return row(def, 'error', 'exception', { message: error instanceof Error ? error.message : String(error) })
  }
}
