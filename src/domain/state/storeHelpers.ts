/*
  Author: Runor Ewhro
  Description: Collects app-store bootstrap and derived-state helpers for
               initial persistence loading, optimizer-context syncing, and
               per-resonator suggestion state access.
*/

import type {
  OptContext,
} from '@/domain/entities/optimizer'
import type { SuggestState } from '@/domain/entities/suggestions'
import type { ResonatorId } from '@/domain/entities/runtime'
import {
  makeAppState,
  makeSuggest,
  mkOptCtxFrom,
} from '@/domain/state/defaults'
import {
  mkActRt,
  mkSelTgtResM,
  mkRtFromProf,
  getActResId,
} from '@/domain/state/runtimeAdapters'
import { loadPrssAppS } from '@/infra/persistence/storage'
import type { PersistedState } from '@/domain/entities/appState'
import { deriveOptSets, preserveToggles } from '@/engine/optimizer/config/defaultSettings.ts'
import type { AppStore } from './store'

const INV_LEFT_PANES = new Set(['echoes', 'teams', 'rotations'])

export function mkDefMkName(resName: string, xstnCnt: number): string {
  return `${resName} Build ${xstnCnt + 1}`
}

export function mkDefRotName(
  resName: string,
  mode: 'personal' | 'team',
  xstnCnt: number,
): string {
  return mode === 'team'
    ? `${resName} Team Rotation ${xstnCnt + 1}`
    : `${resName} Rotation ${xstnCnt + 1}`
}

// load the lightest persisted snapshot we can until inventory-backed screens need more.
export function mkNtlAppStt(): PersistedState {
  if (typeof window === 'undefined') {
    return makeAppState()
  }

  const baseState = loadPrssAppS({ includeInventory: false }) ?? makeAppState()
  if (
    baseState.ui.mainMode === 'optimizer'
    || INV_LEFT_PANES.has(baseState.ui.leftPaneView)
  ) {
    return loadPrssAppS({ includeInventory: true }) ?? baseState
  }

  return baseState
}

// derive an optimizer context that follows the current active runtime and target state.
export function getSyncOptCt(state: AppStore): OptContext | null {
  const actRt = mkActRt(state.calculator)
  if (!actRt) {
    return null
  }

  const existing = state.calculator.optimizerContext
  if (existing?.resonatorId === actRt.id) {
    return existing
  }

  // following a new active resonator re-derives resonator-specific settings,
  // but machine/ui preferences are carried over from the prior context.
  return mkOptCtxFrom(
    actRt,
    {
      ...deriveOptSets({
        runtime: actRt,
        enemy: state.calculator.session.enemyProfile,
        selectedTargets: mkSelTgtResM(state.calculator),
      }),
      ...preserveToggles(existing?.settings),
    },
  )
}

export function getOptCtxFro(
  state: AppStore,
  resonatorId?: ResonatorId,
): OptContext | null {
  // prefer the explicitly requested resonator, then the live optimizer target,
  // then whatever runtime is currently active in the calculator.
  const tgtResId =
    resonatorId
    ?? state.calculator.optimizerContext?.resonatorId
    ?? getActResId(state.calculator)

  if (!tgtResId) {
    return null
  }

  const liveRuntime = mkRtFromProf(state.calculator, tgtResId)
    ?? mkActRt(state.calculator)

  if (!liveRuntime) {
    return null
  }

  const existing = state.calculator.optimizerContext
  // reuse current settings when the live runtime still belongs to the same
  // resonator so users do not lose in-progress optimizer configuration.
  const settings = existing?.resonatorId === liveRuntime.id
    ? existing.settings
    : {
      ...deriveOptSets({
        runtime: liveRuntime,
        enemy: state.calculator.session.enemyProfile,
        selectedTargets: mkSelTgtResM(state.calculator),
      }),
      ...preserveToggles(existing?.settings),
    }

  return mkOptCtxFrom(liveRuntime, settings)
}

export function getSuggsSttF(
  state: AppStore,
  resonatorId: ResonatorId,
): SuggestState {
  // callers often mutate suggestion state locally before writing back, so hand
  // them a clone instead of a direct store reference.
  return state.calculator.suggestionsByResonatorId[resonatorId]
    ? structuredClone(state.calculator.suggestionsByResonatorId[resonatorId])
    : makeSuggest()
}
