/*
  Author: Runor Ewhro
  description: rejects actions whose required transitions or damage bindings are missing.
*/

import type { RuntimeRecord, RuntimeValue } from './types'

export class PlanTranslationError extends Error {
  readonly gap: RuntimeRecord
  constructor(gap: RuntimeRecord) { super(gap.message); this.gap = gap }
}

/** only a transition that can occur in this plan/build can block translation. */
export function assertActionCoverage(member: RuntimeValue, actionId: number, stepId?: string): void {
  const rules = member.ruleset, action = rules.actions[actionId]
  if (!action) return // equipped Echo actions have their own trigger adapter.
  if (action.equippedEchoReplacement) return // its hits can trigger effects; equipped Echo damage is excluded.
  const gap = (rules.translationGaps ?? []).find((entry: RuntimeRecord) =>
    !entry.deferred &&
    (entry.minimumSequence ?? 0) <= member.source.build.sequence &&
    (!entry.actions || entry.actions.includes(actionId)))
  const base = { resonatorId: String(rules.resonatorId), actionId, action: action.name, stepId }
  if (gap) throw new PlanTranslationError({ ...gap, ...base })
  const binding = rules.nodeFeatures[actionId]
  if (action.events.some((event: RuntimeRecord) => event.damage) &&
    (!binding || Array.isArray(binding) && !binding.length)) {
    throw new PlanTranslationError({ ...base, code: 'missing-feature-binding',
      message: `No calculator feature binding for ${rules.name}: ${action.name}` })
  }
  if (Array.isArray(binding) && typeof binding[0] === 'object') {
    const mapped = new Set(binding.map((entry: RuntimeRecord) => String(entry.event)))
    const missing = action.events.filter((event: RuntimeRecord) => event.damage && !mapped.has(String(event.id)))
    if (missing.length) throw new PlanTranslationError({ ...base, code: 'missing-hit-bindings',
      events: missing.map((event: RuntimeRecord) => event.id),
      message: `Unmapped hits in ${rules.name}: ${action.name}` })
  }
}
