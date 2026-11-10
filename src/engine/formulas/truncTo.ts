/*
  Author: Runor Ewhro
  description: truncates a stat value to a display precision without rounding
               it upward, tolerant of float32 stat-lane error.
*/

// cut decimal display precision without rounding the underlying value upward
export function truncTo(value: number, digits = 0): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  const factor = 10 ** Math.max(0, digits)
  const scaled = value * factor
  /* values assembled from float32 stat lanes can land just below an intended
     decimal boundary (for example 50.1f + 49.8f -> 99.8999977). snap only
     within one float32 rounding-error bound; meaningful fractions below the
     boundary must still truncate downward. */
  const tolerance = Math.max(
    Number.EPSILON * Math.max(1, Math.abs(scaled)),
    Math.abs(scaled) * (2 ** -24),
  )
  const boundary = Math.round(scaled)
  const normalized = Math.abs(scaled - boundary) <= tolerance ? boundary : scaled
  return Math.trunc(normalized) / factor
}
