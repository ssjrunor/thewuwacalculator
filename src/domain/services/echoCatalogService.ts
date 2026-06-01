/*
  Author: Runor Ewhro
  Description: Provides echo catalog lookup helpers for listing echoes,
               resolving echoes by id, and grouping them by cost or set.
*/

import {
  getEchoCat,
  getEchoByCost,
  getEchoCatBy,
} from '@/data/gameData/catalog/echoes'
import type { EchoDef } from '@/domain/entities/catalog'

// list all echo definitions
export function listEchoes(): EchoDef[] {
  return getEchoCat()
}

// get one echo definition by id
export function getEchoById(echoId: string): EchoDef | null {
  return getEchoCatBy()[echoId] ?? null
}

// list echoes filtered by cost
export function listChsByCos(cost: number): EchoDef[] {
  return getEchoByCost()[cost] ?? []
}

// get the set ids associated with an echo
export function getEchoSets(echoId: string): number[] {
  return getEchoCatBy()[echoId]?.sets ?? []
}
