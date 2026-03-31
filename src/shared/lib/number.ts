/*
  Author: Runor Ewhro
  Description: shared numeric helpers for lightweight ui and state shaping.
*/

// clamp a number into an inclusive range
export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
