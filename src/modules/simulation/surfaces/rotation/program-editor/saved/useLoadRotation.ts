/*
  Author: Runor Ewhro
  description: loads a saved rotation snapshot into its context resonator's
               working scenario and replaces the standing editor document.
*/

import { useCallback } from 'react'
import { cloneRotationNodes, type SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import { contextScenarioMember, primaryScenarioMember, type CombatScenario } from '@/domain/entities/combatScenario.ts'
import { scenarioIdForContextResonator, selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { useAppStore } from '@/application/state'
import { convertScenarioRoverGender } from '@/application/state/roverGenderConversion'
import { collectResonatorIds } from '@/application/persistence/resonatorScope.ts'
import { ensureResonatorData, holdResonatorData } from '@/data/gameData'
import { clearRotationEditorSession } from '@/modules/simulation/surfaces/rotation/program-editor/state/editorSessionStore.ts'

export type RotationLoadMode = 'build' | 'rotation'

// load or replace rotation steps under a data lease, then invalidate the selected primary member's editor session.
export async function loadRotationScenario(scenario: CombatScenario, mode: RotationLoadMode): Promise<void> {
  scenario = convertScenarioRoverGender(scenario, useAppStore.getState().ui.preferences.roverGender)
  const contextId = contextScenarioMember(scenario).resonatorId
  const existingId = scenarioIdForContextResonator(useAppStore.getState().combat, contextId)
  const existing = existingId ? useAppStore.getState().combat.scenariosById[existingId] : null
  const ids = mode === 'build'
    ? collectResonatorIds(scenario)
    : [...new Set([contextId, ...collectResonatorIds(existing)])]
  const release = holdResonatorData(ids)
  try {
    await ensureResonatorData(ids)
    if (mode === 'build') {
      useAppStore.getState().applyScenarioSnapshot(scenario)
    } else {
      useAppStore.getState().swRes(contextId)
      const scenarioId = scenarioIdForContextResonator(useAppStore.getState().combat, contextId)
      if (!scenarioId) throw new Error('Could not open the rotation context.')
      useAppStore.getState().commitScenarioConfig(scenarioId, (current) => ({
        ...current,
        program: {
          ...current.program,
          program: cloneRotationNodes(scenario.program.program),
          lastRanAt: null,
        },
      }), 'Loaded Rotation Steps')
    }
    // the editor session is keyed by member zero. a reordered scenario can have
    // a different context member, so clear the selected scenario's primary session.
    const loaded = selectedCombatScenario(useAppStore.getState().combat)
    clearRotationEditorSession(primaryScenarioMember(loaded).resonatorId)
  } finally {
    release()
  }
}

export function useLoadRotation() {
  return useCallback((entry: SavedRotation, mode: RotationLoadMode) => (
    loadRotationScenario(entry.scenario, mode)
  ), [])
}
