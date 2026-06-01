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
  TeamMemRt,
  TeamSlots,
  TraceNodeBuffs,
  WeaponState,
} from './runtime'
import type { ManualBuffs } from './manualBuffs'
import type { SntSetConds } from './sonataSetConditionals'

export interface ResProfPrgr {
  level: number
  sequence: number
  skillLevels: SkillLevels
  traceNodes: TraceNodeBuffs
}

export interface ResProfMk {
  weapon: WeaponState
  echoes: Array<EchoInstance | null>
}

export interface ResProf {
  resonatorId: ResonatorId
  runtime: ResPrssRtStt
}

export interface SlotLocalState {
  controls: Record<string, boolean | number | string>
  manualBuffs: ManualBuffs
  combat: CombatState
  setConditionals: SntSetConds
}

export interface SlotRatingState {
  selectedTargetsByOwnerKey: Record<string, ResonatorId | null>
}

export interface ResProfRtStt {
  local: SlotLocalState
  routing: SlotRatingState
  team: TeamSlots
  rotation: RotationState
  teamRuntimes: [TeamMemRt | null, TeamMemRt | null]
}

export interface ResPrssRtStt extends ResProfRtStt {
  progression: ResProfPrgr
  build: ResProfMk
}
