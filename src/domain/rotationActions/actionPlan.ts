/*
  Author: Runor Ewhro
  description: validates team identities, action order, swaps, and packed timelines.
*/

import type { ActionPlan } from './types'
import { canonicalResonatorId } from './identities.ts'

/** the serialized handoff between assembly and interpretation. no engine state belongs here. */
export function assertActionPlan(input: unknown): ActionPlan {
  const plan = input as ActionPlan
  const fail = (message: string): never => { throw new Error(`Invalid action plan ${plan?.teamId ?? ''}: ${message}`) }
  if (plan?.schemaVersion !== 1 || plan.kind !== 'team-actions' ||
    typeof plan.teamId !== 'string' || !plan.teamId) fail('Unknown format')
  if (!Array.isArray(plan.team) || !plan.team.length || plan.team.length > 3) fail('Invalid team')
  if (plan.team.some((member) => !/^\d{4}$/.test(String(member?.resonatorId)))) fail('Missing team identity')
  // canonical Rover ids prevent both gender forms from occupying separate team seats.
  const owners = plan.team.map((member) => canonicalResonatorId(member.resonatorId))
  if (new Set(owners).size !== owners.length) fail('Duplicate team member')
  const slotExists = (slot: number) => Number.isInteger(slot) && slot >= 0 && slot < owners.length
  if (!slotExists(plan.initialActiveSlot)) fail('Invalid initial actor')
  if (!plan.actions || !Array.isArray(plan.sections) || plan.sections.length !== 4) fail('Missing actions or sections')
  if (!Number.isFinite(plan.referenceTiming?.durationSeconds) || plan.referenceTiming.durationSeconds <= 0) {
    fail('Missing source reference duration')
  }
  // active-seat validation continues across section boundaries, and step ids are unique across the whole plan.
  let active = plan.initialActiveSlot
  const stepIds = new Set()
  for (const section of plan.sections) {
    if (!Array.isArray(section.steps) || !section.steps.length) fail('Empty section')
    for (const step of section.steps) {
      if (!step.id || stepIds.has(step.id)) fail('Missing or repeated step identity')
      stepIds.add(step.id)
      if (step.type === 'swap') {
        if (!slotExists(step.toSlot) || step.fromSlot !== active || step.toSlot === active) fail('Invalid swap')
        if (step.response && (typeof step.response.outro !== 'string' || !step.response.outro ||
          typeof step.response.intro !== 'string' || !step.response.intro)) fail('Invalid handoff response')
        active = step.toSlot
      } else if (step.type === 'cast') {
        const action = plan.actions[step.actionId]
        if (!action || step.actorSlot !== active || owners[active] !== canonicalResonatorId(action.resonatorId)) {
          fail('Action has no matching active actor or definition')
        }
        if (!['resonator', 'equippedEcho'].includes(action.kind) ||
          action.kind === 'resonator' && !action.sourceName) fail('Invalid action definition')
        if (step.cancel != null && typeof step.cancel !== 'string') fail('Invalid cancel instruction')
      } else if (step.type === 'wait') {
        if (!Number.isFinite(step.frames) || step.frames < 0) fail('Invalid wait')
      } else fail('Unknown step type')
    }
  }
  // packed timelines may share another seat/sequence entry; referenced entries must contain event data.
  if (plan.timelines != null) {
    const { owns, names, runs } = plan.timelines
    if (!owns || typeof owns !== 'object' || !Array.isArray(names) || !runs || typeof runs !== 'object') fail('Invalid timelines')
    for (const [key, run] of Object.entries(runs)) {
      const [seat, sequence] = key.split(':').map(Number)
      if (!slotExists(seat) || !Number.isInteger(sequence) || sequence < 0 || sequence > 6) fail(`Invalid timeline key ${key}`)
      if (typeof run === 'string') { if (typeof runs[run] !== 'object') fail(`Timeline ${key} names no timeline`); continue }
      if (!Number.isFinite(run?.seconds) || !Array.isArray(run.events)) fail(`Invalid timeline ${key}`)
      if (run.events.some((event) => !Array.isArray(event) || !Number.isInteger(event[0]) || event[0] < 0 ||
        typeof names[event[1]] !== 'string')) fail(`Timeline ${key} is out of order or names no kind`)
    }
  }
  return plan
}
