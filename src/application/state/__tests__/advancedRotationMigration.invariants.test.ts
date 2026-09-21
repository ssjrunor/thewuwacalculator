/*
  Author: Runor Ewhro
  Description: Locks lossless advanced-rotation migration at scenario and artifact boundaries.
*/

import { beforeEach, describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { isRotationSequence } from '@/domain/gameData/rotationSequence.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { savedRotationItems } from '@/domain/entities/inventoryStorage.ts'
import { makeAppState } from '@/engine/runtime/defaults.ts'
import {
  acknowledgeAdvancedRotationMigrations,
  listPendingAdvancedRotationMigrations,
  migrateAdvancedScenarioRotations,
} from '@/engine/runtime/advancedRotationMigration.ts'
import { useAppStore } from '@/application/state/store.ts'
import { consumePersist } from '@/application/persistence/storage.ts'

const advancedItems: RotationNode[] = [{
  id: 'advanced-condition',
  type: 'condition',
  changes: [{ type: 'set', path: 'runtime.test', value: 1 }],
}]

describe('advanced rotation migration', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it('archives a working scenario exactly and resets only its compact sequence', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    scenario.program.sequence = structuredClone(advancedItems)
    scenario.program.program = structuredClone(advancedItems)
    scenario.program.program = [{ ...advancedItems[0], id: 'executed-program-condition' }]

    const result = migrateAdvancedScenarioRotations(state.library, state.combat, 999)
    const migrated = result.combat.scenariosById[scenario.id]

    expect(result.migrations).toHaveLength(1)
    expect(result.migrations[0].created).toBe(true)
    expect(savedRotationItems(result.migrations[0].savedRotation)).toEqual(advancedItems)
    expect(result.library.rotations).toHaveLength(1)
    expect(migrated.program.program).toEqual(scenario.program.program)
    expect(isRotationSequence(migrated.program.sequence, scenario.team.members[0].resonatorId)).toBe(true)
  })

  it('reuses a matching archive and preserves its user metadata', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    scenario.program.sequence = structuredClone(advancedItems)
    scenario.program.program = structuredClone(advancedItems)
    const archive = useAppStore.getState().addInvRot({
      name: 'My original name',
      duration: 19.25,
      note: 'Keep this note',
      scenario,
    })!
    const library = {
      ...state.library,
      rotations: [{ ...archive, migration: undefined }],
    }

    const result = migrateAdvancedScenarioRotations(library, state.combat, 999)
    expect(result.migrations[0].created).toBe(false)
    expect(result.library.rotations).toHaveLength(1)
    expect(result.library.rotations[0]).toMatchObject({
      id: archive.id,
      name: 'My original name',
      duration: 19.25,
      note: 'Keep this note',
      migration: { source: 'advanced-sequence', acknowledged: false },
    })
  })

  it('migrates and acknowledges through the pane-facing store actions', () => {
    const scenario = selectedCombatScenario(useAppStore.getState().combat)
    useAppStore.getState().setScenarioProgram(scenario.id, {
      ...scenario.program,
      sequence: structuredClone(advancedItems),
    })
    consumePersist()

    const migrations = useAppStore.getState().migrateAdvancedRotations()
    expect(migrations).toHaveLength(1)
    expect(useAppStore.getState().library.rotations).toHaveLength(1)
    expect(consumePersist()).toEqual(['combat.workspace', 'library.rotations'])

    const entryId = migrations[0].savedRotation.id
    expect(listPendingAdvancedRotationMigrations(useAppStore.getState().library)).toHaveLength(1)
    useAppStore.getState().acknowledgeAdvancedRotationMigrations([entryId])
    expect(consumePersist()).toEqual(['library.rotations'])
    expect(listPendingAdvancedRotationMigrations(useAppStore.getState().library)).toEqual([])

    const acknowledged = acknowledgeAdvancedRotationMigrations(
      useAppStore.getState().library,
      new Set([entryId]),
    )
    expect(acknowledged).toBe(useAppStore.getState().library)
  })
})
