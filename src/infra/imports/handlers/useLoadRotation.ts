/*
  Author: Runor Ewhro
  Description: Loads a saved rotation snapshot into its context resonator's
               working scenario and replaces the standing editor document.
*/

import { useCallback } from 'react'
import {
  savedRotationResonatorId,
  type SavedRotation,
} from '@/domain/entities/inventoryStorage.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { clearRotationEditorSession } from '@/modules/simulation/features/rotation/program-editor/state/editorSessionStore.ts'

export function useLoadRotation() {
  const applyScenarioSnapshot = useAppStore((state) => state.applyScenarioSnapshot)

  return useCallback((entry: SavedRotation) => {
    applyScenarioSnapshot(entry.scenario)
    clearRotationEditorSession(savedRotationResonatorId(entry))
  }, [applyScenarioSnapshot])
}
