/*
  Author: Runor Ewhro
  Description: defines shared suggestion engine input, result, and worker
               message types for durable main-stat, set-plan, and weapon flows.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { WeaponPlanSet } from '@/domain/entities/suggestions'
import type { ResRuntime, ResSeed, EchoInstance } from '@/domain/entities/runtime'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals'
import type { FinalStats, UnifiedBuffPool, ResBaseStats, SkillDef } from '@/domain/entities/stats'
import type { EffectContext } from '@/domain/gameData/contracts'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat-suggestion/utils'
import type { OptTargetSkill } from '@/engine/optimizer/target/selectedSkill'
import type { OptStatWeight } from '@/engine/optimizer/search/filtering.ts'
import type { GameDataMode } from '@/domain/entities/gameDataMode'
import type { CombatScenarioId, TeamMemberId } from '@/domain/entities/combatScenario'

interface SuggsWrkrBase {
  id: number
  gameDataMode?: GameDataMode
}

export interface SuggestInput {
  scenarioId: CombatScenarioId
  memberId: TeamMemberId
  runtime: ResRuntime
  seed: ResSeed
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
  selectedTargets: Record<string, string | null>
  setConds?: SntSetConds
  setStateMode?: 'max' | 'resolved'
  tgtFeatId: string | null
  rotationMode: boolean
  includeEchoAttacks?: boolean
}

export interface DrctSuggCtx {
  mode: 'target'
  runtime: ResRuntime
  effectContext: EffectContext
  selectedSkill: OptTargetSkill
  sourceBaseStats: ResBaseStats
  sourceFinals: FinalStats
  pool: UnifiedBuffPool
  skll: SkillDef
  enemy: EnemyProfile
  setRtMask: number
  pckdCtx: Float32Array
  setConstLut: Float32Array
}

export interface RotSuggCtx {
  mode: 'rotation'
  runtime: ResRuntime
  effectContext: EffectContext
  selectedSkill: OptTargetSkill
  sourceBaseStats: ResBaseStats
  sourceFinals: FinalStats
  pool: UnifiedBuffPool
  sklls: SkillDef[]
  resIds: string[]
  enemy: EnemyProfile
  setRtMask: number
  contexts: Float32Array
  contextStride: number
  contextWeight: Float32Array
  contextCount: number
  /** Representative context retained for materialized result statistics. */
  displayContext: Float32Array | null
  setConstLut: Float32Array
}

export type SuggestContext =
    | DrctSuggCtx
    | RotSuggCtx

export interface MainStatPrep {
  scoringInput: SuggestInput
  scenarioId: CombatScenarioId
  memberId: TeamMemberId
  context: SuggestContext
  rotationMode: boolean
  qppdChs: Array<EchoInstance | null>
  charId: string
  statWeight: OptStatWeight
  topK?: number
}

export interface PrepSetPlanS {
  scoringInput: SuggestInput
  scenarioId: CombatScenarioId
  memberId: TeamMemberId
  context: SuggestContext
  rotationMode: boolean
  qppdChs: Array<EchoInstance | null>
  topK?: number
}

export interface PrepWeaponPlan {
  scenarioId: CombatScenarioId
  memberId: TeamMemberId
  runtime: ResRuntime
  context: SuggestContext
  qppdChs: Array<EchoInstance | null>
  seed: ResSeed
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
  selectedTargets: Record<string, string | null>
  includeEchoAttacks?: boolean
  weaponType: number
  level: number
  rank: number
  settings: WeaponPlanSet
  topK?: number
}

export interface MainStatSugg {
  damage: number
  recipes: MainStatRecipe[]
  totalCost?: number
  isRotation?: boolean
}

export interface SetPlanEntry {
  setId: number
  pieces: number
}

/** Set ids sharing one entry are effect-equivalent at this piece count. */
export interface SetPlanDisplayEntry {
  setIds: number[]
  pieces: number
}

export interface SetPlanSuggest {
  avgDamage: number
  setPlan: SetPlanEntry[]
  displayPlan?: SetPlanDisplayEntry[]
  echoes: Array<EchoInstance | null>
}

export interface WeaponEntry {
  damage: number
  weaponId: string
  name: string
  rarity: number
  icon: string
  level: number
  rank: number
  baseAtk: number
  statKey: string
  statValue: number
  mode: 'default' | 'max'
  controls: Record<string, boolean | number | string>
  pssvName: string
  pssvDesc: string
  params: string[]
}

export interface MainStatSuwo extends SuggestInput {
  topK?: number
}

export interface SetPlanSuggs extends SuggestInput {
  topK?: number
}

export interface SetPlanSugoi {
  baseAvg: number
  results: SetPlanSuggest[]
  isRotation: boolean
}

export interface SuggsWrkrMai extends SuggsWrkrBase {
  type: 'mainStats'
  payload: MainStatPrep
}

export interface SuggsWrkrSet extends SuggsWrkrBase {
  type: 'setPlans'
  payload: PrepSetPlanS
}

export interface SuggsWrkrWpn extends SuggsWrkrBase {
  type: 'weapons'
  payload: PrepWeaponPlan
}

export interface SuggsWrkrDon {
  id: number
  ok: true
  result: MainStatSugg[] | SetPlanSuggest[] | WeaponEntry[]
}

export interface SuggsWrkrRrr {
  id: number
  ok: false
  error: string
}

export type SuggsWrkrInM =
    | SuggsWrkrMai
    | SuggsWrkrSet
    | SuggsWrkrWpn

export type SuggsWrkrOut =
    | SuggsWrkrDon
    | SuggsWrkrRrr
