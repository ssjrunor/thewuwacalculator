/*
  Author: Runor Ewhro
  description: shared numeric helpers for lightweight ui and state shaping.
*/

import { truncTo } from '@/engine/formulas/truncTo'

export { truncTo }

// clamp a number into an inclusive range
export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function formatTrunc(value: number, digits = 0): string {
  const truncated = truncTo(value, digits)
  return truncated.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatTruncCompact(value: number, digits = 1): string {
  return truncTo(value, digits).toFixed(digits)
}
