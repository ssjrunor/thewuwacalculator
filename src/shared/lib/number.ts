/*
  Author: Runor Ewhro
  Description: shared numeric helpers for lightweight ui and state shaping.
*/

// clamp a number into an inclusive range
export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// cut decimal display precision without rounding the underlying value upward
export function truncTo(value: number, digits = 0): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  const factor = 10 ** Math.max(0, digits)
  return Math.trunc(value * factor) / factor
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
