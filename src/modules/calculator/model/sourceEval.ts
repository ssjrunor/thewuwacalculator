/*
  Author: Runor Ewhro
  Description: builds state-evaluation scopes for source states and resolves
               whether those states should be visible or enabled for a given
               source/target/active runtime combination.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import { mkSrcSttScp, sourceOptions as srcSttOpts } from '@/domain/gameData/controlOptions'
import type { SourceState } from '@/domain/gameData/contracts'
import { evalCond } from '@/engine/effects/evaluator'
import { listStatesFor } from '@/domain/services/gameDataService'

export { mkSrcSttScp, srcSttOpts }

function srcReqMet(srcRt: ResRuntime, state: SourceState): boolean {
  const sttsByCtl = new Map(
    listStatesFor(state.source.type, state.source.id)
      .map((entry) => [entry.controlKey, entry]),
  )

  return (state.requires ?? state.controlDependencies ?? [])
    .every((controlKey) => {
      const curVal = srcRt.state.controls[controlKey]
      if (curVal !== undefined) {
        return Boolean(curVal)
      }

      return Boolean(sttsByCtl.get(controlKey)?.defaultValue)
    })
}

// evaluate whether this state should be shown in the ui for the current scope
export function evalSrcStt(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): boolean {
  return srcReqMet(srcRt, state) && evalCond(
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
  return srcReqMet(srcRt, state) && evalCond(
    state.enabledWhen,
    mkSrcSttScp(srcRt, tgtRt, state, actRt),
  )
}
