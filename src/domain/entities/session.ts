/*
  Author: Runor Ewhro
  Description: Defines combat session state shared across the calculator,
               including the active resonator and current enemy profile.
*/

import type { EnemyProfile } from './appState'
import type { ResonatorId } from './runtime'

export type SlotId = 'active' | 'team1' | 'team2'

export interface CombatSession {
  activeResonatorId: ResonatorId | null
  enemyProfile: EnemyProfile
}