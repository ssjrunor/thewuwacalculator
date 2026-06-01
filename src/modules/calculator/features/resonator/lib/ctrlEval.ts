/*
  Author: Runor Ewhro
  Description: builds evaluation scope for resonator state controls and
               resolves whether a control is enabled for the current runtime.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { ResStateControl } from '@/domain/entities/resonator.ts'
import type { CondExpr } from '@/domain/gameData/contracts.ts'
import { mkResCntrScp } from '@/domain/gameData/controlOptions.ts'
import { evalCond } from '@/engine/effects/evaluator.ts'

// evaluate whether a resonator control should currently be enabled
export function ctrlEnabled(
    runtime: ResRuntime,
    control: ResStateControl,
): boolean {
  return evalCond(control.enabledWhen, mkResCntrScp(runtime))
}

export function ctrlVisible(
    runtime: ResRuntime,
    control: ResStateControl,
): boolean {
  return evalCond(control.visibleWhen, mkResCntrScp(runtime))
}

export function resVisible(
    runtime: ResRuntime,
    condition?: CondExpr,
): boolean {
  return evalCond(condition, mkResCntrScp(runtime))
}
