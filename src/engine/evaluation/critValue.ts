/*
  Author: Runor Ewhro
  description: shared Echo crit values and five-slot loadout crit grading.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { getEchoById } from '@/data/catalog/echoCatalogService'

export function cmptEchoCrit(substats: Record<string, number>): number {
  return (substats.critRate ?? 0) * 2 + (substats.critDmg ?? 0)
}

// crit value across an echo's full crit contribution: substats plus any crit
// rolled on the primary/secondary main stats.
export function cmptEchoCritAll(echo: EchoInstance): number {
  let critRate = echo.substats.critRate ?? 0
  let critDmg = echo.substats.critDmg ?? 0
  for (const stat of [echo.mainStats.primary, echo.mainStats.secondary]) {
    if (stat.key === 'critRate') critRate += stat.value
    else if (stat.key === 'critDmg') critDmg += stat.value
  }
  return critRate * 2 + critDmg
}

export function cmptBldCritGr(echoes: Array<EchoInstance | null>): number {
  let cv = 0
  let fourCost = 0

  for (const echo of echoes) {
    if (!echo) continue
    cv += cmptEchoCritAll(echo)
    if (getEchoById(echo.id)?.cost === 4) fourCost += 1
  }

  return (cv - 44 * Math.min(fourCost, 2)) / 5
}
