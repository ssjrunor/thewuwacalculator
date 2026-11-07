/*
  Author: Runor Ewhro
  description: tests loading saved rotation steps into a working context.
*/

import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/application/state/store.ts'
import { consumePersist } from '@/application/persistence/storage.ts'
import { ensureResonatorData } from '@/data/gameData'
import { listResSds } from '@/data/catalog/resonatorSeedService.ts'
import { contextScenarioMember, makeScenarioTeam, primaryScenarioMember } from '@/domain/entities/combatScenario.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { loadRotationScenario } from '../useLoadRotation.ts'
import { makeResProfile, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults.ts'
import { emptyRotationEditHistory } from '../../interaction/history.ts'
import {
  clearAllRotationEditorSessions,
  ensureRotationEditorSession,
  getRotationEditorSession,
} from '../../state/editorSessionStore.ts'

function seedEditorSession(ownerId: string) {
  return ensureRotationEditorSession(ownerId, () => ({
    result: null,
    sections: [],
    runsByLoopId: {},
    lastRanAt: null,
    editHistory: emptyRotationEditHistory(),
    baselineItems: [],
    runBaselineKey: 'previous-rotation',
    runBaselineSigs: new Map(),
    simulationKey: 'previous-rotation',
    runInputIdentity: null,
  }))
}

describe('saved rotation loading', () => {
  beforeEach(() => {
    clearAllRotationEditorSessions()
    useAppStore.getState().resetState()
    consumePersist()
  })

  it.each(['build', 'rotation'] as const)('resets the displayed draft when loading %s into a reordered team', async (mode) => {
    const current = selectedCombatScenario(useAppStore.getState().combat)
    const contextId = contextScenarioMember(current).resonatorId
    const otherSeed = listResSds().find((seed) => seed.id !== contextId)!
    const teammate = makeScenarioMemberFromProfile(makeResProfile(otherSeed))
    useAppStore.getState().insertScenarioMember(current.id, 0, teammate)
    const saved = structuredClone(selectedCombatScenario(useAppStore.getState().combat))
    expect(primaryScenarioMember(saved).resonatorId).toBe(otherSeed.id)
    expect(contextScenarioMember(saved).resonatorId).toBe(contextId)

    const displayedOwner = primaryScenarioMember(saved).resonatorId
    // Rotation-only loads retain the destination team, even if the incoming
    // snapshot has another member in its first seat.
    if (mode === 'rotation') saved.team = makeScenarioTeam([...saved.team.members].reverse())
    seedEditorSession(displayedOwner)
    const unrelatedOwner = listResSds().find((seed) => ![contextId, displayedOwner].includes(seed.id))!.id
    const unrelatedSession = seedEditorSession(unrelatedOwner)

    await loadRotationScenario(saved, mode)

    expect(getRotationEditorSession(displayedOwner)).toBeNull()
    expect(getRotationEditorSession(unrelatedOwner)).toBe(unrelatedSession)
  })

  it('opens the saved resonator context and replaces only its steps', async () => {
    const initialId = contextScenarioMember(selectedCombatScenario(useAppStore.getState().combat)).resonatorId
    const otherSeed = listResSds().find((seed) => seed.id !== initialId)!
    await ensureResonatorData([otherSeed.id])
    useAppStore.getState().swRes(otherSeed.id)

    const before = structuredClone(selectedCombatScenario(useAppStore.getState().combat))
    const saved = structuredClone(before)
    const step: RotationNode = {
      id: 'saved-context-step',
      type: 'feature',
      featureId: 'saved-feature',
      resonatorId: otherSeed.id,
      enabled: true,
      multiplier: 1,
    }
    saved.program.program = [step]
    saved.target.level += 10
    saved.team.members[0].progression.level = 42
    useAppStore.getState().swRes(initialId)

    await loadRotationScenario(saved, 'rotation')

    const after = selectedCombatScenario(useAppStore.getState().combat)
    expect(contextScenarioMember(after).resonatorId).toBe(otherSeed.id)
    expect(after.program.program).toEqual([step])
    expect(after.team).toEqual(before.team)
    expect(after.target).toEqual(before.target)
    expect(after.environment).toEqual(before.environment)
  })
})
