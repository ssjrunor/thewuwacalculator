/*
  Author: Runor Ewhro
  description: converts source counters into editor control values and merges
               repeated writes to one control.
*/

import type { RuntimeValue } from './types'

/** projects a source counter into an existing editor control's units. */
export function projectControlStacks(kind: RuntimeValue, stacks: number): RuntimeValue {
  if (kind?.bitCount) return Math.min(kind.bitCount,
    [...(stacks >>> 0).toString(2)].filter(bit => bit === '1').length)
  if (kind?.per) return Math.floor(stacks / kind.per)
  if (Number.isFinite(kind?.offset)) return Math.max(0, stacks + kind.offset)
  return kind === 'stacks' ? stacks : kind
}

/** merges two values of one authored control; a toggle keeps a stack counter sharing the control at its count. */
export function mergeControlValues(previous: RuntimeValue, value: RuntimeValue): RuntimeValue {
  if (previous == null) return value
  return typeof previous === 'boolean' && typeof value === 'boolean'
    ? previous || value : Math.max(Number(previous), Number(value))
}
