/*
  Author: Runor Ewhro
  Description: shared pipeline type definitions for combat-context construction
               and simulation results, including grouped rotation totals and
               per-aggregation summaries.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type {
  SkillAggregationType,
  ResonatorBaseStats,
  FinalStats,
  UnifiedBuffPool,
} from '@/domain/entities/stats'
import type { FeatureResult } from '@/domain/gameData/contracts'
import type { SlotId } from '@/domain/entities/session'

// minimal input needed to resolve a combat context from a graph
export interface GraphCombatContextInput {
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
  runtime: ResonatorRuntimeState

  // immutable base stats before buff application
  baseStats: ResonatorBaseStats

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
}

// compact total bundle used across personal/team rotation summaries
export interface DamageTotals {
  normal: number
  crit: number
  avg: number
}

// one grouped simulation view, such as personal or team rotation output
export interface RotationSimulationGroup {
  // all feature rows belonging to this rotation grouping
  entries: FeatureResult[]

  // top-level damage total for the group
  total: DamageTotals

  // totals split by aggregation type such as damage/healing/shield
  totalsByAggregation: Record<SkillAggregationType, DamageTotals>
}

// top-level simulation result returned by the pipeline
export interface SimulationResult {
  // final stats for the active combat context
  finalStats: FinalStats

  // every simulated feature row
  allFeatures: FeatureResult[]

  // grouped personal/team rotation summaries
  rotations: {
    personal: RotationSimulationGroup
    team: RotationSimulationGroup
  }

  // flattened non-subhit skill rows exposed for general UI use
  allSkills: FeatureResult[]

  // default per-skill view, typically mapped to personal rotation entries
  perSkill: FeatureResult[]

  // default total, typically mapped to the personal rotation total
  total: DamageTotals

  // default aggregation buckets, typically mapped to the personal view
  totalsByAggregation: Record<SkillAggregationType, DamageTotals>
}