import { beforeEach, describe, expect, it } from 'vitest'
import { makeAppState } from '@/domain/state/defaults'
import { mkMptyHistSt } from '@/domain/state/history'
import { useAppStore } from '@/domain/state/store'

function resetStore() {
  useAppStore.getState().resetState()
  useAppStore.setState((state) => ({
    ...state,
    ...makeAppState(),
    invOpen: false,
    invEchoQ: '',
    invMounted: false,
    invHydr: false,
    history: mkMptyHistSt(),
  }))
}

describe('app history preferences', () => {
  beforeEach(() => {
    resetStore()
  })

  it('stops recording and clears stacks while history is disabled', () => {
    const store = useAppStore.getState()

    store.setBlurMode(true)
    expect(useAppStore.getState().history.past).toHaveLength(1)

    store.setHistOn(false)

    expect(useAppStore.getState().ui.haveHistory).toBe(false)
    expect(useAppStore.getState().history.past).toHaveLength(0)
    expect(useAppStore.getState().history.future).toHaveLength(0)
    expect(useAppStore.getState().canUndo()).toBe(false)
    expect(useAppStore.getState().canRedo()).toBe(false)

    store.setCtxMenu(false)

    expect(useAppStore.getState().history.past).toHaveLength(0)
    expect(useAppStore.getState().history.future).toHaveLength(0)
  })

  it('resumes recording from an empty stack when re-enabled', () => {
    const store = useAppStore.getState()

    store.setHistOn(false)
    store.setBlurMode(true)
    store.setHistOn(true)

    expect(useAppStore.getState().history.past).toHaveLength(0)

    store.setCtxMenu(false)

    expect(useAppStore.getState().history.past).toHaveLength(1)
    expect(useAppStore.getState().undoHist()[0]?.label).toBe('Changed Context Menu Mode')
  })

  it('trims existing stacks immediately when history max changes', () => {
    const store = useAppStore.getState()

    for (let index = 0; index < 7; index += 1) {
      store.setBlurMode(index % 2 === 0)
    }

    for (let index = 0; index < 6; index += 1) {
      useAppStore.getState().undo()
    }

    expect(useAppStore.getState().history.future).toHaveLength(6)

    store.setHistMax(5)

    expect(useAppStore.getState().ui.historyMax).toBe(5)
    expect(useAppStore.getState().history.future).toHaveLength(5)
    expect(useAppStore.getState().history.past).toHaveLength(1)
  })

  it('uses the selected history max for future writes', () => {
    const store = useAppStore.getState()

    store.setHistMax(5)

    for (let index = 0; index < 8; index += 1) {
      store.setBlurMode(index % 2 === 0)
    }

    expect(useAppStore.getState().history.past).toHaveLength(5)
  })
})
