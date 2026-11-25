/*
  Author: Runor Ewhro
  description: selects the offline anchor state a build is scored against. a
               `need` scenario has one state per 0.4% of final energy regen in the
               team's range, and a build takes the highest state at or under its
               own energy regen, so its reference builds never have more energy
               regen and it cannot save budget against them (builds above the
               range take the highest). builds under the range's lowest state are
               repaired up to it first (anchorErRequirement,
               evaluation/erRepair.ts) and fall back to the lowest only when no
               repair applied. `search` and `none` scenarios have one state.
*/

import type { AnchorState, ScenarioAnchorsFile } from '@/domain/leaderboard/ruleset'

/** the state's key inside its scenario, stored with a score for rollout comparison. */
export const anchorStateKey = (sequence: number, state: Pick<AnchorState, 'er'>) =>
  `s${sequence}|${state.er == null ? 'er-' : `er${state.er.toFixed(1)}`}`

/** float noise allowed between a build's float32 energy regen and a state's when matching the state. */
const ER_TOLERANCE = 1e-4

/**
 * the final energy regen of the case's reference builds, the repair target for builds under `below`
 * (evaluation/erRepair.ts): for need, its lowest state; for search, its floor. null for none, or for a search ruleset
 * packaged without its floor.
 */
export function anchorErRequirement(file: ScenarioAnchorsFile, sequence: number): { target: number; below: number } | null {
  const entry = file.sequences[String(sequence)]
  if (!entry?.states.length) return null
  const target = file.mode === 'need' ? Math.min(...entry.states.map((state) => state.er!))
    : file.mode === 'search' ? entry.floor ?? null : null
  return target != null && Number.isFinite(target) ? { target, below: target - ER_TOLERANCE } : null
}

export function anchorStateFor(file: ScenarioAnchorsFile, sequence: number, energyRegen: number)
  : { key: string; state: AnchorState } | null {
  const states = file.sequences[String(sequence)]?.states
  if (!states?.length) return null
  if (file.mode !== 'need') return { key: anchorStateKey(sequence, states[0]!), state: states[0]! }
  // the highest state the build reaches, or the lowest when it reaches none
  let best: AnchorState | null = null
  let least = states[0]!
  for (const state of states) {
    if (state.er! < least.er!) least = state
    if (state.er! <= energyRegen + ER_TOLERANCE && (!best || state.er! > best.er!)) best = state
  }
  const state = best ?? least
  return { key: anchorStateKey(sequence, state), state }
}
