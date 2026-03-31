/*
  Author: Runor Ewhro
  Description: Defines combat graph entities used to represent active
               participants, slot-local state, and stat snapshots in combat.
*/

import type { FinalStats, ResonatorBaseStats } from './stats'
import type { SlotLocalState, SlotRoutingState } from './profile'
import type { SlotId } from './session'
import type { ResonatorRuntimeState } from './runtime'

export interface CombatParticipantSlotState {
  slotId: SlotId
  resonatorId: string
  local: SlotLocalState
  routing: SlotRoutingState
}

export interface CombatParticipant {
  slotId: SlotId
  resonatorId: string
  slot: CombatParticipantSlotState
  runtime: ResonatorRuntimeState
  baseStats: ResonatorBaseStats
  snapshots: {
    preStats?: FinalStats
    postStats?: FinalStats
  }
}

export interface CombatGraph {
  activeSlotId: SlotId
  participants: Record<SlotId, CombatParticipant>
}
