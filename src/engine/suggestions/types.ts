/*
  Author: Runor Ewhro
  Description: Defines shared suggestion engine input, result, and worker
               message types for main stat, set plan, and random echo flows.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { RandGnrtSets, WeaponPlanSet } from '@/domain/entities/suggestions'
import type { ResRuntime, ResSeed, EchoInstance, WeaponState } from '@/domain/entities/runtime'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals'
import type { FinalStats, UnifiedBuffPool, ResBaseStats, SkillDef } from '@/domain/entities/stats'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat-suggestion/utils'
import type { OptTargetSkill } from '@/engine/optimizer/target/selectedSkill'
import type { OptStatWeight } from '@/engine/optimizer/search/filtering.ts'

// common evaluation input shared by all suggestion pipelines
export interface SuggestInput {
  runtime: ResRuntime
  seed: ResSeed
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
  selectedTargets: Record<string, string | null>
  setConds?: SntSetConds
  tgtFeatId: string | null
  rotationMode: boolean
}

export interface DrctSuggCtx {
  mode: 'target'
  runtime: ResRuntime
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
  setConstLut: Float32Array
}

export type SuggestContext =
    | DrctSuggCtx
    | RotSuggCtx

export interface MainStatPrep {
  context: SuggestContext
  rotationMode: boolean
  qppdChs: Array<EchoInstance | null>
  charId: string
  statWeight: OptStatWeight
  topK?: number
}

export interface PrepSetPlanS {
  context: SuggestContext
  rotationMode: boolean
  qppdChs: Array<EchoInstance | null>
  topK?: number
}

export interface RandomPrep {
  context: SuggestContext
  qppdChs: Array<EchoInstance | null>
  runtimeId: string
  rawWeightMap: OptStatWeight
  statWeight: OptStatWeight
  settings: RandGnrtSets
  resultsLimit?: number
  candCnt?: number
}

export interface PrepWeaponPlan {
  context: SuggestContext
  qppdChs: Array<EchoInstance | null>
  weaponType: number
  level: number
  rank: number
  curWpn: WeaponState
  settings: WeaponPlanSet
  topK?: number
}

// one main-stat suggestion result entry
export interface MainStatSugg {
  damage: number
  recipes: MainStatRecipe[]
  totalCost?: number
  isRotation?: boolean
}

// one set-plan piece entry describing set id and piece count
export interface SetPlanEntry {
  setId: number
  pieces: number
}

// one set-plan suggestion result entry
export interface SetPlanSuggest {
  avgDamage: number
  setPlan: SetPlanEntry[]
  echoes: Array<EchoInstance | null>
}

// one random suggestion result entry
export interface RandomEntry {
  damage: number
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

// input for random echo generation suggestions
export interface RandSuggsNpt extends SuggestInput {
  settings: RandGnrtSets
  resultsLimit?: number
  candCnt?: number
}

// input for main-stat suggestions
export interface MainStatSuwo extends SuggestInput {
  topK?: number
}

// input for set-plan suggestions
export interface SetPlanSuggs extends SuggestInput {
  topK?: number
}

// full set-plan suggestion result container
export interface SetPlanSugoi {
  baseAvg: number
  results: SetPlanSuggest[]
  isRotation: boolean
}

// worker start message for main-stat suggestions
export interface SuggsWrkrMai {
  id: number
  type: 'mainStats'
  payload: MainStatPrep
}

// worker start message for set-plan suggestions
export interface SuggsWrkrSet {
  id: number
  type: 'setPlans'
  payload: PrepSetPlanS
}

// worker start message for random echo suggestions
export interface SuggsWrkrRan {
  id: number
  type: 'random'
  payload: RandomPrep
}

export interface SuggsWrkrWpn {
  id: number
  type: 'weapons'
  payload: PrepWeaponPlan
}

// successful worker response message
export interface SuggsWrkrDon {
  id: number
  ok: true
  result: MainStatSugg[] | SetPlanSuggest[] | RandomEntry[] | WeaponEntry[]
}

// failed worker response message
export interface SuggsWrkrRrr {
  id: number
  ok: false
  error: string
}

// all valid inbound worker message shapes
export type SuggsWrkrInM =
    | SuggsWrkrMai
    | SuggsWrkrSet
    | SuggsWrkrRan
    | SuggsWrkrWpn

// all valid outbound worker message shapes
export type SuggsWrkrOut =
    | SuggsWrkrDon
    | SuggsWrkrRrr
