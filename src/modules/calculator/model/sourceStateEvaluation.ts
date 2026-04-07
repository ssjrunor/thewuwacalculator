/*
  Author: Runor Ewhro
  Description: builds state-evaluation scopes for source states and resolves
               whether those states should be visible or enabled for a given
               source/target/active runtime combination.
*/

import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import { buildSourceStateScope, resolveSourceStateOptions } from '@/domain/gameData/controlOptions'
import type { SourceStateDefinition } from '@/domain/gameData/contracts'
import { evaluateCondition } from '@/engine/effects/evaluator'

export { buildSourceStateScope, resolveSourceStateOptions }

// evaluate whether this state should be shown in the ui for the current scope
export function evaluateSourceStateVisibility(
    sourceRuntime: ResonatorRuntimeState,
    targetRuntime: ResonatorRuntimeState,
    state: SourceStateDefinition,
    activeRuntime: ResonatorRuntimeState = targetRuntime,
): boolean {
  return evaluateCondition(
      state.visibleWhen,
      buildSourceStateScope(sourceRuntime, targetRuntime, state, activeRuntime),
  )
}

// evaluate whether this state should be interactive/enabled for the current scope
export function evaluateSourceStateEnabled(
    sourceRuntime: ResonatorRuntimeState,
    targetRuntime: ResonatorRuntimeState,
    state: SourceStateDefinition,
    activeRuntime: ResonatorRuntimeState = targetRuntime,
): boolean {
  return evaluateCondition(
      state.enabledWhen,
      buildSourceStateScope(sourceRuntime, targetRuntime, state, activeRuntime),
  )
}
