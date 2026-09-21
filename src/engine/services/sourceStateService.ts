/*
  Author: Runor Ewhro
  Description: Implements source state service data-flow and calculation invariants.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import { mkSrcSttScp, sourceOptions } from '@/engine/gameData/controlOptions'
import type { SourceState } from '@/domain/gameData/contracts'
import { evalCond } from '@/engine/effects/evaluator'
import { listStatesFor } from '@/data/catalog/gameDataService'

export { mkSrcSttScp, sourceOptions }

/** Resolve dependencies against explicit controls first, then authored defaults. */
export function meetsStateReqs(srcRt: ResRuntime, state: SourceState): boolean {
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

export function isStateVisible(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): boolean {
  return meetsStateReqs(srcRt, state) && evalCond(
    state.visibleWhen,
    mkSrcSttScp(srcRt, tgtRt, state, actRt),
  )
}

export function isStateEnabled(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): boolean {
  return meetsStateReqs(srcRt, state) && evalCond(
    state.enabledWhen,
    mkSrcSttScp(srcRt, tgtRt, state, actRt),
  )
}
