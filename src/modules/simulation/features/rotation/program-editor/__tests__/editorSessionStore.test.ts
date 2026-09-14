/*
  Author: Runor Ewhro
  Description: Verifies the editorSessionStore.test behavior and its compatibility invariants.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRotationEditHistory } from '@/modules/simulation/features/rotation/program-editor/interaction/history.ts'
import {
  clearAllRotationEditorSessions,
  clearRotationEditorSession,
  ensureRotationEditorSession,
  getRotationEditorSession,
  getRotationEditorSessionGeneration,
  reconcileRotationEditorSession,
  updateRotationEditorSession,
  type RotationEditorSession,
} from '@/modules/simulation/features/rotation/program-editor/state/editorSessionStore.ts'

function makeSession(label: string): RotationEditorSession {
  return {
    result: null,
    sections: [{ id: label, title: label, meta: '', children: [] }],
    runsByLoopId: {},
    lastRanAt: 10,
    editHistory: emptyRotationEditHistory(),
    baselineItems: [],
    runBaselineKey: `${label}:run`,
    runBaselineSigs: new Map(),
    simulationKey: `${label}:draft`,
    runInputIdentity: null,
  }
}

describe('rotation editor session store', () => {
  beforeEach(() => clearAllRotationEditorSessions())

  it('keeps an owner draft when later app state offers another seed', () => {
    ensureRotationEditorSession('owner-a', () => makeSession('initial'))
    updateRotationEditorSession('owner-a', (current) => ({
      ...current,
      sections: [{ id: 'authored', title: 'Authored', meta: '', children: [] }],
      simulationKey: 'dirty',
      lastRanAt: null,
    }))

    const replacementSeed = vi.fn(() => makeSession('persisted-change'))
    const resumed = ensureRotationEditorSession('owner-a', replacementSeed)

    expect(replacementSeed).not.toHaveBeenCalled()
    expect(resumed.sections[0]?.id).toBe('authored')
    expect(resumed.simulationKey).toBe('dirty')
    expect(resumed.lastRanAt).toBeNull()
  })

  it('keeps independent drafts per owner and replaces only an explicitly cleared one', () => {
    const first = ensureRotationEditorSession('owner-a', () => makeSession('first'))
    const second = ensureRotationEditorSession('owner-b', () => makeSession('second'))

    expect(getRotationEditorSession('owner-a')).toBe(first)
    expect(getRotationEditorSession('owner-b')).toBe(second)

    const generation = getRotationEditorSessionGeneration('owner-a')
    clearRotationEditorSession('owner-a')
    expect(getRotationEditorSessionGeneration('owner-a')).toBe(generation + 1)
    const loaded = ensureRotationEditorSession('owner-a', () => makeSession('loaded'))

    expect(loaded.sections[0]?.id).toBe('loaded')
    expect(getRotationEditorSession('owner-b')).toBe(second)
  })

  it('records an explicit replacement before an owner has mounted', () => {
    expect(getRotationEditorSession('owner-c')).toBeNull()
    expect(getRotationEditorSessionGeneration('owner-c')).toBe(0)

    clearRotationEditorSession('owner-c')

    expect(getRotationEditorSessionGeneration('owner-c')).toBe(1)
  })

  it('refreshes evaluation once per workspace without replacing the standing draft', () => {
    const firstWorkspace = {}
    const secondWorkspace = {}
    const session = {
      ...makeSession('initial'),
      runInputIdentity: firstWorkspace,
      sections: [{ id: 'authored', title: 'Authored', meta: '', children: [] }],
    }
    ensureRotationEditorSession('owner-a', () => session)
    const refresh = vi.fn((current: RotationEditorSession) => ({
      ...current,
      runBaselineKey: 'recalculated',
    }))

    const reconciled = reconcileRotationEditorSession(
      'owner-a',
      secondWorkspace,
      refresh,
    )
    const repeated = reconcileRotationEditorSession(
      'owner-a',
      secondWorkspace,
      refresh,
    )

    expect(refresh).toHaveBeenCalledOnce()
    expect(reconciled?.sections[0]?.id).toBe('authored')
    expect(reconciled?.runBaselineKey).toBe('recalculated')
    expect(reconciled?.runInputIdentity).toBe(secondWorkspace)
    expect(repeated).toBe(reconciled)
  })
})
