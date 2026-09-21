/*
  Author: Runor Ewhro
  Description: Collects app-store bootstrap and derived-state helpers for
               initial persistence loading and per-resonator suggestion state
               access.
*/

import type { SuggestState } from '@/domain/entities/suggestions'
import type { ResonatorId } from '@/domain/entities/runtime'
import {
  makeAppState,
  makeSuggest,
} from '@/engine/runtime/defaults'
import { loadPrssAppS } from '@/application/persistence/storage'
import type { HydratedAppState } from '@/domain/entities/appState'
import { isSimulationSurfaceRoute } from '@/shared/lib/appRoutes'
import type { AppStore } from './store'

const INV_LEFT_PANES = new Set(['echoes', 'teams', 'rotations'])

export function mkDefMkName(resName: string, xstnCnt: number): string {
  return `${resName} Build ${xstnCnt + 1}`
}

export function mkDefRotName(
  resName: string,
  xstnCnt: number,
): string {
  return `${resName} Rotation ${xstnCnt + 1}`
}

// load the lightest persisted snapshot we can until inventory-backed screens need more.
export function mkNtlAppStt(): HydratedAppState {
  if (typeof window === 'undefined') {
    return makeAppState()
  }

  const baseState = loadPrssAppS({ includeInventory: false }) ?? makeAppState()
  if (
    isSimulationSurfaceRoute(window.location.pathname, 'optimizer')
    || INV_LEFT_PANES.has(baseState.ui.leftPaneView)
  ) {
    return loadPrssAppS({ includeInventory: true }) ?? baseState
  }

  return baseState
}

export function getSuggsSttF(
  state: AppStore,
  resonatorId: ResonatorId,
): SuggestState {
  // callers often mutate suggestion state locally before writing back, so hand
  // them a clone instead of a direct store reference.
  return state.simulation.suggestionsByResonatorId[resonatorId]
    ? structuredClone(state.simulation.suggestionsByResonatorId[resonatorId])
    : makeSuggest()
}
