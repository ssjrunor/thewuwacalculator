/*
  Author: Runor Ewhro
  description: converts a supplied action plan and scenario into an editor program.
*/

import type { InterpreterEnvironment, InterpretationOptions, InterpretationResult, RuntimeRecord } from './types'
import type { CombatScenario } from '../../domain/entities/combatScenario'
import { makeScenarioTeam } from '../../domain/entities/combatScenario'
import type { ActionPlan } from '../../domain/rotationActions/types'
import { roverIdentityResolver } from '../../domain/entities/roverIdentityBinding'
import { bindActionPlanIdentities, bindTimelineIdentities } from '../../domain/rotationActions/identityBinding'
import { canonicalResonatorId } from '../../domain/rotationActions/identities.ts'
import { assertActionPlan } from '../../domain/rotationActions/actionPlan.ts'
import { prepareInterpreterState } from './prepareTeam.ts'
import { prepareEditorSources } from './editor/catalog.ts'
import { emitEditorProgram, UnauthorablePath } from './editor/emitProgram.ts'
import { PlanTranslationError } from './planCoverage'
import { resolveActionPlan } from './resolveActions.ts'
import { bindEquipmentConditions } from './equipmentConditions.ts'
import { packSections } from './editorProgram.ts'
import { withTuneBreak } from './events/offTune.ts'
import { playTimeline, timelineFor, timelineKits } from './events/timeline.ts'
import { cleanupGeneratedRotation } from './editor/cleanup.ts'
import { materializeStatControls } from './editor/statControls.ts'
import { omit } from './omissions'
import { catalogRotationFallback } from './fallback'

// a copy of the scenario seated for the plan: the plan's members in plan order, the context first in the team
function seatScenario(plan: ActionPlan, inputScenario: CombatScenario, owned = false) {
  // a caller-owned scenario is seated as a shallow copy that shares its members, skipping the clone
  const scenario = owned ? { ...inputScenario, program: { ...inputScenario.program } } : structuredClone(inputScenario)
  // match seats by canonical identity before reordering; the scenario and action plan may list members differently
  const byIdentity = new Map(scenario.team.members.map(member => [canonicalResonatorId(member.resonatorId), member]))
  const ordered = plan.team.map(member => byIdentity.get(canonicalResonatorId(member.resonatorId)))
  if (scenario.team.members.length !== plan.team.length || byIdentity.size !== plan.team.length ||
    ordered.some(member => !member)) {
    throw new Error('Scenario seats disagree with action plan')
  }
  const members = ordered.filter(member => member !== undefined)
  const context = members.find(member => member.id === scenario.contextMemberId)
  if (!context) throw new Error('Scenario context member is not on the action plan team')
  // the app's slot zero is its context; replay seats, bit masks and timeline keys keep the authored order, and stable
  // member identities connect the two orders
  scenario.team = makeScenarioTeam([context, ...members.filter(member => member.id !== context.id)])
  return { scenario, members }
}

// what an interpretation adds to the scenario it was given; another scenario with the same reads takes it whole
export interface InterpretedProgram {
  initialOnFieldMemberId: CombatScenario['initialOnFieldMemberId']
  program: CombatScenario['program']['program']
  duration: number
  diagnostics: Extract<InterpretationResult, { status: 'interpreted' }>['diagnostics']
}

// the part of an interpretation another scenario can take (rebaseInterpretation)
export function interpretedProgram(result: Extract<InterpretationResult, { status: 'interpreted' }>): InterpretedProgram {
  return { initialOnFieldMemberId: result.scenario.initialOnFieldMemberId, program: result.scenario.program.program,
    duration: result.duration, diagnostics: result.diagnostics }
}

// the interpretation of `inputScenario` reusing one made for a scenario the generator reads the same way: the
// scenario seated as interpretTeamActions seats it, with that program and opener. the caller checks that the reads
// match (domain/leaderboard/programKey.ts); this function does not.
//
// `shared: true` is for callers treating programs as read-only (the leaderboard's group scorer): the program and
// diagnostics are used by reference without copying, and `inputScenario`, built by the caller for this build, is
// seated as a shallow copy sharing its members, because a deep copy of a large program per build dominates a rebase
export function rebaseInterpretation(shared: InterpretedProgram, plan: ActionPlan,
  inputScenario: CombatScenario, options: { shared?: boolean } = {}): Extract<InterpretationResult, { status: 'interpreted' }> {
  const { scenario } = seatScenario(plan, inputScenario, options.shared)
  scenario.initialOnFieldMemberId = shared.initialOnFieldMemberId
  scenario.program.program = options.shared ? shared.program : structuredClone(shared.program)
  return { status: 'interpreted', scenario, duration: shared.duration,
    diagnostics: options.shared ? shared.diagnostics : structuredClone(shared.diagnostics) }
}

