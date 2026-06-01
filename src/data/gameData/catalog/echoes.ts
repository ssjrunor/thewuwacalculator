/*
  Author: Runor Ewhro
  Description: Module-level cache for the echo catalog, populated from
               public JSON before calculator consumers are imported.
*/

import type { EchoDef } from '@/domain/entities/catalog'

let echoCatCch: EchoDef[] = []
let echoCatByIdC: Record<string, EchoDef> = {}
let echoCatByCos: Record<number, EchoDef[]> = {}

export function initEchoCat(catalog: EchoDef[]): void {
  echoCatCch = catalog
  echoCatByIdC = Object.fromEntries(catalog.map((echo) => [echo.id, echo]))
  echoCatByCos = catalog.reduce<Record<number, EchoDef[]>>((acc, echo) => {
    ;(acc[echo.cost] ??= []).push(echo)
    return acc
  }, {})
}

export function getEchoCat(): EchoDef[] {
  return echoCatCch
}

export function getEchoCatBy(): Record<string, EchoDef> {
  return echoCatByIdC
}

export function getEchoByCost(): Record<number, EchoDef[]> {
  return echoCatByCos
}
