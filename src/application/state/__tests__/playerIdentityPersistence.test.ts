/*
  Author: Runor Ewhro
  Description: Locks defaulting and split-layout persistence for the player
               identity extracted from build-card screenshots.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { persistedSchema } from '@/engine/runtime/schema'
import { selectPersisted } from '@/application/state/serialization'
import { useAppStore } from '@/application/state/store'
import {
  APPSTOREUILY,
  consumePersist,
  loadPrssAppS,
  saveAppState,
} from '@/application/persistence/storage'

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  } as Storage
}

describe('player identity persistence', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it('defaults older snapshots that do not contain player identity', () => {
    const snapshot = structuredClone(selectPersisted(useAppStore.getState())) as unknown as {
      ui: { preferences: Record<string, unknown> }
    }
    delete snapshot.ui.preferences.playerId
    delete snapshot.ui.preferences.playerUid

    const parsed = persistedSchema.parse(snapshot)

    expect(parsed.ui.preferences.playerId).toBe('')
    expect(parsed.ui.preferences.playerUid).toBe('')
  })

  it('writes and reloads player identity through the ui layout domain', () => {
    useAppStore.getState().setPlayerIdentity(' xuri ', ' 500395087 ')

    expect(useAppStore.getState().ui.preferences).toMatchObject({
      playerId: 'xuri',
      playerUid: '500395087',
    })
    expect(consumePersist()).toEqual(['ui.layout'])

    vi.stubGlobal('localStorage', makeMemoryStorage())
    try {
      saveAppState(useAppStore.getState(), { domains: ['ui.layout'] })
      const stored = JSON.parse(localStorage.getItem(APPSTOREUILY) ?? '{}') as {
        ui?: { preferences?: Record<string, unknown> }
      }
      expect(stored.ui?.preferences).toMatchObject({
        playerId: 'xuri',
        playerUid: '500395087',
      })

      const reloaded = loadPrssAppS({ includeInventory: false })
      expect(reloaded?.ui.preferences).toMatchObject({
        playerId: 'xuri',
        playerUid: '500395087',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
