/*
  Author: Runor Ewhro
  Description: Defines the legacy session projection retained for import and
               UI compatibility while CombatScenario owns live combat state.
*/

import type { EnemyProfile } from './appState'
import type { ResonatorId } from './runtime'

export interface CombatSession {
  /** @deprecated Mirrors scenario member zero for legacy imports. */
  activeResonatorId: ResonatorId | null
  /** @deprecated Mirrors CombatScenario.target for legacy imports. */
  enemyProfile: EnemyProfile
}
