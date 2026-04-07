/*
  Author: Runor Ewhro
  Description: Defines optimizer payloads, execution shapes, result
               records, and packed context structures shared across
               CPU/GPU optimizer flows.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { EchoDefinition } from '@/domain/entities/catalog'
import type { GameDataRegistry } from '@/domain/gameData/contracts'
import type { RotationNode } from '@/domain/gameData/contracts'
import type { OptimizerSettings } from '@/domain/entities/optimizer'
import type { ResonatorDetails } from '@/domain/entities/resonator'
import type { EchoInstance, ResonatorRuntimeState, ResonatorSeed } from '@/domain/entities/runtime'
import type { SonataSetConditionals } from '@/domain/entities/sonataSetConditionals'
import type { SkillDefinition } from '@/domain/entities/stats'
import type { GeneratedWeapon } from '@/domain/entities/weapon'
import type { SetDef } from '@/data/gameData/echoSets/effects'

// lifecycle states for an optimizer run
export type OptimizerStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

// backend chosen to execute the optimizer
export type OptimizerBackend = 'cpu' | 'gpu'

// progress snapshot exposed while optimization is running
export interface OptimizerProgress {
  progress: number
  elapsedMs: number
  remainingMs: number
  processed: number
  speed: number
}

// compact stat summary attached to one optimizer result entry
export interface OptimizerResultStats {
  atk: number
  hp: number
  def: number
  er: number
  cr: number
  cd: number
  bonus: number
  amp: number
}

// one resolved optimizer result, usually storing selected echo ids plus damage
export interface OptimizerResultEntry {
  uids: string[]
  damage: number
  stats: OptimizerResultStats | null
}

// bag-style result reference that stores indices instead of full echo payloads
export interface OptimizerBagResultRef {
  damage: number
  i0: number
  i1: number
  i2: number
  i3: number
  i4: number
}

// typed aliases used by the packed optimizer buffers
export type OptimizerCostsArray = Uint8Array
export type OptimizerSetsArray = Uint8Array
export type OptimizerKindsArray = Uint16Array

// shared payload fields used by both target-skill and rotation optimizer runs
export interface PreparedOptimizerSharedPayload {
  resultsLimit: number
  lowMemoryMode: boolean
  constraints: Float32Array
  costs: OptimizerCostsArray
  sets: OptimizerSetsArray
  kinds: OptimizerKindsArray
  comboN: number
  comboK: number
  comboTotalCombos: number
  comboIndexMap: Int32Array
  comboBinom: Uint32Array
  lockedMainRequested: boolean
  lockedMainCandidateIndices: Int32Array
  progressFactor: number
}

// input payload used to start building an optimizer execution context
export interface OptimizerStartPayload {
  resonatorId: string
  resonatorSeed?: ResonatorSeed
  staticData?: {
    gameDataRegistry: GameDataRegistry
    resonatorCatalogById: Record<string, ResonatorSeed>
    resonatorDetailsById: Record<string, ResonatorDetails>
    weaponsById: Record<string, GeneratedWeapon>
    echoCatalogById: Record<string, EchoDefinition>
    echoSetDefs: SetDef[]
  }
  runtime: ResonatorRuntimeState
  settings: OptimizerSettings
  inventoryEchoes: EchoInstance[]
  enemyProfile: EnemyProfile
  selectedTargetsByOwnerKey?: Record<string, string | null>
  setConditionals?: SonataSetConditionals
  rotationItems?: RotationNode[] | null
}

// fully compiled scalar context for a single target skill evaluation
// this is the dense numeric form used to avoid repeated high-level reads
// during the optimizer inner loop.
export interface CompiledTargetSkillContext {
  archetype: number
  characterId: number
  sequence: number
  level: number
  enemyLevel: number
  enemyBaseRes: number
  enemyClass: number
  baseAtk: number
  baseHp: number
  baseDef: number
  staticFinalAtk: number
  staticFinalHp: number
  staticFinalDef: number
  staticFinalER: number
  staticCritRate: number
  staticCritDmg: number
  staticHealingBonus: number
  staticShieldBonus: number
  staticDmgBonus: number
  staticAmplify: number
  staticFlatDmg: number
  staticSpecial: number
  resMult: number
  defMult: number
  dmgReduction: number
  staticTuneBreakBoost: number
  staticResShred: number
  staticDefIgnore: number
  staticDefShred: number
  staticDmgVuln: number
  scalingAtk: number
  scalingHp: number
  scalingDef: number
  scalingER: number
  hitScale: number
  hitCount: number
  multiplier: number
  flat: number
  fixedDmg: number
  skillHealingBonus: number
  skillShieldBonus: number
  tuneRuptureScale: number
  tuneRuptureCritRate: number
  tuneRuptureCritDmg: number
  negativeEffectMultiplier: number
  negativeEffectCritRate: number
  negativeEffectCritDmg: number
  combatSpectroFrazzle: number
  combatAeroErosion: number
  combatFusionBurst: number
  combatGlacioChafe: number
  combatElectroFlare: number
  combatElectroRage: number
}

// prepared target-skill optimizer run before final packed execution handoff
export interface PreparedTargetSkillRun extends PreparedOptimizerSharedPayload {
  mode: 'targetSkill'
  runtime: ResonatorRuntimeState
  skill: SkillDefinition
  compiled: CompiledTargetSkillContext
  setRuntimeMask: number
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
}

// final packed target-skill payload sent into the execution layer
export interface PackedTargetSkillExecutionPayload extends PreparedOptimizerSharedPayload {
  mode: 'targetSkill'
  context: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
}

// prepared rotation optimizer run containing multiple packed contexts
// and one display context used for presenting representative stats/results.
export interface PreparedRotationRun extends PreparedOptimizerSharedPayload {
  mode: 'rotation'
  contextStride: number
  contextCount: number
  contexts: Float32Array
  contextWeights: Float32Array
  displayContext: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
}

// final packed rotation payload sent into the execution layer
export interface PackedRotationExecutionPayload extends PreparedOptimizerSharedPayload {
  mode: 'rotation'
  contextStride: number
  contextCount: number
  contexts: Float32Array
  contextWeights: Float32Array
  displayContext: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
}

// union of all prepared optimizer payload shapes
export type PreparedOptimizerPayload =
    | PreparedTargetSkillRun
    | PreparedRotationRun

// union of all packed execution payload shapes
export type PackedOptimizerExecutionPayload =
    | PackedTargetSkillExecutionPayload
    | PackedRotationExecutionPayload