// interprets a supplied scenario, using the caller's builds, modes and target
export async function interpretTeamActions(
  environment: InterpreterEnvironment, plan: ActionPlan, inputScenario: CombatScenario,
  options: InterpretationOptions = {},
): Promise<InterpretationResult> {
  const result = await interpretKnownTeamActions(environment, plan, inputScenario, options)
  return result.status === 'unsupported' && options.allowPartial
    ? catalogRotationFallback(environment, inputScenario, result.diagnostics, options) : result
}

async function interpretKnownTeamActions(
  environment: InterpreterEnvironment,
  plan: ActionPlan,
  inputScenario: CombatScenario,
  options: InterpretationOptions = {},
): Promise<InterpretationResult> {
  assertActionPlan(plan)
  const { scenario, members } = seatScenario(plan, inputScenario)
  const replayScenario = { ...scenario, team: makeScenarioTeam(members) }
  const missing = members.filter(member => !environment.characters.has(member.resonatorId))
  if (missing.length) return { status: 'unsupported', diagnostics: {
    code: 'missing-character-translation-data', characters: await Promise.all(missing.map(async member =>
      ({ resonatorId: member.resonatorId, ...await environment.characters.coverage(member.resonatorId) }))) } }
  try {
    const omissions: RuntimeRecord[] = []
    const policy = { allowPartial: options.allowPartial === true, omissions }
    const ids = members.map(member => member.resonatorId)
    const resolveIdentity = roverIdentityResolver(ids)
    const boundPlan = bindActionPlanIdentities(plan, resolveIdentity)
    const loaded = await environment.characters.load(ids, environment.mode)
    // read calculation bundles and hit metadata from the same host snapshot as the loaded character rules
    const [resonatorPairs, weaponPairs, damageEntries] = await Promise.all([
      Promise.all(ids.map(async id => [id, await environment.gameData(`resonators/runtime-bundles/${id}`)])),
      Promise.all(members.map(async member => {
        const id = member.loadout.weapon.id
        if (!id || options.allowPartial && !environment.weaponSources.some(source => String(source.source.id) === id)) {
          if (id) omit(policy, 'missing-weapon-source', { sourceId: id })
          return [id, {}]
        }
        return [id, await environment.gameData(`weapons/runtime-bundles/${id}`)]
      })),
      environment.gameData('resonators/damage-entries') as Promise<RuntimeRecord[]>,
    ])
    // every member can break: their own Tune Break, else their weapon class's
    const bundles = Object.fromEntries(resonatorPairs) as Record<string, RuntimeRecord>
    const rulesets = Object.fromEntries(Object.entries(loaded as Record<string, RuntimeRecord>).map(([id, rules]) =>
      [id, withTuneBreak(rules, Number(bundles[id]?.seed.weaponType))]))
    const combat = prepareInterpreterState({ scenario: replayScenario, mode: environment.mode, rulesets,
      gearLibrary: environment.gear, weaponBundles: Object.fromEntries(weaponPairs),
      resonatorBundles: bundles, damageEntries, resolveIdentity,
      echoCatalog: environment.echoCatalog,
      ...policy,
      maxFrames: Math.ceil(plan.referenceTiming.durationSeconds * 60) + 7200 })
    const equipmentGaps = omissions.filter(entry => !(entry.code === 'missing-gear-triggers' && entry.kind === 'mainEcho'))
    if (!options.allowPartial && equipmentGaps.length) return { status: 'unsupported',
      diagnostics: { code: 'incomplete-equipment-data', omissions: equipmentGaps } }
    combat.initialOnFieldResonatorId = Number(ids[plan.initialActiveSlot])
    const editor = prepareEditorSources({ scenario,
      resonators: Object.fromEntries(resonatorPairs), echoes: environment.echoSources,
      sonataDefinitions: environment.sonataDefinitions })
    Object.assign(editor, policy)
    for (const rules of Object.values(rulesets) as RuntimeRecord[]) {
      Object.assign(editor.castControls, rules.castControls)
    }
    // use the saved timeline for this seat and sequence when present; otherwise derive timing from the prescribed
    // steps
    const scored = members.findIndex(member => member.id === scenario.contextMemberId)
    const sequence = members[scored]?.progression.sequence
    const capturedTimeline = scored < 0 ? null : timelineFor(boundPlan, scored, sequence, policy)
    const timeline = capturedTimeline ? bindTimelineIdentities(capturedTimeline, resolveIdentity) : null
    if (plan.timelines && !timeline) return { status: 'unsupported', diagnostics: {
      code: 'missing-context-timeline',
      message: `No captured timeline for ${members[scored]?.resonatorId} at sequence ${members[scored]?.progression.sequence}`,
    } }
    const kits = timeline ? timelineKits(rulesets, boundPlan) : rulesets
    // bind after the timeline kits exist, because governed effects bind differently
    bindEquipmentConditions(editor, combat, rulesets, timeline ? kits : null)
    combat.memberEffectControls = editor.memberEffectControls
    const writable = new Set<string>((editor.preambleChoices ?? []).map((choice: RuntimeRecord) => choice.state.path))
    const resolved = timeline
      ? { ...playTimeline(kits, combat, timeline, writable, editor.fixedStatuses ?? new Set()), consumedStepIds: [], unresolvedInstructions: [] }
      : resolveActionPlan(rulesets, combat, boundPlan)
    combat.maxFrames = resolved.state.frame
    const program = emitEditorProgram(kits, combat, {
      frame: resolved.state.frame, trace: resolved.state.trace,
      casts: resolved.state.trace.filter((event: RuntimeRecord) => event.type === 'cast'),
      startOwner: combat.initialOnFieldResonatorId,
    }, editor)
    // partial bindings return an unsupported result, so the caller never receives an incomplete rotation
    if (program.diagnostics.omittedEffects.length || program.diagnostics.unmappedActions.length ||
      program.diagnostics.unattachedConsumedEffects.length) {
      if (!options.allowPartial) return { status: 'unsupported', diagnostics: { code: 'incomplete-editor-bindings', ...program.diagnostics } }
      omit(policy, 'incomplete-editor-bindings', { omittedEffects: program.diagnostics.omittedEffects,
        unmappedActions: program.diagnostics.unmappedActions, unattachedConsumedEffects: program.diagnostics.unattachedConsumedEffects })
    }
    scenario.initialOnFieldMemberId = members.find(member => Number(member.resonatorId) === combat.initialOnFieldResonatorId)?.id ??
      members[plan.initialActiveSlot].id
    // a stat control writes a stat the run reads at cast time into the program, which makes the program depend on the
    // build's stats; materializeStatControls returns the same items when none applies
    const unmaterialized = program.items
    program.items = materializeStatControls(scenario, program.items,
      Object.values(rulesets).flatMap(rules => (rules.statControls ?? []).map((binding: RuntimeRecord) => {
        const state = editor.preambleChoices.find((choice: RuntimeRecord) => String(choice.resonatorId) === String(rules.resonatorId) &&
          choice.state.controlKey === binding.controlKey)?.state
        return { ...binding, resonatorId: String(rules.resonatorId), min: state?.min, max: state?.max }
      })),
      new Set(editor.preambleChoices.map((choice: RuntimeRecord) => `${choice.resonatorId}|${choice.state.path}`)))
    // apply the editor's structural cleanup before packing; its counts go into diagnostics
    options.onBeforeCleanup?.(packSections(program.items))
    const cleaned = cleanupGeneratedRotation(program.items, editor.activeOtherControls, editor.preambleChoices)
    scenario.program.program = packSections(cleaned.items)
    return { status: 'interpreted', scenario, duration: (resolved as RuntimeRecord).seconds ?? resolved.state.frame / 60,
      diagnostics: { ...program.diagnostics, cleanup: cleaned.counts,
        // omitted source identities are build-specific diagnostics, so partial programs stay under full build keys
        ...(omissions.length ? { partial: true, omissions, readsBuildStats: true } : {}),
        ...(program.items !== unmaterialized ? { readsBuildStats: true } : {}),
        timingModel: timeline ? 'reference-timeline' : 'authored-action-timeline',
        ...(timeline ? { timelineSkipped: (resolved as RuntimeRecord).skipped } : {}),
        referenceDuration: plan.referenceTiming.durationSeconds,
        consumedStepIds: resolved.consumedStepIds, unresolvedInstructions: resolved.unresolvedInstructions } }
  } catch (error) {
    // package failures are not optional mechanic gaps, even in partial scoring
    if (error instanceof Error && error.name === 'RulesetError') throw error
    if (error instanceof UnauthorablePath) return { status: 'unsupported',
      diagnostics: { code: 'not-editor-authorable', path: error.path } }
    if (error instanceof PlanTranslationError) return { status: 'unsupported',
      diagnostics: { code: 'incomplete-plan-translation', gaps: [error.gap] } }
    return { status: 'unsupported', diagnostics: { code: 'action-interpretation-failed',
      message: error instanceof Error ? error.message : String(error) } }
  }
}
