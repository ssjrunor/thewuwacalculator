/*
  Author: Runor Ewhro
  Description: shared resonator policy for scoring surfaces where Energy Regen
               is intentionally treated as a dead substat.
*/

export const ER_IGNORED_IDS = ['1109', '1608'] as const

const ER_IGNORED = new Set<string>(ER_IGNORED_IDS)

export function ignoresEr(resonatorId: string): boolean {
  return ER_IGNORED.has(resonatorId)
}
