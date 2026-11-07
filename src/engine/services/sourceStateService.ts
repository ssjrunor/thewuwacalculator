/*
  Author: Runor Ewhro
  description: implements source state service data-flow and calculation invariants.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import { mkSrcSttScp, sourceOptions } from '@/engine/gameData/controlOptions'
import type { CondExpr, SourceState } from '@/domain/gameData/contracts'
import { evalCond } from '@/engine/effects/evaluator'
import { listStatesFor } from '@/data/catalog/gameDataService'

export { mkSrcSttScp, sourceOptions }

/** resolve dependencies against explicit controls first, then authored defaults. */
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

const SCOPE_ROOTS = /^(sourceRuntime|sourceFinalStats|targetRuntime|activeRuntime|pool|baseStats|finalStats|context)\./

/**
 * a leaf a rotation can change: any runtime state (controls, team effects) and
 * anything read off the active member, which swaps change.
 */
function rotationVariable(leaf: { from?: string, path: string }): boolean {
  const root = leaf.from ?? SCOPE_ROOTS.exec(leaf.path)?.[1]
  const path = leaf.path.replace(SCOPE_ROOTS, '')
  return root === 'activeRuntime' || root === 'context' || path.startsWith('state.')
}

/** true, false, or null when it turns on something a rotation can change. */
function settledCond(condition: CondExpr | undefined, scope: Parameters<typeof evalCond>[1]): boolean | null {
  if (!condition || condition.type === 'always') return true
  if (condition.type === 'not') {
    const value = settledCond(condition.value, scope)
    return value == null ? null : !value
  }
  if (condition.type === 'and' || condition.type === 'or') {
    let unknown = false
    for (const part of condition.values) {
      const value = settledCond(part, scope)
      if (value == null) unknown = true
      else if (value === (condition.type === 'or')) return value
    }
    return unknown ? null : condition.type === 'and'
  }
  return rotationVariable(condition) ? null : evalCond(condition, scope)
}

/**
 * returns whether a rotation can make a state visible. writable controls and
 * active-member changes remain possible; fixed build requirements, such as
 * an unavailable sequence, can rule the state out. `requires` lists writable
 * controls and therefore does not exclude a state from the editor.
 */
export function canStateBeVisible(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): boolean {
  return settledCond(state.visibleWhen, mkSrcSttScp(srcRt, tgtRt, state, actRt)) !== false
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
