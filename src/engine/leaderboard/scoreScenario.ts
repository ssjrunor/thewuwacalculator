/*
  Author: Runor Ewhro
  description: scores one build in one scenario: card + scenario -> scenario
               input -> CombatScenario -> generated rotation program -> executed
               damage -> dps -> score against the scenario's references. every
               step that cannot go on ends the row as `unsupported` (the build or
               kit is outside what can be scored) or `error` (something broke),
               never as a zero. running the program for damage is the injected
               `execute` step, so callers pick the executor.
*/

import type { CombatScenario } from '@/domain/entities/combatScenario'
import type { ScenarioDef, ScenarioRefs } from '@/domain/leaderboard/ruleset'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import type { ScenarioInput } from '@/domain/leaderboard/scenarioInput'
import type { ActionPlan } from '@/domain/rotationActions/types'
import { ensureResonatorData } from '@/data/gameData'
import { interpretTeamActions, type InterpretationResult, type InterpreterEnvironment } from '@/engine/rotationGen'
import { canonicalJson, sha256Hex } from '@/domain/leaderboard/canonical'
import { createScenario, scenarioResonatorIds } from './scenario'
import { buildScenarioInput, type ScenarioInputDeps } from './scenarioInput'
import { buildScore } from './scoreFormula'
import type { ResolvedTeammate } from './teammateBuilds'

/** what the executor is handed: the scenario with its generated program. */
export interface ExecutionRequest {
  def: ScenarioDef
  input: ScenarioInput
  scenario: CombatScenario
  /** seconds the generated rotation lasts. */
  duration: number
}

export type ExecutionResult =
  | { status: 'ok'; damage: number; /** overrides the generated duration when the executor measures its own. */ duration?: number }
  | { status: 'unsupported' | 'error'; reason: string; detail?: unknown }

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
  duration: number
  initialOnFieldMemberId: string
  members: Array<{ id: string; resonatorId: string }>
  program: CombatScenario['program']['program']
}

export interface ScenarioScore {
  scenarioId: string
  status: 'ok' | 'unsupported' | 'error'
  damage: number | null
  duration: number | null
  dps: number | null
  /** null when the scenario has no references for this sequence yet. */
  score: number | null
  program: ProgramDocument | null
  programText: string | null
  programSha256: string | null
  /** why the row is not ok: a short code, e.g. 'scenario_input', 'unconverted-character-rules'. */
  reason: string | null
  detail: unknown
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
}

function row(def: ScenarioDef, status: ScenarioScore['status'], reason: string | null, detail: unknown,
  extra: Partial<ScenarioScore> = {}): ScenarioScore {
  return { scenarioId: def.id, status, damage: null, duration: null, dps: null, score: null,
    program: null, programText: null, programSha256: null, reason, detail, ...extra }
}

export async function scoreScenario(snapshot: BuildSnapshot, def: ScenarioDef,
  context: ScenarioScoringContext): Promise<ScenarioScore> {
  try {
    const built = buildScenarioInput(snapshot, def, context.teammates, context.deps)
    if (!built.ok) return row(def, 'unsupported', 'scenario_input', { issues: built.issues, detail: built.detail })
    const plan = context.plans[def.teamId]
    if (!plan) return row(def, 'error', 'no_action_plan', { teamId: def.teamId })

    await ensureResonatorData(scenarioResonatorIds(built.input))
    const generate = context.generate ?? ((teamPlan, scenario) => interpretTeamActions(context.interpreter, teamPlan, scenario))
    const interpreted = await generate(plan, createScenario(built.input))
    if (interpreted.status !== 'interpreted') {
      return row(def, 'unsupported', String(interpreted.diagnostics.code ?? 'interpretation'), interpreted.diagnostics)
    }

    const { scenario, duration } = interpreted
    const program: ProgramDocument = {
      v: 1,
      scenarioId: def.id,
      teamId: def.teamId,
      duration,
      initialOnFieldMemberId: scenario.initialOnFieldMemberId,
      members: scenario.team.members.map((member) => ({ id: member.id, resonatorId: member.resonatorId })),
      program: scenario.program.program,
    }
    const programText = canonicalJson(program)
    const generated = { program, programText, programSha256: await sha256Hex(programText) }

    const executed = await context.execute({ def, input: built.input, scenario, duration })
    if (executed.status !== 'ok') return row(def, executed.status, executed.reason, executed.detail ?? null, generated)
    const seconds = executed.duration ?? duration
    if (!(seconds > 0) || !Number.isFinite(executed.damage) || executed.damage < 0) {
      return row(def, 'error', 'bad_execution', { damage: executed.damage, duration: seconds }, generated)
    }
    const dps = executed.damage / seconds
    const refs = context.refsFor(def.id, built.input.members[built.input.scoredSlot].sequence)
    const score = refs?.status === 'ok' ? buildScore(dps, refs) : null
    return row(def, 'ok', score == null ? 'no_refs' : null, null,
      { ...generated, damage: executed.damage, duration: seconds, dps, score })
  } catch (error) {
    return row(def, 'error', 'exception', { message: error instanceof Error ? error.message : String(error) })
  }
}
