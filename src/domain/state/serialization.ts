/*
  Author: Runor Ewhro
  Description: Selects the persisted subset of the app store for storage
               and serialization.
*/

import type { PersistedAppState } from '@/domain/entities/appState'
import type { AppStore } from '@/domain/state/store'

export type PersistedSliceKey = 'session' | 'profiles' | 'inventory'

// select the persisted subset of app state
export function selectPersistedState(state: AppStore): PersistedAppState {
  return {
    version: state.version,
    ui: state.ui,
    calculator: state.calculator,
  }
}

export function selectPersistedSessionSlice(state: AppStore) {
  return {
    version: state.version,
    ui: state.ui,
    calculator: {
      session: state.calculator.session,
    },
  }
}

export function selectPersistedProfilesSlice(state: AppStore) {
  return {
    version: state.version,
    calculator: {
      runtimeRevision: state.calculator.runtimeRevision,
      profiles: state.calculator.profiles,
      optimizerContext: state.calculator.optimizerContext,
      suggestionsByResonatorId: state.calculator.suggestionsByResonatorId,
    },
  }
}

export function selectPersistedInventorySlice(state: AppStore) {
  return {
    version: state.version,
    calculator: {
      inventoryEchoes: state.calculator.inventoryEchoes,
      inventoryBuilds: state.calculator.inventoryBuilds,
      inventoryRotations: state.calculator.inventoryRotations,
    },
  }
}
