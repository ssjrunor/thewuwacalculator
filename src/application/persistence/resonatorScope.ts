/*
  Author: Runor Ewhro
  Description: Extracts resonator dependencies from persisted workspace records
               before state schemas or the application store are loaded.
*/

import { decompressFromUTF16 } from 'lz-string'
import { APP_STORAGE_KEY, APPSTORECMBT, APPSTORECMBTINDEX } from './storageKeys'
import { DEF_RES_ID } from '@/data/gameData/constants'

export function collectResonatorIds(value: unknown): string[] {
  const ids = new Set<string>()
  const seen = new WeakSet<object>()
  const visit = (node: unknown, key = ''): void => {
    if (typeof node === 'string') {
      if (/^(resonatorId|activeResonatorId|optimizerSettingsResonatorId)$/.test(key) && /^\d{4}$/.test(node)) ids.add(node)
      return
    }
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) {
        if (key === 'team' && typeof item === 'string' && /^\d{4}$/.test(item)) ids.add(item)
        else visit(item)
      }
      return
    }
    // Do not hydrate lazy scenario records while collecting a dependency list.
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(node))) {
      if ('value' in descriptor) visit(descriptor.value, name)
    }
  }
  visit(value)
  return [...ids]
}

export function readStoredScenarioIds(recordKey: string): string[] {
  const raw = localStorage.getItem(recordKey)
  if (!raw) return []
  const json = raw.startsWith('wwcalc-lz1:') ? decompressFromUTF16(raw.slice('wwcalc-lz1:'.length)) : raw
  return json ? collectResonatorIds(JSON.parse(json)) : []
}

export function readBootstrapResonatorIds(): string[] {
  const ids = new Set([DEF_RES_ID])
  if (typeof localStorage === 'undefined') return [...ids]
  try {
    const rawIndex = localStorage.getItem(APPSTORECMBTINDEX)
    if (rawIndex) {
      const index = JSON.parse(rawIndex) as { selectedScenarioId?: string; recordsById?: Record<string, string> }
      const key = index.selectedScenarioId && index.recordsById?.[index.selectedScenarioId]
      if (key) {
        for (const id of readStoredScenarioIds(key)) ids.add(id)
        return [...ids]
      }
    }
    // Older snapshots migrate once through the existing validated loader.
    for (const key of [APPSTORECMBT, APP_STORAGE_KEY, ...[26, 25, 24, 23, 22].map((v) => `wwcalc.app.v${v}`)]) {
      const raw = localStorage.getItem(key)
      if (raw) for (const id of collectResonatorIds(JSON.parse(raw))) ids.add(id)
    }
  } catch {
    // Persistence owns corruption recovery; this preflight only discovers kits.
  }
  return [...ids]
}
