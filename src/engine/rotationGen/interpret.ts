/*
  Author: Runor Ewhro
  description: converts a supplied action plan and scenario into an editor program.
*/

import type { InterpreterEnvironment, InterpretationResult, RuntimeRecord } from './types'
import type { CombatScenario } from '../../domain/entities/combatScenario'
import { makeScenarioTeam } from '../../domain/entities/combatScenario'
import type { ActionPlan } from '../../domain/rotationActions/types'
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

/** interpret a supplied scenario; its builds, modes and target belong to the caller. */
export async function interpretTeamActions(
  environment: InterpreterEnvironment,
  plan: ActionPlan,
  inputScenario: CombatScenario,
): Promise<InterpretationResult> {
  assertActionPlan(plan)
  const scenario = structuredClone(inputScenario)
  // match seats by canonical identity before reordering; the scenario and action plan may list members differently.
  const byIdentity = new Map(scenario.team.members.map(member => [canonicalResonatorId(member.resonatorId), member]))
  const ordered = plan.team.map(member => byIdentity.get(canonicalResonatorId(member.resonatorId)))
  if (scenario.team.members.length !== plan.team.length || byIdentity.size !== plan.team.length ||
    ordered.some(member => !member)) {
    throw new Error('Scenario seats disagree with action plan')
  }
  const members = ordered.filter(member => member !== undefined)
  const context = members.find(member => member.id === scenario.contextMemberId)
  if (!context) throw new Error('Scenario context member is not on the action plan team')
  // the app's slot zero is its context. Replay seats, bit masks and timeline keys
  // retain the authored order; stable member identities connect the two orders.
  scenario.team = makeScenarioTeam([context, ...members.filter(member => member.id !== context.id)])
  const replayScenario = { ...scenario, team: makeScenarioTeam(members) }
  const missing = members.filter(member => !environment.characters.has(member.resonatorId))
  if (missing.length) return { status: 'unsupported', diagnostics: {
    code: 'missing-character-translation-data', characters: await Promise.all(missing.map(async member =>
      ({ resonatorId: member.resonatorId, ...await environment.characters.coverage(member.resonatorId) }))) } }
  try {
    const ids = members.map(member => member.resonatorId)
    const loaded = await environment.characters.load(ids, environment.mode)
    // read calculation bundles and hit metadata from the same host snapshot as the loaded character rules.
    const [resonatorPairs, weaponPairs, damageEntries] = await Promise.all([
      Promise.all(ids.map(async id => [id, await environment.gameData(`resonators/runtime-bundles/${id}`)])),
      Promise.all(members.map(async member => [member.loadout.weapon.id,
        await environment.gameData(`weapons/runtime-bundles/${member.loadout.weapon.id}`)])),
      environment.gameData('resonators/damage-entries') as Promise<RuntimeRecord[]>,
    ])
    // every member can break: their own Tune Break, else their weapon class's
    const bundles = Object.fromEntries(resonatorPairs) as Record<string, RuntimeRecord>
    const rulesets = Object.fromEntries(Object.entries(loaded as Record<string, RuntimeRecord>).map(([id, rules]) =>
      [id, withTuneBreak(rules, Number(bundles[id]?.seed.weaponType))]))
    const combat = prepareInterpreterState({ scenario: replayScenario, mode: environment.mode, rulesets,
      gearLibrary: environment.gear, weaponBundles: Object.fromEntries(weaponPairs),
      resonatorBundles: bundles, damageEntries,
      echoCatalog: environment.echoCatalog,
      maxFrames: Math.ceil(plan.referenceTiming.durationSeconds * 60) + 7200 })
    combat.initialOnFieldResonatorId = Number(ids[plan.initialActiveSlot])
    const editor = prepareEditorSources({ scenario,
      resonators: Object.fromEntries(resonatorPairs), echoes: environment.echoSources,
      sonataDefinitions: environment.sonataDefinitions })
    for (const rules of Object.values(rulesets) as RuntimeRecord[]) {
      Object.assign(editor.castControls, rules.castControls)
    }
    bindEquipmentConditions(editor, combat, rulesets)
    combat.memberEffectControls = editor.memberEffectControls
    // use the saved timeline for this seat and sequence when present; otherwise derive timing from the prescribed steps.
    const scored = members.findIndex(member => member.id === scenario.contextMemberId)
    const timeline = scored < 0 ? null : timelineFor(plan, scored, members[scored].progression.sequence)
    const kits = timeline ? timelineKits(rulesets, plan) : rulesets
    const writable = new Set<string>((editor.preambleChoices ?? []).map((choice: RuntimeRecord) => choice.state.path))
    const resolved = timeline
      ? { ...playTimeline(kits, combat, timeline, writable, editor.fixedStatuses ?? new Set()), consumedStepIds: [], unresolvedInstructions: [] }
      : resolveActionPlan(rulesets, combat, plan)
    combat.maxFrames = resolved.state.frame
    const program = emitEditorProgram(kits, combat, {
      frame: resolved.state.frame, trace: resolved.state.trace,
      casts: resolved.state.trace.filter((event: RuntimeRecord) => event.type === 'cast'),
      startOwner: combat.initialOnFieldResonatorId,
    }, editor)
    // partial bindings return an unsupported result; the caller never receives a silently incomplete rotation.
    if (program.diagnostics.omittedEffects.length || program.diagnostics.unmappedActions.length ||
      program.diagnostics.unattachedConsumedEffects.length) {
      return { status: 'unsupported', diagnostics: { code: 'incomplete-editor-bindings', ...program.diagnostics } }
    }
    scenario.program.program = packSections(program.items)
    scenario.initialOnFieldMemberId = members.find(member => Number(member.resonatorId) === combat.initialOnFieldResonatorId)?.id ??
      members[plan.initialActiveSlot].id
    return { status: 'interpreted', scenario, duration: (resolved as RuntimeRecord).seconds ?? resolved.state.frame / 60,
      diagnostics: { ...program.diagnostics, timingModel: timeline ? 'reference-timeline' : 'authored-action-timeline',
        ...(timeline ? { timelineSkipped: (resolved as RuntimeRecord).skipped } : {}),
        referenceDuration: plan.referenceTiming.durationSeconds,
        consumedStepIds: resolved.consumedStepIds, unresolvedInstructions: resolved.unresolvedInstructions } }
  } catch (error) {
    if (error instanceof UnauthorablePath) return { status: 'unsupported',
      diagnostics: { code: 'not-editor-authorable', path: error.path } }
    if (error instanceof PlanTranslationError) return { status: 'unsupported',
      diagnostics: { code: 'incomplete-plan-translation', gaps: [error.gap] } }
    return { status: 'unsupported', diagnostics: { code: 'action-interpretation-failed',
      message: error instanceof Error ? error.message : String(error) } }
  }
}
