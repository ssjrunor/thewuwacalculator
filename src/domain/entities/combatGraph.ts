/*
  Author: Runor Ewhro
  Description: Defines combat graph entities used to represent active
               participants, slot-local state, and stat snapshots in combat.
*/

import type { FinalStats, ResBaseStats } from './stats'
import type { SlotLocalState, SlotRatingState } from './profile'
import type { ResRuntime } from './runtime'
import type { TeamMemberId } from './combatScenario'
import type { EnvironmentTargetModifiers } from './combatScenario'
import type { ManualBuffs } from './manualBuffs'

/** Fixed-width execution coordinate materialized from ordered scenario members. */
export type SlotId = 'active' | 'team1' | 'team2'

export interface CombatPartSlot {
  slotId: SlotId
  memberId: TeamMemberId
  resonatorId: string
  local: SlotLocalState
  routing: SlotRatingState
}

export interface CombatPart {
  slotId: SlotId
  memberId: TeamMemberId
  resonatorId: string
  slot: CombatPartSlot
  runtime: ResRuntime
  baseStats: ResBaseStats
  snapshots: {
    preStats?: FinalStats
    postStats?: FinalStats
  }
}

export interface CombatGraph {
  activeSlotId: SlotId
  participants: Record<SlotId, CombatPart>
  environmentBuffsByMemberId?: Readonly<Record<TeamMemberId, ManualBuffs>>
  environmentTargetModifiers?: EnvironmentTargetModifiers
  effectScalesByRuntimePath?: Record<string, Record<string, number>>
}
