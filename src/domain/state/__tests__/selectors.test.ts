import { describe, expect, it } from 'vitest'
import type { AppStore } from '@/domain/state/store'
import { createDefaultAppState } from '@/domain/state/defaults'
import { selectWorkspaceDerived } from '@/domain/state/selectors'

function asAppStore() {
  return createDefaultAppState() as unknown as AppStore
}

describe('workspace prepared selectors', () => {
  it('reuses prepared workspace for non-runtime calculator changes', () => {
    const initial = asAppStore()
    const first = selectWorkspaceDerived(initial)

    const secondState = {
      ...initial,
      calculator: {
        ...initial.calculator,
        suggestionsByResonatorId: {
          ...initial.calculator.suggestionsByResonatorId,
        },
      },
    } as AppStore

    const second = selectWorkspaceDerived(secondState)

    expect(second.preparedWorkspace).toBe(first.preparedWorkspace)
  })

  it('rebuilds prepared workspace when runtime revision changes', () => {
    const initial = asAppStore()
    const first = selectWorkspaceDerived(initial)

    const secondState = {
      ...initial,
      calculator: {
        ...initial.calculator,
        runtimeRevision: initial.calculator.runtimeRevision + 1,
      },
    } as AppStore

    const second = selectWorkspaceDerived(secondState)

    expect(second.preparedWorkspace).not.toBe(first.preparedWorkspace)
  })
})
