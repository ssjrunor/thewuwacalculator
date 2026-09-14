/*
  Author: Runor Ewhro
  Description: shared pipeline type definitions for combat-context construction
               and simulation results, including grouped rotation totals and
               per-aggregation summaries.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatGraph, SlotId } from '@/domain/entities/combatGraph'
import type { ResRuntime } from '@/domain/entities/runtime'
import type {
  SkillAggType,
  ResBaseStats,
  FinalStats,
  UnifiedBuffPool,
} from '@/domain/entities/stats'
import type { FeatureResult } from '@/domain/gameData/contracts'
import type { NumericTeamState } from '@/engine/effects/numericTeam.ts'

// minimal input needed to resolve a combat context from a graph
export interface GrphCmbtCtxN {
  // fully built combat graph containing all participants
  graph: CombatGraph

  // slot whose runtime/stats should be resolved into the combat context
  targetSlotId: SlotId

  // enemy profile used for damage/stat calculations
  enemy: EnemyProfile
}

// resolved combat state for one target slot inside a graph
export interface CombatContext {
  // runtime state of the target participant
  runtime: ResRuntime

  // immutable base stats before buff application
  baseStats: ResBaseStats

  // active enemy profile for this context
  enemy: EnemyProfile

  // final unified buff pool after all relevant effects have been applied
  buffs: UnifiedBuffPool

  // final computed stats derived from base stats + buffs
  finalStats: FinalStats

  // source graph this context was built from
  graph: CombatGraph

  // slot this context represents inside the graph
  targetSlotId: SlotId

  /** Packed Simulation kernel backing this compatibility projection. */
  numericTeam: NumericTeamState
  numericLane: number
}

// compact total bundle used by rotation summaries
export interface DamageTotals {
  normal: number
  crit: number
  avg: number
}

export interface RotationSimulationResult {
  // all feature rows belonging to this rotation grouping
  entries: FeatureResult[]

  // top-level damage total for the group
  total: DamageTotals

  /** Kept separate so healing/shield output can be displayed, never scored as damage. */
  totalsByGroup: Record<SkillAggType, DamageTotals>
}

// top-level simulation result returned by the pipeline
export interface SimResult {
  // final stats for the active combat context
  finalStats: FinalStats

  // every simulated feature row
  allFeatures: FeatureResult[]

  // independently executed compact sequence and advanced program
  rotation: {
    sequence: RotationSimulationResult
    program: RotationSimulationResult
  }

  // flattened non-subhit skill rows exposed for general UI use
  allSkills: FeatureResult[]

  // flattened rotation rows retained for general result consumers
  perSkill: FeatureResult[]

  // rotation damage total
  total: DamageTotals

  totalsByGroup: Record<SkillAggType, DamageTotals>
}
