import { beforeEach, describe, expect, it } from 'vitest'
import { ECHO_PRIMARY_STATS, ECHO_SECONDARY_STATS } from '@/data/gameData/catalog/echoStats'
import type { EchoInstance } from '@/domain/entities/runtime'
import type { RotationNode } from '@/domain/gameData/contracts'
import { createEchoUid } from '@/domain/entities/runtime'
import { cloneRotationNodes } from '@/domain/entities/inventoryStorage'
import { listEchoes } from '@/domain/services/echoCatalogService'
import { getResonatorById } from '@/domain/services/resonatorCatalogService'
import { DEFAULT_RESONATOR_ID } from '@/domain/state/defaults'
import { selectActiveRuntime } from '@/domain/state/selectors'
import { useAppStore } from '@/domain/state/store'

function makeEchoInstance(echoId: string, slotIndex = 0): EchoInstance {
  const definition = listEchoes().find((echo) => echo.id === echoId)
  if (!definition) {
    throw new Error(`missing echo ${echoId}`)
  }

  const primaryStats = ECHO_PRIMARY_STATS[definition.cost]
  const secondaryStat = ECHO_SECONDARY_STATS[definition.cost]
  const primaryKey = Object.keys(primaryStats)[0]

  return {
    uid: createEchoUid(),
    id: definition.id,
    set: definition.sets[0] ?? 0,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: { key: primaryKey, value: primaryStats[primaryKey] },
      secondary: { key: secondaryStat.key, value: secondaryStat.value },
    },
    substats: {
      critRate: 6.3,
      critDmg: 12.6,
    },
  }
}

describe('echo bag and build bag', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    const defaultSeed = getResonatorById(DEFAULT_RESONATOR_ID)
    if (!defaultSeed) {
      throw new Error(`missing default resonator ${DEFAULT_RESONATOR_ID}`)
    }

    useAppStore.getState().activateResonator(defaultSeed)
  })

  it('dedupes identical echoes in the global echo bag', () => {
    const echo = makeEchoInstance(listEchoes()[0].id)

    const first = useAppStore.getState().addEchoToInventory(echo)
    const second = useAppStore.getState().addEchoToInventory({ ...echo, mainEcho: false })

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(useAppStore.getState().calculator.inventoryEchoes).toHaveLength(1)
  })

  it('replaces inventory echoes from an imported bag and dedupes equivalent entries', () => {
    const echo = makeEchoInstance(listEchoes()[0].id)

    useAppStore.getState().replaceInventoryEchoes([
      echo,
      { ...echo, mainEcho: true },
    ])

    expect(useAppStore.getState().calculator.inventoryEchoes).toHaveLength(1)
    expect(useAppStore.getState().calculator.inventoryEchoes[0]?.echo.id).toBe(echo.id)
  })

  it('saves and restores full build snapshots instead of echo-only presets', () => {
    const runtime = selectActiveRuntime(useAppStore.getState())
    if (!runtime) {
      throw new Error('missing active runtime')
    }

    const savedEcho = makeEchoInstance(listEchoes()[0].id, 0)

    useAppStore.getState().updateActiveResonatorRuntime((prev) => ({
      ...prev,
      build: {
        ...prev.build,
        weapon: {
          ...prev.build.weapon,
          rank: 3,
        },
        echoes: [savedEcho, null, null, null, null],
      },
    }))

    const snapshot = selectActiveRuntime(useAppStore.getState())
    if (!snapshot) {
      throw new Error('missing updated runtime')
    }

    const savedBuild = useAppStore.getState().addBuildToInventory({
      resonatorId: snapshot.id,
      resonatorName: snapshot.id,
      build: {
        weapon: { ...snapshot.build.weapon },
        echoes: snapshot.build.echoes,
      },
    })

    expect(savedBuild).not.toBeNull()
    expect(savedBuild?.build.weapon.rank).toBe(3)
    expect(savedBuild?.build.echoes[0]?.id).toBe(savedEcho.id)

    useAppStore.getState().updateActiveResonatorRuntime((prev) => ({
      ...prev,
      build: {
        ...prev.build,
        weapon: {
          ...prev.build.weapon,
          rank: 1,
        },
        echoes: [null, null, null, null, null],
      },
    }))

    useAppStore.getState().updateActiveResonatorRuntime((prev) => ({
      ...prev,
      build: {
        ...prev.build,
        weapon: { ...savedBuild!.build.weapon },
        echoes: savedBuild!.build.echoes,
      },
    }))

    const restored = selectActiveRuntime(useAppStore.getState())
    expect(restored?.build.weapon.rank).toBe(3)
    expect(restored?.build.echoes[0]?.id).toBe(savedEcho.id)
  })

  it('stores saved rotations globally at the inventory level', () => {
    const runtime = selectActiveRuntime(useAppStore.getState())
    if (!runtime) {
      throw new Error('missing active runtime')
    }

    const entry = useAppStore.getState().addRotationToInventory({
      name: 'Stored Personal Rotation',
      mode: 'personal',
      resonatorId: runtime.id,
      resonatorName: runtime.id,
      items: [
        {
          id: 'rotation:repeat',
          type: 'repeat',
          times: 1,
          enabled: true,
          items: [],
        },
      ],
    })

    expect(entry).not.toBeNull()
    expect(useAppStore.getState().calculator.inventoryRotations).toHaveLength(1)
    expect(useAppStore.getState().calculator.inventoryRotations[0]?.name).toBe('Stored Personal Rotation')
  })

  it('clones appended rotations with fresh recursive node ids', () => {
    const original: RotationNode[] = [
      {
        id: 'repeat:root',
        type: 'repeat',
        times: 2,
        enabled: true,
        items: [
          {
            id: 'feature:child',
            type: 'feature',
            resonatorId: '1208',
            featureId: 'damage:test-feature',
            multiplier: 1,
            enabled: true,
            condition: {
              type: 'truthy',
              path: 'runtime.state.controls.test',
            },
          },
        ],
      },
    ]

    const cloned = cloneRotationNodes(original, { freshIds: true })

    expect(cloned).toHaveLength(1)
    expect(cloned[0]?.id).not.toBe(original[0]?.id)
    expect(cloned[0]?.type).toBe('repeat')
    expect(cloned[0]?.type === 'repeat' ? cloned[0].items[0]?.id : null).not.toBe(
      original[0]?.type === 'repeat' ? original[0].items[0]?.id : null,
    )
    expect(cloned[0]).not.toBe(original[0])
  })
})
