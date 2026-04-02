/*
  Author: Runor Ewhro
  Description: Defines shared suggestion engine input, result, and worker
               message types for main stat, set plan, and random echo flows.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { RandomGeneratorSettings } from '@/domain/entities/suggestions'
import type { ResonatorRuntimeState, ResonatorSeed, EchoInstance } from '@/domain/entities/runtime'
import type { SonataSetConditionals } from '@/domain/entities/sonataSetConditionals'
import type { FinalStats, ResonatorBaseStats } from '@/domain/entities/stats'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat-suggestion/utils'
import type { OptimizerTargetSkill } from '@/engine/optimizer/target/selectedSkill'
import type { OptimizerStatWeightMap } from '@/engine/optimizer/search/filtering.ts'

// common evaluation input shared by all suggestion pipelines
export interface SuggestionsEvaluationInput {
  runtime: ResonatorRuntimeState
  seed: ResonatorSeed
  enemy: EnemyProfile
  runtimesById: Record<string, ResonatorRuntimeState>
  selectedTargetsByOwnerKey: Record<string, string | null>
  setConditionals?: SonataSetConditionals
  targetFeatureId: string | null
  rotationMode: boolean
}

export interface DirectSuggestionContext {
  mode: 'target'
  runtime: ResonatorRuntimeState
  selectedSkill: OptimizerTargetSkill
  sourceBaseStats: ResonatorBaseStats
  sourceFinalStats: FinalStats
  packedContext: Float32Array
  setConstLut: Float32Array
}

export interface RotationSuggestionContext {
  mode: 'rotation'
  runtime: ResonatorRuntimeState
  selectedSkill: OptimizerTargetSkill
  sourceBaseStats: ResonatorBaseStats
  sourceFinalStats: FinalStats
  contexts: Float32Array
  contextStride: number
  contextWeights: Float32Array
  contextCount: number
  setConstLut: Float32Array
}

export type SuggestionEvaluationContext =
    | DirectSuggestionContext
    | RotationSuggestionContext

export interface PreparedMainStatSuggestionsInput {
  context: SuggestionEvaluationContext
  rotationMode: boolean
  equippedEchoes: Array<EchoInstance | null>
  charId: string
  statWeight: OptimizerStatWeightMap
  topK?: number
}

export interface PreparedSetPlanSuggestionsInput {
  context: SuggestionEvaluationContext
  rotationMode: boolean
  equippedEchoes: Array<EchoInstance | null>
  topK?: number
}

export interface PreparedRandomSuggestionsInput {
  context: SuggestionEvaluationContext
  equippedEchoes: Array<EchoInstance | null>
  runtimeId: string
  rawWeightMap: OptimizerStatWeightMap
  statWeight: OptimizerStatWeightMap
  settings: RandomGeneratorSettings
  resultsLimit?: number
  candidateCount?: number
}

// one main-stat suggestion result entry
export interface MainStatSuggestionEntry {
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
export interface SetPlanSuggestionEntry {
  avgDamage: number
  setPlan: SetPlanEntry[]
  echoes: Array<EchoInstance | null>
}

// one random suggestion result entry
export interface RandomSuggestionEntry {
  damage: number
  echoes: Array<EchoInstance | null>
}

// input for random echo generation suggestions
export interface RandomSuggestionsInput extends SuggestionsEvaluationInput {
  settings: RandomGeneratorSettings
  resultsLimit?: number
  candidateCount?: number
}

// input for main-stat suggestions
export interface MainStatSuggestionsInput extends SuggestionsEvaluationInput {
  topK?: number
}

// input for set-plan suggestions
export interface SetPlanSuggestionsInput extends SuggestionsEvaluationInput {
  topK?: number
}

// full set-plan suggestion result container
export interface SetPlanSuggestionsResult {
  baseAvg: number
  results: SetPlanSuggestionEntry[]
  isRotation: boolean
}

// worker start message for main-stat suggestions
export interface SuggestionsWorkerMainStatStartMessage {
  id: number
  type: 'mainStats'
  payload: PreparedMainStatSuggestionsInput
}

// worker start message for set-plan suggestions
export interface SuggestionsWorkerSetPlanStartMessage {
  id: number
  type: 'setPlans'
  payload: PreparedSetPlanSuggestionsInput
}

// worker start message for random echo suggestions
export interface SuggestionsWorkerRandomStartMessage {
  id: number
  type: 'random'
  payload: PreparedRandomSuggestionsInput
}

// successful worker response message
export interface SuggestionsWorkerDoneMessage {
  id: number
  ok: true
  result: MainStatSuggestionEntry[] | SetPlanSuggestionEntry[] | RandomSuggestionEntry[]
}

// failed worker response message
export interface SuggestionsWorkerErrorMessage {
  id: number
  ok: false
  error: string
}

// all valid inbound worker message shapes
export type SuggestionsWorkerInMessage =
    | SuggestionsWorkerMainStatStartMessage
    | SuggestionsWorkerSetPlanStartMessage
    | SuggestionsWorkerRandomStartMessage

// all valid outbound worker message shapes
export type SuggestionsWorkerOutMessage =
    | SuggestionsWorkerDoneMessage
    | SuggestionsWorkerErrorMessage
