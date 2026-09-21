/*
  Author: Runor Ewhro
  Description: Verifies per-owner draft retention, evaluated-result refresh,
               and explicit replacement boundaries in the editor session store.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRotationEditHistory } from '@/modules/simulation/surfaces/rotation/program-editor/interaction/history.ts'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { buildRun, displayedRunMs, withRunMetadata } from '../simulation/runProgram.ts'
import {
  clearAllRotationEditorSessions,
  clearRotationEditorSession,
  ensureRotationEditorSession,
  getRotationEditorSession,
  getRotationEditorSessionGeneration,
  reconcileRotationEditorSession,
  updateRotationEditorSession,
  type RotationEditorSession,
} from '@/modules/simulation/surfaces/rotation/program-editor/state/editorSessionStore.ts'

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

function timedResult(totalMs: number, ranAt: number) {
  const seed = getResSeedBy('1108')!
  const runtime = makeResRuntime(seed)
  const result = buildRun({
    runtime,
    seed,
    runtimesById: { [runtime.id]: runtime },
    enemy: makeEnemy(),
    members: [],
    items: [],
  })
  return withRunMetadata(result, {
    ranAt,
    timing: { prepareMs: 0, executeMs: totalMs, projectMs: 0, totalMs, cacheHit: false },
  })
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

  it('retains the toasted Run timing through refreshes and accepts timing from the next Run', () => {
    const authored = timedResult(123.6, 10)
    ensureRotationEditorSession('owner-a', () => ({ ...makeSession('initial'), result: authored }))
    const recalculated = timedResult(2.1, 20)
    const first = reconcileRotationEditorSession('owner-a', {}, (current) => ({
      ...current,
      result: recalculated,
    }))!

    expect(displayedRunMs(first.result)).toBe(displayedRunMs(authored))
    expect(first.result?.ranAt).toBe(authored.ranAt)
    expect(first.result?.timing).toBe(authored.timing)
    expect(first.result?.sections).toBe(recalculated.sections)
    expect(recalculated.timing.totalMs).toBe(2.1)

    const nextRun = timedResult(45.4, 30)
    updateRotationEditorSession('owner-a', (current) => ({ ...current, result: nextRun }))
    const second = reconcileRotationEditorSession('owner-a', {}, (current) => ({
      ...current,
      result: recalculated,
    }))!

    expect(displayedRunMs(second.result)).toBe(displayedRunMs(nextRun))
    expect(second.result?.ranAt).toBe(nextRun.ranAt)
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
