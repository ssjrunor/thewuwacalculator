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

export type OptInventoryMode = 'include' | 'exclude'

// Sparse optimizer inventory rule:
// - include mode means only echoUids may be used.
// - exclude mode means every inventory echo except echoUids may be used.
export interface OptInventorySelection {
  mode: OptInventoryMode
  echoUids: string[]
}

export function makeOptInventorySelection(): OptInventorySelection {
  return {
    mode: 'exclude',
    echoUids: [],
  }
}

export function cloneOptInventorySelection(
    selection?: Partial<OptInventorySelection> | null,
): OptInventorySelection {
  // Normalize persisted/imported profiles at the boundary so downstream
  // optimizer code never sees duplicate, empty, or unknown mode data.
  const mode = selection?.mode === 'include' ? 'include' : 'exclude'
  const echoUids = Array.isArray(selection?.echoUids)
    ? [...new Set(selection.echoUids.filter((uid) => typeof uid === 'string' && uid.length > 0))]
    : []

  return {
    mode,
    echoUids,
  }
}

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
  optimizerInventory: OptInventorySelection
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
