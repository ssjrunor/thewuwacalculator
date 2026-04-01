/*
  Author: Runor Ewhro
  Description: Selects the persisted subset of the app store for storage
               and serialization.
*/

import type { PersistedAppState } from '@/domain/entities/appState'
import type { AppStore } from '@/domain/state/store'

// select the persisted subset of app state
export function selectPersistedState(state: AppStore): PersistedAppState {
  return {
    version: state.version,
    ui: state.ui,
    calculator: state.calculator,
  }
}
