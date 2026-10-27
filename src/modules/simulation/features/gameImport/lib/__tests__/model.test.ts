/*
  Author: Runor Ewhro
  description: checks review defaults and equipment conflict choices.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/application/state/store'
import { applyPreparedYumeoGameData, prepareYumeoGameData } from '@/application/imports/yumeoGameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeAppState, makeResProfile, makeResRuntime } from '@/engine/runtime/defaults'
import {
  buildGameImportReview,
  defaultEchoSelection,
  echoLocked,
  openConflicts,
  reviewChoices,
  rowEchoes,
  slotKey,
  type ReviewPicks,
} from '../model'

function capture(contested: boolean, weapon = true) {
  return {
    version: 1 as const,
    resonators: [{ resonatorId: 1402, level: 80, chain: 6, skills: [] }],
    weapons: weapon ? [{ itemId: 21020024, level: 90, rank: 5, equippedByResonatorId: 1402 }] : [],
    echoes: [1860, 1861].map((instanceId) => ({
      instanceId, monsterId: 6000053, echoSetId: 6, level: 25,
      mainStats: [{ statId: 5001, value: 22 }, { statId: 50003, value: 150 }],
      subStats: [{ statId: 11, value: instanceId === 1860 ? 6.3 : 8.1 }],
      ...(instanceId === 1860 || contested ? { equippedByResonatorId: 1402, slotIndex: 0 } : {}),
    })),
  }
}

const picks = (over: Partial<ReviewPicks> = {}): ReviewPicks => ({
  skip: new Set(), weapons: new Map(), slots: new Map(), echoes: new Set(), ...over,
})

describe('game import review model', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
    useAppStore.setState({ ...makeAppState(), invHydr: true })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('shows the weapon import keeps when the file names none', async () => {
    const prepared = await prepareYumeoGameData(JSON.stringify(capture(false, false)))
    const fresh = buildGameImportReview(prepared.review, {}, 'female').rows[0]
    expect(fresh.weaponFromFile).toBe(false)
    expect(fresh.file.weapon?.id).toBe(makeResProfile(getResSeedBy('1402')!).runtime.build.weapon.id)

    const current = makeResRuntime(getResSeedBy('1402')!)
    const held = { ...current, base: { ...current.base, level: 80, sequence: 6 }, build: { ...current.build, weapon: { ...current.build.weapon, id: '21020015', rank: 3 } } }
    const existing = buildGameImportReview(prepared.review, { '1402': held }, 'female').rows[0]
    expect(existing.file.weapon).toMatchObject({ id: '21020015', rank: 3 })
  })

  it('asks for a contested slot and lists every echo it could take', async () => {
    const prepared = await prepareYumeoGameData(JSON.stringify(capture(true)))
    const model = buildGameImportReview(prepared.review, {}, 'female')
    const [row] = model.rows
    expect(row.echoConflicts).toHaveLength(1)
    const contested = model.groups[0].items.filter((entry) => entry.sourceIndex != null)
    expect(contested.map((entry) => entry.echo.uid).sort()).toEqual(['game:1860', 'game:1861'])

    const open = picks({ echoes: defaultEchoSelection(model) })
    expect(openConflicts(model, open)).toEqual([{ row, slotIndex: 0 }])
    expect(rowEchoes(row, open)[0]).toBeNull()
    expect(contested.some((entry) => echoLocked(entry, open))).toBe(false)

    const picked = picks({ slots: new Map([[slotKey('1402', 0), 1]]), echoes: new Set(['game:1860']) })
    expect(openConflicts(model, picked)).toEqual([])
    expect(rowEchoes(row, picked)[0]?.substats.critRate).toBe(8.1)
    expect(contested.filter((entry) => echoLocked(entry, picked)).map((entry) => entry.echo.uid)).toEqual(['game:1861'])

    // leaving out the unworn one imports only the kept echo
    const choices = reviewChoices(prepared.review, model, picks({ slots: picked.slots }))
    expect(choices.equipment?.echoSlots).toEqual([{ resonatorId: '1402', slotIndex: 0, sourceIndex: 1 }])
    expect(choices.excludedEchoUids).toEqual(['game:1860'])
    applyPreparedYumeoGameData(prepared, choices)
    expect(useAppStore.getState().library.echoes.map((entry) => entry.echo.substats.critRate)).toEqual([8.1])
  })
})
