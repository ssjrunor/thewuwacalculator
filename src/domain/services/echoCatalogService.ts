/*
  Author: Runor Ewhro
  Description: Provides echo catalog lookup helpers for listing echoes,
               resolving echoes by id, and grouping them by cost or set.
*/

import {
  getEchoCatalog,
  getEchoCatalogByCost,
  getEchoCatalogById,
} from '@/data/gameData/catalog/echoes'
import type { EchoDefinition } from '@/domain/entities/catalog'

// list all echo definitions
export function listEchoes(): EchoDefinition[] {
  return getEchoCatalog()
}

// get one echo definition by id
export function getEchoById(echoId: string): EchoDefinition | null {
  return getEchoCatalogById()[echoId] ?? null
}

// list echoes filtered by cost
export function listEchoesByCost(cost: number): EchoDefinition[] {
  return getEchoCatalogByCost()[cost] ?? []
}

// get the set ids associated with an echo
export function getEchoSets(echoId: string): number[] {
  return getEchoCatalogById()[echoId]?.sets ?? []
}
