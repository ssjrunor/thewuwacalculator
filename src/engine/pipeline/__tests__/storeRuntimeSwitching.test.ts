import { beforeEach, describe, expect, it } from 'vitest'
import { getResonatorById } from '@/domain/services/catalogService'
import { selectActiveRuntime } from '@/domain/state/selectors'
import { useAppStore } from '@/domain/state/store'

describe('store resonator switching', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
  })

  it('restores each resonator persisted runtime instead of inheriting the previous active slot state', () => {
    const phoebe = getResonatorById('1506')
    const shorekeeper = getResonatorById('1505')
    if (!phoebe || !shorekeeper) {
      throw new Error('missing test resonators')
    }

    useAppStore.getState().activateResonator(phoebe)
    useAppStore.getState().ensureResonatorRuntime(shorekeeper)

    const savedRotationItem = phoebe.rotations[0]?.items[0]
      ? structuredClone(phoebe.rotations[0].items[0])
      : null

    useAppStore.getState().updateActiveResonatorRuntime((prev) => ({
      ...prev,
      build: {
        ...prev.build,
        team: [prev.id, shorekeeper.id, null],
      },
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: {
            ...prev.state.manualBuffs.quick,
            critRate: 11,
          },
        },
      },
      rotation: {
        ...prev.rotation,
        personalItems: savedRotationItem ? [savedRotationItem] : prev.rotation.personalItems,
      },
    }))

    useAppStore.getState().activateResonator(shorekeeper)

    const runtimeAfterFirstSwitch = selectActiveRuntime(useAppStore.getState())
    expect(runtimeAfterFirstSwitch?.id).toBe(shorekeeper.id)
    expect(runtimeAfterFirstSwitch?.state.manualBuffs.quick.critRate).toBe(0)
    expect(runtimeAfterFirstSwitch?.build.team).toEqual([shorekeeper.id, null, null])

    useAppStore.getState().updateActiveResonatorRuntime((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: {
            ...prev.state.manualBuffs.quick,
            critRate: 22,
          },
        },
      },
    }))

    useAppStore.getState().activateResonator(phoebe)

    const runtimeAfterReturn = selectActiveRuntime(useAppStore.getState())
    expect(runtimeAfterReturn?.id).toBe(phoebe.id)
    expect(runtimeAfterReturn?.state.manualBuffs.quick.critRate).toBe(11)
    expect(runtimeAfterReturn?.build.team).toEqual([phoebe.id, shorekeeper.id, null])
    expect(runtimeAfterReturn?.rotation.personalItems).toEqual(
      savedRotationItem ? [savedRotationItem] : runtimeAfterReturn?.rotation.personalItems,
    )
  })
})
