import { beforeEach, describe, expect, it } from 'vitest'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import type { EchoInstance } from '@/domain/entities/runtime'
import type { RotationNode } from '@/domain/gameData/contracts'
import { makeEchoUid } from '@/domain/entities/runtime'
import type { InvEchoEnt } from '@/domain/entities/inventoryStorage'
import { cloneRotNds, dedupeInvEchoUids, makeInvEcho } from '@/domain/entities/inventoryStorage'
import { listEchoes } from '@/domain/services/echoCatalogService'
import { getResById } from '@/domain/services/resonatorCatalogService'
import { DEF_RES_ID } from '@/domain/state/defaults'
import { selActRt } from '@/domain/state/selectors'
import { useAppStore } from '@/domain/state/store'

function makeEchoInstance(echoId: string, slotIndex = 0): EchoInstance {
  const definition = listEchoes().find((echo) => echo.id === echoId)
  if (!definition) {
    throw new Error(`missing echo ${echoId}`)
  }

  const primaryStats = ECHO_MAIN_STATS[definition.cost]
  const secondaryStat = ECHO_SIDE_STATS[definition.cost]
  const primaryKey = Object.keys(primaryStats)[0]

  return {
    uid: makeEchoUid(),
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
    const defaultSeed = getResById(DEF_RES_ID)
    if (!defaultSeed) {
      throw new Error(`missing default resonator ${DEF_RES_ID}`)
    }

    useAppStore.getState().actRes(defaultSeed)
  })

  it('dedupes identical echoes in the global echo bag', () => {
    const echo = makeEchoInstance(listEchoes()[0].id)

    const first = useAppStore.getState().addInvEcho(echo)
    const second = useAppStore.getState().addInvEcho({ ...echo, mainEcho: false })

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(useAppStore.getState().calculator.inventoryEchoes).toHaveLength(1)
  })

  it('mints a fresh uid when a distinct echo reuses an existing bag uid', () => {
    const [defA, defB] = listEchoes()
    const first = makeEchoInstance(defA.id)
    const firstEntry = useAppStore.getState().addInvEcho(first)
    expect(firstEntry).not.toBeNull()

    // a different echo (different id/set) that happens to carry the same uid
    const collided = { ...makeEchoInstance(defB.id), uid: first.uid }
    const secondEntry = useAppStore.getState().addInvEcho(collided)

    const bag = useAppStore.getState().calculator.inventoryEchoes
    expect(bag).toHaveLength(2)
    expect(secondEntry).not.toBeNull()
    expect(secondEntry?.echo.uid).not.toBe(first.uid)
    expect(new Set(bag.map((entry) => entry.echo.uid)).size).toBe(2)
  })

  it('dedupes shared bag uids and keeps the uid on the equipped entry', () => {
    const sharedUid = makeEchoUid()
    const unequipped = makeInvEcho({ ...makeEchoInstance(listEchoes()[0].id), uid: sharedUid })
    const equipped = makeInvEcho({ ...makeEchoInstance(listEchoes()[1].id), uid: sharedUid })
    const entries: InvEchoEnt[] = [unequipped, equipped]

    // a loadout equips the second entry, passed as a stat-equal echo on that uid
    const deduped = dedupeInvEchoUids(entries, [{ ...equipped.echo }])

    const uids = deduped.map((entry) => entry.echo.uid)
    expect(new Set(uids).size).toBe(2)
    const equippedAfter = deduped.find((entry) => entry.id === equipped.id)
    const unequippedAfter = deduped.find((entry) => entry.id === unequipped.id)
    expect(equippedAfter?.echo.uid).toBe(sharedUid)
    expect(unequippedAfter?.echo.uid).not.toBe(sharedUid)
  })

  it('replaces inventory echoes from an imported bag and dedupes equivalent entries', () => {
    const echo = makeEchoInstance(listEchoes()[0].id)

    useAppStore.getState().rplInvEcho([
      echo,
      { ...echo, mainEcho: true },
    ])

    expect(useAppStore.getState().calculator.inventoryEchoes).toHaveLength(1)
    expect(useAppStore.getState().calculator.inventoryEchoes[0]?.echo.id).toBe(echo.id)
  })

  it('saves and restores full build snapshots instead of echo-only presets', () => {
    const runtime = selActRt(useAppStore.getState())
    if (!runtime) {
      throw new Error('missing active runtime')
    }

    const savedEcho = makeEchoInstance(listEchoes()[0].id, 0)

    useAppStore.getState().updActRt((prev) => ({
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

    const snapshot = selActRt(useAppStore.getState())
    if (!snapshot) {
      throw new Error('missing updated runtime')
    }

    const savedBuild = useAppStore.getState().addInvBuild({
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

    useAppStore.getState().updActRt((prev) => ({
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

    useAppStore.getState().updActRt((prev) => ({
      ...prev,
      build: {
        ...prev.build,
        weapon: { ...savedBuild!.build.weapon },
        echoes: savedBuild!.build.echoes,
      },
    }))

    const restored = selActRt(useAppStore.getState())
    expect(restored?.build.weapon.rank).toBe(3)
    expect(restored?.build.echoes[0]?.id).toBe(savedEcho.id)
  })

  it('stores saved rotations globally at the inventory level', () => {
    const runtime = selActRt(useAppStore.getState())
    if (!runtime) {
      throw new Error('missing active runtime')
    }

    const entry = useAppStore.getState().addInvRot({
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
    expect(useAppStore.getState().calculator.inventoryRotations[0]?.duration).toBe(0)
    expect(useAppStore.getState().calculator.inventoryRotations[0]?.note).toBe('')
  })

  it('normalizes saved rotation metadata updates', () => {
    const runtime = selActRt(useAppStore.getState())
    if (!runtime) {
      throw new Error('missing active runtime')
    }

    const entry = useAppStore.getState().addInvRot({
      name: 'Stored Personal Rotation',
      mode: 'personal',
      resonatorId: runtime.id,
      resonatorName: runtime.id,
      items: [],
    })

    if (!entry) {
      throw new Error('missing saved rotation entry')
    }

    useAppStore.getState().updInvRot(entry.id, {
      name: '  Updated Rotation  ',
      note: 'Line one\nLine two',
      duration: -5,
    })

    let savedEntry = useAppStore.getState().calculator.inventoryRotations[0]
    expect(savedEntry?.name).toBe('Updated Rotation')
    expect(savedEntry?.note).toBe('Line one\nLine two')
    expect(savedEntry?.duration).toBe(0)

    useAppStore.getState().updInvRot(entry.id, {
      duration: 21.5,
    })

    savedEntry = useAppStore.getState().calculator.inventoryRotations[0]
    expect(savedEntry?.duration).toBe(21.5)
  })

  it('clones appended rotations with fresh recursive node ids', () => {
    const original: RotationNode[] = [
      {
        id: 'loop:end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
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
      {
        id: 'loop:start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 1,
      },
    ]

    const cloned = cloneRotNds(original, { freshIds: true })

    expect(cloned).toHaveLength(3)
    expect(cloned[0]?.id).not.toBe(original[0]?.id)
    expect(cloned[1]?.type).toBe('repeat')
    expect(cloned[1]?.type === 'repeat' ? cloned[1].items[0]?.id : null).not.toBe(
      original[1]?.type === 'repeat' ? original[1].items[0]?.id : null,
    )
    expect(cloned[1]).not.toBe(original[1])
    expect(cloned[0]?.type === 'loop' ? cloned[0].loopId : null).not.toBe('loop-a')
    expect(cloned[0]?.type === 'loop' ? cloned[0].loopId : null).toBe(
      cloned[2]?.type === 'loop' ? cloned[2].loopId : null,
    )
  })
})
