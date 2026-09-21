/*
  Author: Runor Ewhro
  Description: Resolves the editable Off-Tune cooldown landing and advances it
               from executed features, so loop passes share the real state.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'

type FeatureNode = Extract<RotationNode, { type: 'feature' }>

/** How many executed features are held when the player leaves the landing unmarked. */
export const OFF_TUNE_DEFAULT_SEAL = 3

export type OffTuneResumeKind = 'mark' | 'default'

/** Authored facts which do not change while a prepared program is running. */
export interface OffTuneSealPlan {
  /** Tune Break nodes whose following segment contains an authored landing. */
  waitsForMarkedResume: ReadonlySet<string>
}

/** The cooldown as it stands at one point in execution. */
export interface OffTuneSealState {
  plan: OffTuneSealPlan
  active: boolean
  held: number
  waitsForMark: boolean
}

export interface OffTuneSealStep {
  state: OffTuneSealState
  sealed: boolean
  /** This feature is the landing that ended the cooldown. */
  resume: OffTuneResumeKind | null
  /** This feature belongs to the currently active cooldown window. */
  afterBreak: boolean
}

export const EMPTY_OFF_TUNE_SEAL_PLAN: OffTuneSealPlan = {
  waitsForMarkedResume: new Set<string>(),
}

export function makeOffTuneSealState(
  plan: OffTuneSealPlan = EMPTY_OFF_TUNE_SEAL_PLAN,
): OffTuneSealState {
  return { plan, active: false, held: 0, waitsForMark: false }
}

/** Begin a fresh cooldown after this executed Tune Break. */
export function startOffTuneSeal(
  state: OffTuneSealState,
  breakNodeId: string,
): OffTuneSealState {
  return {
    plan: state.plan,
    active: true,
    held: 0,
    waitsForMark: state.plan.waitsForMarkedResume.has(breakNodeId),
  }
}

/**
 * Advance the cooldown using execution order rather than document position.
 * This lets a break at the end of one loop pass hold entries at the beginning
 * of the next pass.
 */
export function stepOffTuneSeal(
  state: OffTuneSealState,
  node: FeatureNode,
): OffTuneSealStep {
  if (!state.active) {
    return { state, sealed: false, resume: null, afterBreak: false }
  }

  if (node.offTuneResume) {
    return {
      state: { ...state, active: false, held: 0, waitsForMark: false },
      sealed: false,
      resume: 'mark',
      afterBreak: true,
    }
  }

  if (!state.waitsForMark && state.held >= OFF_TUNE_DEFAULT_SEAL) {
    return {
      state: { ...state, active: false, held: 0 },
      sealed: false,
      resume: 'default',
      afterBreak: true,
    }
  }

  return {
    state: { ...state, held: state.held + 1 },
    sealed: true,
    resume: null,
    afterBreak: true,
  }
}

/** Every feature in document order, including nested repeat and uptime bodies. */
function flattenFeatures(items: readonly RotationNode[], out: FeatureNode[]): void {
  for (const item of items) {
    if (item.type === 'feature') {
      out.push(item)
      continue
    }
    if (item.type === 'repeat' || item.type === 'uptime') {
      if (item.setup) flattenFeatures(item.setup, out)
      flattenFeatures(item.items, out)
    }
  }
}

/**
 * Associate explicit landing marks with the preceding Tune Break segment.
 * The landing itself is still consumed dynamically; the plan only decides
 * whether that break should wait past the three-entry default.
 */
export function planOffTuneSeal(
  items: readonly RotationNode[],
  isTuneBreak: (node: FeatureNode) => boolean,
): OffTuneSealPlan {
  const features: FeatureNode[] = []
  flattenFeatures(items, features)
  return planOffTuneSealOrder(features, isTuneBreak)
}

/** Build the authored facts from an already expanded structural execution order. */
export function planOffTuneSealOrder(
  features: readonly FeatureNode[],
  isTuneBreak: (node: FeatureNode) => boolean,
): OffTuneSealPlan {
  const waitsForMarkedResume = new Set<string>()
  let breakNode: FeatureNode | null = null

  for (const feature of features) {
    if (isTuneBreak(feature)) {
      breakNode = feature
      continue
    }
    if (feature.offTuneResume && breakNode) {
      waitsForMarkedResume.add(breakNode.id)
      breakNode = null
    }
  }

  return { waitsForMarkedResume }
}
