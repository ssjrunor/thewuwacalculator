import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/application/state/store'
import { scenarioIdForContextResonator } from '@/domain/entities/scenarioLibrary'
import { makeAppState } from '@/engine/runtime/defaults'
import { openYumeoGameDataImport } from '../session'

const capture = JSON.stringify({
  version: 1,
  resonators: [{ resonatorId: 1402, level: 80 }],
  weapons: [],
  echoes: [],
})

describe('Yumeo game-data import entry point', () => {
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

  it.each([
    ['JSON text', () => capture],
    ['a JSON file', () => new File([capture], 'yumeo-game-data.json', { type: 'application/json' })],
  ])('prepares %s without applying it, then commits the reviewed import', async (_label, source) => {
    const session = await openYumeoGameDataImport(source())
    expect(session.kind).toBe('yumeoGameData')
    expect(session.review.resonators.map((resonator) => resonator.id)).toEqual(['1402'])
    expect(scenarioIdForContextResonator(useAppStore.getState().combat, '1402')).toBeFalsy()

    expect(session.apply()).toMatchObject({ resonators: 1, echoesAdded: 0 })
    const scenarioId = scenarioIdForContextResonator(useAppStore.getState().combat, '1402')!
    const member = useAppStore.getState().combat.scenariosById[scenarioId].team.members[0]
    expect(member.progression.level).toBe(80)
    expect(member.loadout.echoes).toEqual([null, null, null, null, null])
  })
})
