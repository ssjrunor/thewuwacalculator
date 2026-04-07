/*
  Author: Runor Ewhro
  Description: builds evaluation scope for resonator state controls and
               resolves whether a control is enabled for the current runtime.
*/

import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { ResonatorStateControl } from '@/domain/entities/resonator'
import type { ConditionExpression } from '@/domain/gameData/contracts'
import { buildResonatorControlScope } from '@/domain/gameData/controlOptions'
import { evaluateCondition } from '@/engine/effects/evaluator'

// evaluate whether a resonator control should currently be enabled
export function evaluateResonatorControlEnabled(
    runtime: ResonatorRuntimeState,
    control: ResonatorStateControl,
): boolean {
  return evaluateCondition(control.enabledWhen, buildResonatorControlScope(runtime))
}

export function evaluateResonatorControlVisible(
    runtime: ResonatorRuntimeState,
    control: ResonatorStateControl,
): boolean {
  return evaluateCondition(control.visibleWhen, buildResonatorControlScope(runtime))
}

export function evaluateResonatorVisibility(
    runtime: ResonatorRuntimeState,
    condition?: ConditionExpression,
): boolean {
  return evaluateCondition(condition, buildResonatorControlScope(runtime))
}
