/*
  Author: Runor Ewhro
  description: replays prescribed actions, swaps, and waits within a bounded frame range.
*/

import type { RuntimeValue } from './types.ts'
import { assertActionPlan } from '../../domain/rotationActions/actionPlan.ts'
import { PlanTranslationError } from './planCoverage'
import { createEffectState, advanceEffectState,
  maybeTuneBreak, resolveAction, resolveSwap } from './events/execute.ts'

const normalizeName = (name?: RuntimeValue): RuntimeValue => name.toLowerCase().replace(/[^a-z0-9]/g, '')

function prescribedActionIds(source?: RuntimeValue, member?: RuntimeValue): RuntimeValue {
  const aliases = member.ruleset.inputAliases?.[source]
  if (aliases) {
    const choice: RuntimeValue = aliases.find((candidate?: RuntimeValue): RuntimeValue =>
      member.source.build.sequence >= (candidate.minimumSequence ?? 0) &&
      (Object.entries(candidate.state ?? {}) as [string, RuntimeValue][]).every(([key, value]: RuntimeValue): RuntimeValue => member.state[key] === value))
    return choice ? [choice.action] : []
  }
  return (Object.entries(member.ruleset.actions) as [string, RuntimeValue][]).filter(([, action]: RuntimeValue): RuntimeValue =>
    normalizeName(action.name) === normalizeName(source)).map(([id]: RuntimeValue): RuntimeValue => Number(id))
}

/** only consume the supplied steps; never rebuild a plan from its recipe ID. */
export function resolveActionPlan(rulesets?: RuntimeValue, combat?: RuntimeValue, plan?: RuntimeValue): RuntimeValue {
  assertActionPlan(plan)
  // a solved plan may use full animations considerably longer than its cancelled reference.
  // derive the frame limit from the prescribed actions and their delayed events.
  const allActions = (Object.values(rulesets) as RuntimeValue[]).flatMap(rules => Object.values(rules.actions)) as RuntimeValue[]
  const durationFrames = (action: RuntimeValue): number => {
    const frames = action.timing.duration ?? 0, stop = action.timing.timeStop
    return frames - (stop ? Math.max(0, Math.min(frames, stop[1]) - stop[0]) : 0)
  }
  let plannedFrames = 0
  for (const section of plan.sections) for (const step of section.steps) {
    if (step.type === 'wait') { plannedFrames += step.frames; continue }
    const names = step.type === 'swap' ? step.response ? [step.response.outro, step.response.intro] : [] :
      [plan.actions[step.actionId].sourceName]
    for (const name of names.filter((name: unknown) => typeof name === 'string')) plannedFrames += Math.max(0, ...allActions.filter(action => normalizeName(action.name) === normalizeName(name)).map(durationFrames))
  }
  // include delayed action events and one extra second after the planned inputs when deriving the frame limit.
  const tailFrames = Math.max(0, ...allActions.flatMap(action => action.events.map((event: RuntimeValue) => event.at ?? 0)))
  combat.maxFrames = Math.max(combat.maxFrames, Math.ceil(plannedFrames + tailFrames + 60))
  const state: RuntimeValue = createEffectState(rulesets, combat)
  const ownerForSlot = (slot?: RuntimeValue): RuntimeValue => combat.members[slot].resonatorId
  const unresolvedInstructions: RuntimeValue = []
  const consumedStepIds: RuntimeValue = []
  const wait = (frame?: RuntimeValue): RuntimeValue => advanceEffectState(state, Math.min(frame, state.frameLimit))
  for (const [sectionIndex, section] of plan.sections.entries()) {
    state.trace.push({ type: 'section', index: sectionIndex, frame: state.frame })
    for (const step of section.steps) {
      consumedStepIds.push(step.id)
      if (step.type === 'wait') {
        if (state.frame + step.frames > state.frameLimit) throw new Error('Planned wait exceeds the interpretation frame limit')
        wait(state.frame + step.frames)
        continue
      }
      // finish the current input before replaying the prescribed Outro/Intro pair and advancing to its completion.
      if (step.type === 'swap') {
        state.currentStepId = step.id
        wait(Math.max(state.readyAt, state.frame))
        resolveSwap(state, ownerForSlot(step.toSlot), step.response)
        wait(Math.max(state.frame, state.readyAt))
        continue
      }
      const owner: RuntimeValue = ownerForSlot(step.actorSlot)
      state.currentStepId = step.id
      if (state.active !== owner) throw new Error(`Unplanned active actor at ${step.id}`)
      const member = state.members[owner]
      const source = plan.actions[step.actionId]
      const matches = source.kind === 'equippedEcho' ? [member.source.echoes.main.action.id]
        : prescribedActionIds(source.sourceName, member)
      if (matches.length !== 1) throw new PlanTranslationError({ code: 'missing-action-binding',
        stepId: step.id, resonatorId: String(owner), action: source.sourceName,
        message: `No unique action binding: ${step.actionId}` })
      const actionId = matches[0]
      resolveAction(state, owner, actionId)
      // the copied interpreter uses full animations. preserve source cancellation instructions
      // in the plan and explicitly report the ones this prototype has not implemented.
      if (step.cancel && source.kind !== 'equippedEcho') unresolvedInstructions.push({
        stepId: step.id, instruction: step.cancel, reason: 'Source cancel timing is not implemented' })
      wait(Math.max(state.frame, state.readyAt))
      // a break waits for the press that filled the bar to play out, then lands before the next input
      if (maybeTuneBreak(state, owner, actionId, step.cancel)) wait(Math.max(state.frame, state.readyAt))
    }
    if (state.frame >= state.frameLimit && sectionIndex < plan.sections.length - 1) {
      throw new Error('Action plan did not complete all four sections')
    }
  }
  // resolve delayed hits after the last input; a tail beyond the calculated limit fails the complete plan.
  const end: RuntimeValue = Math.max(state.frame, ...state.pending.map((event?: RuntimeValue): RuntimeValue => event.frame))
  if (end > state.frameLimit) throw new Error('Action tails exceed the interpretation frame limit')
  wait(end)
  return { state, unresolvedInstructions, consumedStepIds }
}
