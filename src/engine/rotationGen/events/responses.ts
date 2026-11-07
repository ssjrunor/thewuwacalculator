/*
  Author: Runor Ewhro
  description: records triggered responses with their source event or state transition.
*/

import type { RuntimeValue } from '../types.ts'
// response occurrences are execution trace data. they never enter authored
// action rotations and do not create synthetic input identities.
export function eventCause(event?: RuntimeValue): RuntimeValue {
  const eventId = event.sourceEventId ?? event.eventId
  return { type: 'event', owner: event.sourceOwner ?? event.owner,
    actionId: event.sourceActionId ?? event.actionId,
    instance: event.sourceInstance ?? event.instance,
    ...(eventId == null ? {} : { eventId }) }
}

function validCause(cause?: RuntimeValue): RuntimeValue {
  switch (cause?.type) {
    case 'swap': return Number.isInteger(cause.from) && Number.isInteger(cause.to)
    case 'event':
    case 'clock': return Number.isInteger(cause.owner) && Number.isSafeInteger(cause.actionId)
    case 'response': return Number.isInteger(cause.responseId)
    case 'status': return Number.isInteger(cause.owner) && Boolean(cause.status)
    case 'handoff': return Number.isInteger(cause.owner)
    default: return false
  }
}

// validate the trigger and outcome before allocating an id; later hits and effects refer to this response occurrence.
export function emitResponse(fight: RuntimeValue, { kind, owner, cause, actionId, eventId, status }: RuntimeValue): RuntimeValue {
  if (!['action', 'tick', 'status'].includes(kind) || !validCause(cause) ||
    !Number.isInteger(owner)) throw new Error('Invalid response occurrence')
  if (kind === 'action' ? !Number.isSafeInteger(actionId) : !status) {
    throw new Error('Response has no outcome')
  }
  const response: RuntimeValue = { frame: fight.frame, type: 'response', id: ++fight.responseInstance,
    kind, owner, cause,
    ...(actionId == null ? {} : { actionId }),
    ...(eventId == null ? {} : { eventId }),
    ...(status == null ? {} : { status }) }
  fight.trace.push(response)
  return response
}
