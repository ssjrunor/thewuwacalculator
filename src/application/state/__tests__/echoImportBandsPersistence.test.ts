/*
  Author: Runor Ewhro
  Description: Keeps Echo import choices across modal sessions and persisted UI
               reloads, while older snapshots retain the original defaults.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { persistedSchema } from '@/engine/runtime/schema'
import { selectPersisted } from '@/application/state/serialization'
import { useAppStore } from '@/application/state/store'
import { APPSTOREUILY, consumePersist, loadPrssAppS, saveAppState } from '@/application/persistence/storage'

describe('Echo import band preferences', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it('defaults older snapshots to all three bands', () => {
    const snapshot = structuredClone(selectPersisted(useAppStore.getState())) as unknown as {
      ui: { preferences: Record<string, unknown> }
    }
    delete snapshot.ui.preferences.echoImportBands

    expect(persistedSchema.parse(snapshot).ui.preferences.echoImportBands).toEqual({
      resonator: true,
      weapon: true,
      echoes: true,
    })
  })

  it('saves the selected bands in the UI layout domain', () => {
    const bands = { resonator: false, weapon: false, echoes: true }
    useAppStore.getState().setEchoImportBands(bands)
    expect(consumePersist()).toEqual(['ui.layout'])

    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      get length() { return values.size },
    } as Storage)
    try {
      saveAppState(useAppStore.getState(), { domains: ['ui.layout'] })
      const stored = JSON.parse(values.get(APPSTOREUILY) ?? '{}') as {
        ui?: { preferences?: { echoImportBands?: typeof bands } }
      }
      expect(stored.ui?.preferences?.echoImportBands).toEqual(bands)
      expect(loadPrssAppS({ includeInventory: false })?.ui.preferences.echoImportBands).toEqual(bands)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
