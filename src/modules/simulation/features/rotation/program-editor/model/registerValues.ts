/*
  Author: Runor Ewhro
  Description: Owns register values behavior and state transitions for the model module.
*/

import type { RtChng, RuntimeValue, SourceState } from '@/domain/gameData/contracts.ts'

/**
 * Form used by edit controls and authored write fields.
 * Booleans are `on`/`off`; numbers keep full string precision.
 */
export function regTextValue(value: string | number | boolean | undefined): string {
  if (value === true) return 'on'
  if (value === false) return 'off'
  if (value == null) return ''
  return String(value)
}

/**
 * Form used when projecting simulation history onto rows.
 * Same as regTextValue, except non-integer numbers are fixed to two decimals.
 */
export function regDisplayValue(value: string | number | boolean | undefined): string {
  if (value === true) return 'on'
  if (value === false) return 'off'
  if (value == null) return ''
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }
  return String(value)
}

/**
 * Parse a display/edit string (or raw runtime value) back into a change value
 * using the target state's kind when known.
 */
export function parseRegValue(
  state: SourceState | undefined,
  value: RuntimeValue | undefined,
  change?: RtChng,
): RuntimeValue | undefined {
  if (value === undefined) {
    return undefined
  }
  if (state?.kind === 'toggle') {
    return typeof value === 'boolean'
      ? value
      : value === 'on' || value === 'true' || value === '1' || value === 1
  }
  if (
    state?.kind === 'number'
    || state?.kind === 'stack'
    || change?.type === 'add'
    || typeof change?.value === 'number'
  ) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (state?.kind === 'select' || typeof change?.value === 'string') {
    return String(value)
  }
  if (typeof value !== 'string') return value
  if (value === 'on') {
    return true
  }
  if (value === 'off') {
    return false
  }
  const parsed = Number(value)
  return value.trim() !== '' && Number.isFinite(parsed) ? parsed : value
}
