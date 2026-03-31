/*
  Author: Runor Ewhro
  Description: shared echo helpers for cost lookups, total cost summaries,
               and cost-based sorting used across calculator ui surfaces.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { getEchoById } from '@/domain/services/echoCatalogService'

// read a catalog cost from an echo id with a configurable fallback
export function getEchoCostById(echoId: string, fallback = 0): number {
  return getEchoById(echoId)?.cost ?? fallback
}

// read the effective cost for an equipped echo instance
export function getEquippedEchoCost(echo: Pick<EchoInstance, 'id' | 'mainEcho'>): number {
  return getEchoCostById(echo.id, echo.mainEcho ? 4 : 1)
}

// sum equipped echoes into the familiar 12-cost total
export function computeTotalEchoCost(echoes: Array<EchoInstance | null>): number {
  return echoes.reduce((total, echo) => (
    echo ? total + getEchoCostById(echo.id) : total
  ), 0)
}

// keep heavier-cost echoes first for summary and preview displays
export function sortEchoesByCostDescending(echoes: Array<EchoInstance | null>): EchoInstance[] {
  return echoes
    .filter((echo): echo is EchoInstance => echo != null)
    .slice()
    .sort((left, right) => getEquippedEchoCost(right) - getEquippedEchoCost(left))
}
