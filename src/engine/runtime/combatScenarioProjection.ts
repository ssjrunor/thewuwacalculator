/*
  Author: Runor Ewhro
  Description: Converts the retired active-profile persistence contract into
               a canonical combat scenario for imports and schema migration.
*/

import type { LegacyProfileMap } from '@/domain/entities/appState'
import type { CombatScenario } from '@/domain/entities/combatScenario'
import type { CombatSession } from '@/domain/entities/session'
import { makeScenarioFromProfiles } from '@/engine/runtime/defaults'

export interface LegacyCombatScenarioSource {
  profiles: LegacyProfileMap
  runtimeRevision: number
  session: CombatSession
}

/** Migration-only projection; live code reads the persisted scenario directly. */
export function projectCombatScenario(
  source: LegacyCombatScenarioSource,
): CombatScenario {
  return makeScenarioFromProfiles(
    source.profiles,
    source.session,
    source.runtimeRevision,
  )
}
