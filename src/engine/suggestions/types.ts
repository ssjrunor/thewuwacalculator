/*
  Author: Runor Ewhro
  description: defines shared suggestion engine input, result, and worker
               message types for durable main-stat, set-plan, and weapon flows.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { WeaponPlanSet } from '@/domain/entities/suggestions'
import type { ResRuntime, ResSeed, EchoInstance } from '@/domain/entities/runtime'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals'
import type { FinalStats, UnifiedBuffPool, ResBaseStats, SkillDef } from '@/domain/entities/stats'
import type { EffectContext } from '@/domain/gameData/contracts'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat/utils'
import type { OptTargetSkill } from '@/engine/search/context/selectedSkill'
import type { OptStatWeight } from '@/engine/search/score/statWeights.ts'
import type { SetPlanEntry } from '@/engine/search/combos/setPlans.ts'
import type { GameDataMode } from '@/domain/entities/gameDataMode'
import type { CombatScenarioId, TeamMemberId } from '@/domain/entities/combatScenario'
import type { SimResult } from '@/engine/pipeline/types'

interface SuggsWrkrBase {
  id: number
  gameDataMode?: GameDataMode
}

export type SuggestionSearchMode = 'mainStats' | 'setPlans' | 'weapons'

export interface SuggestionWorkerDiagnostics {
  phase: 'gameData' | 'modules' | 'preparation' | 'search' | 'packaging' | 'complete'
  coldModules: boolean
  scoring?: ReturnType<typeof import('./shared').getSuggestionScoringDiagnostics>
  parallel?: import('./parallel').ParallelSuggestionDiagnostics | null
  error?: { name: string; message: string; stack?: string }
  timings: {
    gameDataMs: number
    modulesMs: number
    preparationMs: number
    searchMs: number
    packagingMs: number
    totalMs: number
  }
  prepared?: {
    scoringMode: SuggestContext['mode']
    targetContexts: number
    fixedTeamDamage: number
    teammateDamageEvents: number
    allowedRotationFeatures: number
    sourceStatsAffectTeam: boolean
    statSensitiveSets: number[]
    statSensitiveEchoIds: string[]
  }
}

export interface SuggestionRequestDiagnostics {
  requestId: number | null
  workerGeneration: number
  coldWorker: boolean
  dispatchMs: number
  roundTripMs: number
  /** startup, message copying/transfer, queuing, and main-thread scheduling. */
  outsideWorkerMs: number
  worker?: SuggestionWorkerDiagnostics
}

export interface SuggestInput {
  scenarioId: CombatScenarioId
  memberId: TeamMemberId
  runtime: ResRuntime
  seed: ResSeed
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
  selectedTargets: Record<string, string | null>
  combatSetup?: import('@/engine/pipeline/index.ts').RotationCombatSetup
  /** set when saved programs supply their own equipment activation and expiry writes. */
  preserveEchoStateChanges?: boolean
  setConds?: SntSetConds
  setStateMode?: 'max' | 'resolved'
  tgtFeatId: string | null
  rotationMode: boolean
  includeEchoAttacks?: boolean
}

/** the only simulation fields read while preparing suggestions contexts. */
export interface SuggestionSimulation {
  finalStats: SimResult['finalStats']
  allSkills: SimResult['allSkills']
  rotation: { sequence: Pick<SimResult['rotation']['sequence'], 'entries'> }
}

export interface CompactSuggestionJob {
  input: SuggestInput
  simulation: SuggestionSimulation
  weapon: WeaponPlanSet
  resonatorIds: string[]
  weaponIds: string[]
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
  preserveEchoStateChanges?: boolean
  candidatePlan?: import('@/engine/rotation/candidatePlan').RotationCandidatePlan
  fixedTeamDamage: number
  teamDamagePlan?: import('@/engine/rotation/damagePlan.ts').RotationTeamDamagePlan
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
  /** representative context retained for materialized result statistics. */
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
  combatSetup?: import('@/engine/pipeline/index.ts').RotationCombatSetup
  setConds?: SntSetConds
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

/** set ids sharing one entry are effect-equivalent at this piece count. */
export interface SetPlanDisplayEntry {
  setIds: number[]
  pieces: number
}

export interface SetPlanSuggest {
  avgDamage: number
  setPlan: SetPlanEntry[]
  displayPlan?: SetPlanDisplayEntry[]
  mainEchoId?: string
  mainEchoSetId?: number
  echoes: Array<EchoInstance | null>
}

export type CompactSetPlanSuggest = Omit<SetPlanSuggest, 'echoes'>

/** set rows and their baseline come from the same scoring run. */
export interface CompactSetPlanRun {
  baseDamage: number
  results: CompactSetPlanSuggest[]
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

export interface SuggsWrkrCompact extends SuggsWrkrBase {
  type: 'compact'
  mode: 'mainStats' | 'setPlans' | 'weapons'
  payload: CompactSuggestionJob
}

export interface SuggsWrkrDon {
  id: number
  ok: true
  result: MainStatSugg[] | SetPlanSuggest[] | SetPlanSugoi | CompactSetPlanSuggest[] | CompactSetPlanRun | WeaponEntry[]
  diagnostics?: SuggestionWorkerDiagnostics
}

export interface SuggsWrkrRrr {
  id: number
  ok: false
  error: string
  diagnostics?: SuggestionWorkerDiagnostics
}

export type SuggsWrkrInM =
    | SuggsWrkrMai
    | SuggsWrkrSet
    | SuggsWrkrWpn
    | SuggsWrkrCompact

export type SuggsWrkrOut =
    | SuggsWrkrDon
    | SuggsWrkrRrr
