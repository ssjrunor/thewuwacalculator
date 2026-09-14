/*
  Author: Runor Ewhro
  Description: Selects the persisted subset of the app store for storage
               and serialization.
*/

import type { PersistedState } from '@/domain/entities/appState'
import type { AppStore } from '@/domain/state/store'

// select the persisted subset of app state
export function selectPersisted(state: AppStore): PersistedState {
  const combat = {
    selectedScenarioId: state.combat.selectedScenarioId,
    order: state.combat.order,
    scenariosById: state.combat.scenariosById,
  }
  const simulation = {
    optimizerSettingsResonatorId: state.simulation.optimizerSettingsResonatorId,
    optimizerSettings: state.simulation.optimizerSettings,
    weaponSuggests: state.simulation.weaponSuggests,
    suggestionsByResonatorId: state.simulation.suggestionsByResonatorId,
  }
  return {
    version: state.version,
    ui: state.ui,
    combat,
    library: state.library,
    simulation,
  }
}
