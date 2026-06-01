/*
  Author: Runor Ewhro
  Description: Defines combat graph entities used to represent active
               participants, slot-local state, and stat snapshots in combat.
*/

import type { FinalStats, ResBaseStats } from './stats'
import type { SlotLocalState, SlotRatingState } from './profile'
import type { SlotId } from './session'
import type { ResRuntime } from './runtime'

export interface CombatPartSlot {
  slotId: SlotId
  resonatorId: string
  local: SlotLocalState
  routing: SlotRatingState
}

export interface CombatPart {
  slotId: SlotId
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
}
