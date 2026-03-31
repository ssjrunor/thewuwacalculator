/*
  Author: Runor Ewhro
  Description: Module-level cache for the echo catalog, populated from
               public JSON before calculator consumers are imported.
*/

import type { EchoDefinition } from '@/domain/entities/catalog'

let echoCatalogCache: EchoDefinition[] = []
let echoCatalogByIdCache: Record<string, EchoDefinition> = {}
let echoCatalogByCostCache: Record<number, EchoDefinition[]> = {}

export function initEchoCatalog(catalog: EchoDefinition[]): void {
  echoCatalogCache = catalog
  echoCatalogByIdCache = Object.fromEntries(catalog.map((echo) => [echo.id, echo]))
  echoCatalogByCostCache = catalog.reduce<Record<number, EchoDefinition[]>>((acc, echo) => {
    ;(acc[echo.cost] ??= []).push(echo)
    return acc
  }, {})
}

export function getEchoCatalog(): EchoDefinition[] {
  return echoCatalogCache
}

export function getEchoCatalogById(): Record<string, EchoDefinition> {
  return echoCatalogByIdCache
}

export function getEchoCatalogByCost(): Record<number, EchoDefinition[]> {
  return echoCatalogByCostCache
}
