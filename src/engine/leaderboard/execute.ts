/*
  Author: Runor Ewhro
  description: scores verified programs with the app evaluator and records normalized resonator contributions.
*/

import { executeCombatScenarioProgram, prepareCombatScenario } from '@/engine/pipeline/combatScenario'
import { getLoopAverageDivisor, sumRotTtls } from '@/engine/pipeline/rotationTotals'
import { projectScenarioEngineRuntimes } from '@/engine/runtime/scenarioRuntime'
import { rotationCombatSetup } from '@/engine/rotation/damageSource'
import { evaluateProgramBuild, measureProgramDamage, prepareProgramEvaluation, programEvaluationKey, replayMeasure,
  type ProgramEvaluation, type ProgramMeasure } from '@/engine/evaluation/report'
import { compileProgramMeasure, sameMeasure } from '@/engine/evaluation/compiledMeasure'
import { canonicalResonatorId } from '@/domain/rotationActions/identities'
import type { ScoredContribution } from '@/domain/leaderboard/api'
import type { FeatureResult } from '@/domain/gameData/contracts'
import { hasScoringData } from './coverage'
import { peaksOfRun } from './peakControls'
import type { ExecutionGroup, ExecutionRequest, ExecutionResult, RotationExecutor } from './scoreScenario'
import type { CombatScenario } from '@/domain/entities/combatScenario'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import type { ProgramResult } from '@/engine/rotation/runTypes'
import type { ScenarioAnchorsFile } from '@/domain/leaderboard/ruleset'
import { anchorErRequirement, anchorStateFor } from './offlineAnchors'
import { buildScore } from './scoreFormula'
import { teamLedger } from './teamLedger'

const clock = () => globalThis.performance?.now() ?? Date.now()

// a deterministic work limit, so the same partial model receives the same result on different machines;
// offline/reference searches without omissions use the normal unrestricted app search
const FALLBACK_ANCHOR_SEARCH_CHECKS = 512
class AnchorSearchWorkLimit extends Error {}
const normalizationFailed = (omission: { code: string }) =>
  omission.code === 'score-normalization-work-limit' || omission.code === 'score-normalization-unavailable'

// teammates stay in the scoring objective; the card shows this resonator's own avg damage, its Tune Breaks included,
// as the rotation editor splits it
export function scoredContribution(entries: readonly FeatureResult[], resonatorId: string): ScoredContribution {
  const own = entries.filter((entry) => canonicalResonatorId(entry.resonatorId) === canonicalResonatorId(resonatorId)
    && entry.aggregationType === 'damage')
  const damage = sumRotTtls(own).avg
  const features = new Map<string, ScoredContribution['features'][number]>()
  for (const entry of own) {
    const id = `${resonatorId}:${entry.skill.id}`
    const value = entry.avg / getLoopAverageDivisor(entry.loopRunCounts)
    const previous = features.get(id)
    if (previous) { previous.damage += value; previous.weightedDamage += value }
    else features.set(id, { resonatorId, skillId: id, label: entry.skill.label, tab: entry.skill.tab,
      skillType: entry.skill.skillType, damage: value, weightedDamage: value, sharePct: 0 })
  }
  return { damage, features: [...features.values()].map((feature) => ({ ...feature,
    sharePct: damage > 0 ? feature.damage / damage * 100 : 0 })).sort((a, b) => b.damage - a.damage) }
}

// the scored resonator's own split with the team's side of the same run (teamLedger.ts)
function withTeam(result: ProgramResult, subject: ResRuntime, runtimesById: Record<string, ResRuntime>): ScoredContribution {
  return { ...scoredContribution(result.entries, subject.id), team: teamLedger(result, subject, runtimesById) }
}

