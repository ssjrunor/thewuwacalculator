/*
  Author: Runor Ewhro
  Description: Defines persisted resonator profile types, including
               progression, build, local slot state, routing, and team data.
*/

import type {
  CombatState,
  EchoInstance,
  ResonatorId,
  SkillLevels,
  RotationState,
  TeamMemberRuntime,
  TeamSlots,
  TraceNodeBuffs,
  WeaponBuildState,
} from './runtime'
import type { ManualBuffs } from './manualBuffs'

export interface ResonatorProfileProgression {
  level: number
  sequence: number
  skillLevels: SkillLevels
  traceNodes: TraceNodeBuffs
}

export interface ResonatorProfileBuild {
  weapon: WeaponBuildState
  echoes: Array<EchoInstance | null>
}

export interface ResonatorProfile {
  resonatorId: ResonatorId
  runtime: ResonatorPersistedRuntimeState
}

export interface SlotLocalState {
  controls: Record<string, boolean | number | string>
  manualBuffs: ManualBuffs
  combat: CombatState
}

export interface SlotRoutingState {
  selectedTargetsByOwnerKey: Record<string, ResonatorId | null>
}

export interface ResonatorProfileRuntimeState {
  local: SlotLocalState
  routing: SlotRoutingState
  team: TeamSlots
  rotation: RotationState
  teamRuntimes: [TeamMemberRuntime | null, TeamMemberRuntime | null]
}

export interface ResonatorPersistedRuntimeState extends ResonatorProfileRuntimeState {
  progression: ResonatorProfileProgression
  build: ResonatorProfileBuild
}