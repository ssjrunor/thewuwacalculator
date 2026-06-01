/*
  Author: Runor Ewhro
  Description: builds state-evaluation scopes for source states and resolves
               whether those states should be visible or enabled for a given
               source/target/active runtime combination.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import { mkSrcSttScp, sourceOptions } from '@/domain/gameData/controlOptions'
import type { SourceState } from '@/domain/gameData/contracts'
import { evalCond } from '@/engine/effects/evaluator'

export { mkSrcSttScp as buildSourceStateScope, sourceOptions as resolveSourceStateOptions }

// evaluate whether this state should be shown in the ui for the current scope
export function evalSourceState(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): boolean {
  return evalCond(
    state.visibleWhen,
    mkSrcSttScp(srcRt, tgtRt, state, actRt),
  )
}

// evaluate whether this state should be interactive/enabled for the current scope
export function evalSrcSttOn(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): boolean {
  return evalCond(
    state.enabledWhen,
    mkSrcSttScp(srcRt, tgtRt, state, actRt),
  )
}
