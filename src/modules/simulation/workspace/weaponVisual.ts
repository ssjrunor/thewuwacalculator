/*
  Author: Runor Ewhro
  Description: Maps weapon-type identifiers to the canonical asset key used by
               build workspace weapon projections.
*/

import { WPNTYPETOKEY } from '@/modules/simulation/features/resonator/lib/resonator.ts'

export function getWpnVisKey(weaponType: number | null | undefined): string | null {
  if (weaponType == null) {
    return null
  }

  return WPNTYPETOKEY[weaponType as keyof typeof WPNTYPETOKEY] ?? null
}