// scores the program with self-searched anchors; `echoes` replaces the scored build's echoes in the score (an
// energy regen repair), and the contribution stays the submitted build's
async function searchAnchors({ def, scenario, omissions }: ExecutionRequest, echoes?: Array<EchoInstance | null>,
  searchChecks = omissions?.length ? FALLBACK_ANCHOR_SEARCH_CHECKS : Infinity): Promise<ExecutionResult> {
  if (!hasScoringData(def)) return { status: 'unsupported', reason: 'insufficient_data' }
  const t0 = clock()
  const result = executeCombatScenarioProgram(prepareCombatScenario(scenario), scenario.program.program)
  if (!result?.entries.length) return { status: 'ok', damage: 0, score: 0,
    contribution: { damage: 0, features: [] }, omissions: [{ code: 'no-supported-damage' }] }
  const projection = projectScenarioEngineRuntimes(scenario)
  const subject = projection.subjectRuntime
  const t1 = clock()
  let checks = 0, limited = false
  const check = Number.isFinite(searchChecks) ? () => { if (++checks > searchChecks) throw new AnchorSearchWorkLimit() } : undefined
  let evaluation: ReturnType<typeof evaluateProgramBuild>
  try { evaluation = evaluateProgramBuild({
    scenarioId: scenario.id, memberId: scenario.contextMemberId,
    runtime: echoes ? { ...subject, build: { ...subject.build, echoes } } : subject,
    enemy: scenario.target, runtimesById: projection.runtimesById,
  }, { items: scenario.program.program, combatSetup: rotationCombatSetup(scenario) }, check,
  // a warm cache applies the same work limit to every build
  { cacheAnchors: !check }) }
  catch (error) {
    if (!(error instanceof AnchorSearchWorkLimit)) throw error
    limited = true
    evaluation = null
  }
  if (!evaluation) return { status: 'ok', damage: sumRotTtls(result.entries).avg, score: 0,
    contribution: withTeam(result, subject, projection.runtimesById), omissions: [{ code: limited ? 'score-normalization-work-limit' : 'score-normalization-unavailable',
      ...(limited ? { checks: searchChecks } : {}) }],
    timing: { run: t1 - t0, search: clock() - t1 } }
  const t2 = clock()
  const contribution = withTeam(result, subject, projection.runtimesById)
  return { status: 'ok', ...evaluation, contribution,
    peaks: peaksOfRun(scenario, result.inspection), timing: { run: t1 - t0, search: t2 - t1, team: clock() - t2 } }
}

export const executeScoringRotation: RotationExecutor = (request) => searchAnchors(request)

// evaluation contexts cached per executor; a group's builds rarely need more than one or two
const EVALUATION_CONTEXTS = 4

// the fewest of a group's builds left to measure for compiling a context's program to pay: one compile costs about
// what a few replays do, and a compiled build a fraction of a millisecond (compiledMeasure.ts)
export const COMPILE_MIN_BUILDS = 8

// an evaluation context, and how it measures the builds of the group it last served
interface EvaluationContext {
  evaluation: ProgramEvaluation | null
  // the group the measure below was decided for
  group?: ExecutionGroup
  // the compiled measure, once it agreed with the replay on the group's first build here; else the replay
  compiled?: ProgramMeasure
  // whether the compiled measure's DPR matched a full run's here: every build runs fully until it has, and again
  // once it has not
  dpr?: 'checked' | 'failed'
}

// maximum relative difference between a compiled DPR and a run's for the two to match. the run (detailed executor)
// and the scoring evaluation already differ by parts in 1e8, the compiled program models the evaluation, and a kit
// the compiler models differently is off by parts in 1e4
const DPR_TOLERANCE = 1e-6
const sameDpr = (compiled: number | undefined, run: number) => compiled != null && Number.isFinite(compiled)
  && Math.abs(compiled - run) <= DPR_TOLERANCE * Math.max(Math.abs(compiled), Math.abs(run))

// how one build was measured: the replay, or the compiled program (checked or not)
type Measured = { measure: ProgramMeasure; model: 'replay' | 'compiled'; mismatch?: true; compileMs?: number; checkMs?: number
  // a sampled check build (group.damageCheck), run fully with its DPR checked too
  sampled?: true }

// the measure for this build on its context. the first build of a group on a context is replayed; with enough of the
// group left, the program is compiled for the group's gear and kept only if it measures that build like the replay.
// a share of later builds (group.damageCheck) is also replayed, and a mismatch returns the context to the replay for
// the rest of the group
function measureFor(context: EvaluationContext, evaluation: ProgramEvaluation, echoes: Parameters<ProgramMeasure>[0],
  group: ExecutionGroup | undefined): Measured {
  const replay = replayMeasure(evaluation)
  if (!group) return { measure: replay, model: 'replay' }
  if (context.group !== group) {
    context.group = group
    context.compiled = undefined
    if (group.left() < (group.compileMin ?? COMPILE_MIN_BUILDS)) return { measure: replay, model: 'replay' }
    const t0 = clock()
    const compiled = compileProgramMeasure(evaluation, group.worn, replay)
    const t1 = clock()
    if (!compiled) return { measure: replay, model: 'replay', compileMs: t1 - t0 }
    const agrees = sameMeasure(compiled(echoes), replay(echoes))
    if (agrees) { context.compiled = compiled; context.dpr = undefined }
    return { measure: replay, model: 'replay', compileMs: t1 - t0, checkMs: clock() - t1, ...(agrees ? {} : { mismatch: true }) }
  }
  if (!context.compiled) return { measure: replay, model: 'replay' }
  if (group.damageCheck > 0 && group.random() < group.damageCheck) {
    const t0 = clock()
    const agrees = sameMeasure(context.compiled(echoes), replay(echoes))
    const checkMs = clock() - t0
    if (!agrees) {
      context.compiled = undefined
      return { measure: replay, model: 'replay', mismatch: true, checkMs }
    }
    return { measure: context.compiled, model: 'compiled', checkMs, sampled: true }
  }
  return { measure: context.compiled, model: 'compiled' }
}

