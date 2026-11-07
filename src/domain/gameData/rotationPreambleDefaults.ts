/*
  Author: Runor Ewhro
  description: resolves the canonical opening-state choices and default values
               used when authoring a rotation preamble.
*/

import type { SourceState } from './contracts.ts'
import {
  ACTIVE_RESONATOR_PATH,
  SELECTED_TARGET_PATH_PREFIX,
} from './rotationPaths.ts'

export interface PreambleChoice {
  resonatorId: string
  state: SourceState
}

/** the same state selection used by the editor's generate preamble action. */
export function openingConditionChoices<T extends PreambleChoice>(choices: readonly T[]): T[] {
  const seen = new Set<string>()
  return choices.filter((choice) => {
    const { path, ownerKey } = choice.state
    const key = `${choice.resonatorId}:${path}`
    if (path === ACTIVE_RESONATOR_PATH || path.startsWith(SELECTED_TARGET_PATH_PREFIX) ||
        ownerKey === 'rotation:formula' || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export type OpeningValue = string | number | boolean

/**
 * a select that must hold one of its named options: a resonance mode, an
 * enemy stance. numbered stacks and selects with a "none" option can be off.
 */
export function isRequiredChoice(state: SourceState): boolean {
  const options = state.options ?? []
  return state.kind === 'select' && options.length > 1 &&
    options.every((option) => option.id !== 'none' && option.id !== '' && !/^\d+$/.test(option.id))
}

/**
 * default value chosen when the editor adds an opening condition. a required
 * choice uses `current` when the member's current value is one of its options.
 */
export function openingConditionValue(state: SourceState, current?: unknown): OpeningValue {
  if (isRequiredChoice(state) && state.options?.some((option) => option.id === current)) return current as string
  if (state.defaultValue !== undefined) return state.defaultValue
  if (state.kind === 'toggle') return true
  if (state.kind === 'select') return state.options?.[0]?.id ?? ''
  return Math.max(state.min ?? 0, state.kind === 'stack' ? 1 : 0)
}
