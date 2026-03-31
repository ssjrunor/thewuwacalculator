/*
  Author: Runor Ewhro
  Description: Module-level cache for resonator catalog and detail data,
               populated by initializeGameData() before the app renders.
*/

import type { ResonatorDetails } from '@/domain/entities/resonator'
import type { ResonatorSeed } from '@/domain/entities/runtime'

let catalogCache: ResonatorSeed[] = []
let catalogByIdCache: Record<string, ResonatorSeed> = {}
let detailsByIdCache: Record<string, ResonatorDetails> = {}

export function initResonatorCatalog(catalog: ResonatorSeed[]): void {
  catalogCache = catalog
  catalogByIdCache = Object.fromEntries(catalog.map((r) => [r.id, r]))
}

export function initResonatorDetails(details: Record<string, ResonatorDetails>): void {
  detailsByIdCache = details
}

export function getResonatorCatalog(): ResonatorSeed[] {
  return catalogCache
}

export function getResonatorCatalogById(): Record<string, ResonatorSeed> {
  return catalogByIdCache
}

export function getResonatorDetailsById(): Record<string, ResonatorDetails> {
  return detailsByIdCache
}
