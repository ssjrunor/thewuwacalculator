/*
  Author: Runor Ewhro
  description: binds authored seats and decoded timeline controls to the scenario's actual forms.
*/

import { mapResonatorIdentityValue, mapResonatorNamespaces, type ResonatorIdResolver } from '../entities/roverIdentityBinding'
import type { ActionPlan, ActionTimeline, TimelineEvent } from './types'

export function bindActionPlanIdentities(plan: ActionPlan, resolve: ResonatorIdResolver): ActionPlan {
  const owns: Record<string, string[]> = {}
  for (const [owner, names] of Object.entries(plan.timelines?.owns ?? {})) {
    const id = resolve(owner)
    owns[id] = [...new Set([...(owns[id] ?? []), ...names])]
  }
  return { ...plan,
    team: plan.team.map(member => ({ ...member, resonatorId: resolve(member.resonatorId) })),
    actions: Object.fromEntries(Object.entries(plan.actions).map(([id, action]) =>
      [id, { ...action, resonatorId: resolve(action.resonatorId) }])),
    ...(plan.timelines ? { timelines: { ...plan.timelines, owns } } : {}),
  }
}

export function bindTimelineIdentities(timeline: ActionTimeline, resolve: ResonatorIdResolver): ActionTimeline {
  return { ...timeline, events: timeline.events.map(event => {
    if (event[1] === 'control') return [event[0], event[1], mapResonatorNamespaces(event[2], resolve),
      event[2] === 'runtime.rotation.activeResonatorId' ? mapResonatorIdentityValue(event[3], resolve) : event[3]]
    if (event[1] === 'hitControl') {
      const path = mapResonatorNamespaces(event[6], resolve)
      const value = path === 'runtime.rotation.activeResonatorId' ? JSON.stringify(mapResonatorIdentityValue(JSON.parse(event[7]), resolve)) : event[7]
      return [...event.slice(0, 6), path, value] as TimelineEvent
    }
    return event
  }) }
}
