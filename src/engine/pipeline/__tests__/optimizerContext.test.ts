import { beforeEach, describe, expect, it } from 'vitest'
import { getResonatorById } from '@/domain/services/catalogService'
import { useAppStore } from '@/domain/state/store'

describe('optimizer context', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
  })

  it('creates an isolated optimizer context from the active runtime', () => {
    const phoebe = getResonatorById('1506')
    if (!phoebe) {
      throw new Error('missing test resonator 1506')
    }

    useAppStore.getState().activateResonator(phoebe)
    useAppStore.getState().updateActiveResonatorRuntime((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: {
            ...prev.state.manualBuffs.quick,
            critRate: 17,
          },
        },
      },
    }))

    useAppStore.getState().ensureOptimizerContext()

    const state = useAppStore.getState()
    expect(state.calculator.optimizerContext?.resonatorId).toBe('1506')
    expect(state.calculator.optimizerContext?.runtime.state.manualBuffs.quick.critRate).toBe(17)
    expect(state.calculator.optimizerContext?.settings.targetSkillId).toBeTruthy()
    expect(state.calculator.optimizerContext?.settings.targetMode).toBe('skill')
    expect(state.calculator.optimizerContext?.settings.targetComboSourceId).toBe('live:1506')
    expect((state.calculator.optimizerContext?.settings.mainStatFilter.length ?? 0) > 0).toBe(true)

    useAppStore.getState().updateOptimizerRuntime((runtime) => ({
      ...runtime,
      state: {
        ...runtime.state,
        manualBuffs: {
          ...runtime.state.manualBuffs,
          quick: {
            ...runtime.state.manualBuffs.quick,
            critRate: 33,
          },
        },
      },
    }))

    const nextState = useAppStore.getState()
    expect(nextState.calculator.optimizerContext?.runtime.state.manualBuffs.quick.critRate).toBe(33)
    expect(nextState.calculator.profiles['1506']?.runtime.local.manualBuffs.quick.critRate).toBe(17)
  })

  it('reuses the existing context for the same resonator and replaces it for a different one', () => {
    const phoebe = getResonatorById('1506')
    const shorekeeper = getResonatorById('1505')
    if (!phoebe || !shorekeeper) {
      throw new Error('missing test resonators')
    }

    useAppStore.getState().activateResonator(phoebe)
    useAppStore.getState().ensureOptimizerContext()
    useAppStore.getState().updateOptimizerRuntime((runtime) => ({
      ...runtime,
      state: {
        ...runtime.state,
        manualBuffs: {
          ...runtime.state.manualBuffs,
          quick: {
            ...runtime.state.manualBuffs.quick,
            critRate: 21,
          },
        },
      },
    }))

    useAppStore.getState().ensureOptimizerContext()
    expect(useAppStore.getState().calculator.optimizerContext?.runtime.state.manualBuffs.quick.critRate).toBe(21)

    useAppStore.getState().activateResonator(shorekeeper)
    useAppStore.getState().ensureOptimizerContext()

    const nextContext = useAppStore.getState().calculator.optimizerContext
    expect(nextContext?.resonatorId).toBe('1505')
    expect(nextContext?.runtime.state.manualBuffs.quick.critRate).toBe(0)
  })

  it('syncs optimizer runtime back to the live runtime without dropping settings', () => {
    const phoebe = getResonatorById('1506')
    if (!phoebe) {
      throw new Error('missing test resonator 1506')
    }

    useAppStore.getState().activateResonator(phoebe)
    useAppStore.getState().updateActiveResonatorRuntime((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: {
            ...prev.state.manualBuffs.quick,
            critRate: 12,
          },
        },
      },
    }))
    useAppStore.getState().ensureOptimizerContext()

    const initialSkillId = useAppStore.getState().calculator.optimizerContext?.settings.targetSkillId ?? null

    useAppStore.getState().updateOptimizerRuntime((runtime) => ({
      ...runtime,
      state: {
        ...runtime.state,
        manualBuffs: {
          ...runtime.state.manualBuffs,
          quick: {
            ...runtime.state.manualBuffs.quick,
            critRate: 41,
          },
        },
      },
    }))
    useAppStore.getState().updateActiveResonatorRuntime((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: {
            ...prev.state.manualBuffs.quick,
            critRate: 28,
          },
        },
      },
    }))

    useAppStore.getState().syncOptimizerContextToLiveRuntime()

    const nextContext = useAppStore.getState().calculator.optimizerContext
    expect(nextContext?.runtime.state.manualBuffs.quick.critRate).toBe(28)
    expect(nextContext?.settings.targetSkillId).toBe(initialSkillId)
  })
})
