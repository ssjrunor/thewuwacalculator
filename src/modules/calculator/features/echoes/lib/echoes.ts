/*
  Author: Runor Ewhro
  Description: shared echo helpers for cost lookups, total cost summaries,
               and cost-based sorting used across calculator ui surfaces.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'

// read a catalog cost from an echo id with a configurable fallback
export function getEchoCostB(echoId: string, fallback = 0): number {
  return getEchoById(echoId)?.cost ?? fallback
}

// read the effective cost for an equipped echo instance
export function getQppdEchoC(echo: Pick<EchoInstance, 'id' | 'mainEcho'>): number {
  return getEchoCostB(echo.id, echo.mainEcho ? 4 : 1)
}

// sum equipped echoes into the familiar 12-cost total
export function cmptTtlEchoC(echoes: Array<EchoInstance | null>): number {
  return echoes.reduce((total, echo) => (
    echo ? total + getEchoCostB(echo.id) : total
  ), 0)
}

// keep heavier-cost echoes first for summary and preview displays
export function sortByCost(echoes: Array<EchoInstance | null>): EchoInstance[] {
  return echoes
    .filter((echo): echo is EchoInstance => echo != null)
    .slice()
    .sort((left, right) => getQppdEchoC(right) - getQppdEchoC(left))
}
