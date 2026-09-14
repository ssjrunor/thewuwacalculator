/*
  Author: Runor Ewhro
  Description: Derives equipped Echo sets whose authored activation threshold
               is satisfied by the current loadout.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext.ts'

export interface ActiveEchoSet {
  setId: number
  count: number
}

export function listActiveSets(
  echoes: (EchoInstance | null)[],
): ActiveEchoSet[] {
  const active: ActiveEchoSet[] = []
  for (const [rawId, count] of Object.entries(countEchoSets(echoes))) {
    const setId = Number(rawId)
    const definition = getEchoSetDe(setId)
    if (!definition) continue

    const threshold = definition.setMax === 1 ? 1 : definition.setMax === 3 ? 3 : 2
    if (count >= threshold) active.push({ setId, count })
  }

  return active.reverse()
}