// a scenario's program measures for its scored seat as the executor builds them: the seat's echoes, the replay, and
// the program compiled for given (echo id, set) pairs; for tests and tools, null without an evaluation context
export function programMeasures(scenario: CombatScenario) {
  const projection = projectScenarioEngineRuntimes(scenario)
  const evaluation = prepareProgramEvaluation({ scenarioId: scenario.id, memberId: scenario.contextMemberId,
    runtime: projection.subjectRuntime, enemy: scenario.target, runtimesById: projection.runtimesById },
  { items: scenario.program.program, combatSetup: rotationCombatSetup(scenario) })
  if (!evaluation) return null
  const replay = replayMeasure(evaluation)
  return { echoes: projection.subjectRuntime.build.echoes, replay,
    // the full run's DPR for the scenario's own build (contribution.damage)
    runDpr: () => scoredContribution(executeCombatScenarioProgram(prepareCombatScenario(scenario), scenario.program.program)?.entries ?? [],
      projection.subjectRuntime.id).damage,
    compile: (worn: Iterable<readonly [string, number]>, fallback: ProgramMeasure = replay) => compileProgramMeasure(evaluation, worn, fallback) }
}

// scores with offline anchors (scripts/anchorgen): the build's damage and energy regen on the program, then its
// anchor state. scenarios without anchors, and states whose formula failed its engine checks, are scored by
// executeScoringRotation, which searches its own anchors. builds under the case's energy regen requirement
// (anchorErRequirement) are scored repaired up to it inside their own budget (evaluation/erRepair.ts), and builds no
// repair reaches cannot sustain the rotation and score 0; in both cases the contribution (the shown DPR) is the
// submitted build's
export function offlineAnchorExecutor(anchorsFor: (scenarioId: string) => Promise<ScenarioAnchorsFile | null>): RotationExecutor {
  // evaluation contexts by their inputs (programEvaluationKey): builds of a group sharing a program and a utility set
  // plan measure on one context without recapturing the program; a few, most recent last
  const prepared = new Map<string, EvaluationContext>()
  const contextFor = (input: Parameters<typeof prepareProgramEvaluation>[0], program: Parameters<typeof prepareProgramEvaluation>[1]) => {
    const key = programEvaluationKey(input, program)
    if (prepared.has(key)) {
      const known = prepared.get(key)!
      prepared.delete(key)
      prepared.set(key, known)
      return known
    }
    const made: EvaluationContext = { evaluation: prepareProgramEvaluation(input, program) }
    prepared.set(key, made)
    for (const oldest of prepared.keys()) { if (prepared.size <= EVALUATION_CONTEXTS) break; prepared.delete(oldest) }
    return made
  }
  return async (request) => {
    if (!hasScoringData(request.def)) return { status: 'unsupported', reason: 'insufficient_data' }
    const file = await anchorsFor(request.def.id)
    if (!file) return searchAnchors(request)
    if (!request.omissions?.length) return scoreOnAnchors(request, file)
    // a partial model searches anchors on its own supported calculation first; when that search cannot finish, the
    // case's anchors score it, pricing in what the model lacks, so the score is a lower bound and never 0
    const searched = await searchAnchors(request)
    if (searched.status !== 'ok' || !searched.omissions?.some(normalizationFailed)) return searched
    const anchored = await scoreOnAnchors(request, file)
    if (anchored.status !== 'ok') return searched
    return { ...anchored, omissions: [...searched.omissions.filter(normalizationFailed), ...anchored.omissions ?? []],
      timing: { ...anchored.timing, search: (anchored.timing?.search ?? 0) + (searched.timing?.search ?? 0) } }
  }

  async function scoreOnAnchors(request: ExecutionRequest, file: ScenarioAnchorsFile): Promise<ExecutionResult> {
    const { scenario, input } = request
    const t0 = clock()
    const projection = projectScenarioEngineRuntimes(scenario)
    const sequence = input.members.find((member) => member.slot === input.scoredSlot)!.sequence
    const evaluationInput = { scenarioId: scenario.id, memberId: scenario.contextMemberId, runtime: projection.subjectRuntime,
      enemy: scenario.target, runtimesById: projection.runtimesById }
    const context = contextFor(evaluationInput, { items: scenario.program.program, combatSetup: rotationCombatSetup(scenario) })
    const echoes = projection.subjectRuntime.build.echoes
    const measured = context.evaluation && measureFor(context, context.evaluation, echoes, request.group)
    const evaluated = measured && measureProgramDamage(context.evaluation!, echoes, anchorErRequirement(file, sequence), measured.measure)
    if (!evaluated) return searchAnchors(request)
    const erRepair = evaluated.repair?.repair
    const t1 = clock()
    // a lean build on a context whose compiled DPR a full run confirmed skips the run and uses the compiled measure
    // for the submitted build's DPR (a repair measures other echoes, so its own measure is taken again)
    const ownDpr = measured.model === 'compiled' ? (erRepair ? measured.measure(echoes) : evaluated).dpr : undefined
    const lean = request.detail === 'lean' && measured.model === 'compiled' && !measured.sampled && context.dpr === 'checked'
      && ownDpr != null && Number.isFinite(ownDpr)
    let run: { contribution: ScoredContribution; peaks: ReturnType<typeof peaksOfRun> } | null = null
    let dprMismatch = false
    if (!lean) {
      const result = executeCombatScenarioProgram(prepareCombatScenario(scenario), scenario.program.program)
      if (!result?.entries.length) return searchAnchors(request)
      run = { contribution: withTeam(result, projection.subjectRuntime, projection.runtimesById), peaks: peaksOfRun(scenario, result.inspection) }
      // the first full run on a compiled context, and each sampled one, checks its DPR
      if (context.compiled && context.dpr !== 'failed' && (context.dpr === undefined || measured.sampled)) {
        const compiledDpr = ownDpr ?? context.compiled(echoes).dpr
        if (sameDpr(compiledDpr, run.contribution.damage)) context.dpr = 'checked'
        else { dprMismatch = context.dpr === 'checked'; context.dpr = 'failed' }
      }
    }
    const t2 = clock()
    const hit = anchorStateFor(file, sequence, evaluated.energyRegen)
    const anchors = hit?.state.exact
      ? { baselineDamage: hit.state.baseline, benchDamage: hit.state.bench, perfectDamage: hit.state.perfect } : null
    // compiling and checking are separate stages excluded from the damage time; the run includes contribution.team
    const timing: Record<string, number> = { damage: t1 - t0 - (measured.compileMs ?? 0) - (measured.checkMs ?? 0),
      ...(run ? { run: t2 - t1 } : {}),
      ...(measured.compileMs != null ? { compile: measured.compileMs } : {}), ...(measured.checkMs != null ? { check: measured.checkMs } : {}) }
    const model = { damageModel: measured.model, ...(measured.mismatch ? { damageMismatch: true as const } : {}),
      ...(dprMismatch ? { dprMismatch: true as const } : {}) }
    const shown = run ? { contribution: run.contribution, peaks: run.peaks } : { dpr: ownDpr!, lean: true as const }
    if (erRepair?.short) {
      return { status: 'ok', damage: evaluated.damage, score: 0, ...(anchors ? { anchors, anchorKey: hit!.key } : {}),
        energyRegen: evaluated.energyRegen, ...shown, erRepair, timing, ...model }
    }
    const score = anchors ? buildScore(evaluated.damage, anchors) : null
    if (!hit || !anchors || score == null) {
      // the offline measure ran first, then the search ran its own program and anchors, and both are counted
      const searched = await searchAnchors(request, evaluated.repair?.echoes)
      const both = { ...timing, ...Object.fromEntries(Object.entries(searched.timing ?? {}).map(([stage, ms]) => [stage, ms + (timing[stage as keyof typeof timing] ?? 0)])) }
      return { ...(searched.status === 'ok' && erRepair ? { ...searched, erRepair } : searched), timing: both }
    }
    return { status: 'ok', damage: evaluated.damage, score, anchors, anchorKey: hit.key, energyRegen: evaluated.energyRegen,
      ...shown, ...(erRepair ? { erRepair } : {}), timing, ...model }
  }
}
