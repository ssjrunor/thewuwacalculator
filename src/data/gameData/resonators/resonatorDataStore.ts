/*
  Author: Runor Ewhro
  Description: Module-level cache for resonator catalog and detail data,
               populated by initializeGameData() before the app renders.
*/

import type { ResDtls } from '@/domain/entities/resonator'
import type { ResSeed } from '@/domain/entities/runtime'

let catalogCache: ResSeed[] = []
let catByIdCch: Record<string, ResSeed> = {}
let dtlsByIdCch: Record<string, ResDtls> = {}

export function initResCat(catalog: ResSeed[]): void {
  catalogCache = catalog
  catByIdCch = Object.fromEntries(catalog.map((r) => [r.id, r]))
}

export function initResDtls(details: Record<string, ResDtls>): void {
  dtlsByIdCch = details
}

export function getResCat(): ResSeed[] {
  return catalogCache
}

export function getResCatByI(): Record<string, ResSeed> {
  return catByIdCch
}

export function getResDtlsBy(): Record<string, ResDtls> {
  return dtlsByIdCch
}
