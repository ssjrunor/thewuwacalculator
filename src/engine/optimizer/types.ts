/*
  Author: Runor Ewhro
  Description: Defines optimizer payloads, execution shapes, result
               records, and packed context structures shared across
               CPU/GPU optimizer flows.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { EchoDef } from '@/domain/entities/catalog'
import type { GameDataReg } from '@/domain/gameData/contracts'
import type { RotationNode } from '@/domain/gameData/contracts'
import type { OptSets } from '@/domain/entities/optimizer'
import type { ResDtls } from '@/domain/entities/resonator'
import type { EchoInstance, ResRuntime, ResSeed } from '@/domain/entities/runtime'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals'
import type { FinalStats, ResBaseStats, SkillDef } from '@/domain/entities/stats'
import type { GenWpn } from '@/domain/entities/weapon'
import type { SetDef } from '@/data/gameData/echoSets/effects'
import type { EchoSttsCatD } from '@/data/gameData/catalog/echoStats'

// lifecycle states for an optimizer run
export type OptStts = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

// backend chosen to execute the optimizer
export type OptBckn = 'cpu' | 'gpu'

// optimizer phase the progress snapshot is currently describing. theory mode
// runs a discovery phase (the producer walks the row space) before workers
// begin evaluating; non-theory modes go straight to evaluation.
export type OptPrgrPh = 'discovering' | 'evaluating'

// progress snapshot exposed while optimization is running
export interface OptPrgr {
  progress: number
  elapsedMs: number
  remainingMs: number
  processed: number
  speed: number
  total?: number
  phase?: OptPrgrPh
  discovered?: number
}

// compact stat summary attached to one optimizer result entry
export interface OptResultStats {
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
export interface OptResultEntry {
  uids: string[]
  damage: number
  stats: OptResultStats | null
}

// materialized theoretical result, built from compact recipe rows only when needed
export interface TheoryResult {
  uids: string[]
  echoes: EchoInstance[]
  damage: number
  stats: OptResultStats | null
}

// bag-style result reference that stores indices instead of full echo payloads
export interface OptBagResult {
  damage: number
  i0: number
  i1: number
  i2: number
  i3: number
  i4: number
}

// theoretical result reference that stores the generated echo recipe compactly
export interface TheoryResultRow {
  damage: number
  ids: string[]
  sets: number[]
  mains: string[]
  main: number
  stats: OptResultStats | null
}

export type OptRawResult =
    | OptBagResult
    | TheoryResultRow

export type OptFinalResult =
    | OptResultEntry
    | TheoryResult

// typed aliases used by the packed optimizer buffers
export type CostArray = Uint8Array
export type SetArray = Uint8Array
export type KindArray = Uint16Array

// shared payload fields used by both target-skill and rotation optimizer runs
// these keys are internal worker contract fields, so compact names keep hot
// payload plumbing readable without touching persisted optimizer settings.
export interface PrepOptShrdP {
  resultsLimit: number
  lowMmryMode: boolean
  constraints: Float32Array
  costs: CostArray
  sets: SetArray
  kinds: KindArray
  comboN: number
  comboK: number
  totalCombos: number
  comboIndexMap: Int32Array
  comboBinom: Uint32Array
  lockMainReq: boolean
  lockMainCands: Int32Array
  progFact: number
}

// input payload used to start building an optimizer execution context
// this is the high-level request shape before compiler packing; short aliases
// distinguish transient catalog snapshots from saved calculator state.
export interface OptStartPay {
  resonatorId: string
  resSeed?: ResSeed
  staticData?: {
    gameDataReg: GameDataReg
    resCatById: Record<string, ResSeed>
    resDtlsById: Record<string, ResDtls>
    weaponsById: Record<string, GenWpn>
    echoCatById: Record<string, EchoDef>
    echoSetDefs: SetDef[]
    echoStats?: EchoSttsCatD
  }
  runtime: ResRuntime
  settings: OptSets
  invChs: EchoInstance[]
  enemyProfile: EnemyProfile
  selectedTargets?: Record<string, string | null>
  setConds?: SntSetConds
  rotTms?: RotationNode[] | null
}

// fully compiled scalar context for a single target skill evaluation
// this is the dense numeric form used to avoid repeated high-level reads
// during the optimizer inner loop.
// fields are grouped by final stats, scaling, skill bonuses, and combat
// counters in the same order used by the packed float context.
export interface CompTargetSkill {
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
  statFinAtk: number
  statFinHp: number
  statFinDef: number
  statFinEr: number
  statCritRate: number
  statCritDmg: number
  statHealBosi: number
  statShieldna: number
  statDmgBonus: number
  statAmp: number
  statFlatDmg: number
  statSpec: number
  resMult: number
  defMult: number
  dmgReduction: number
  statTuneBrcq: number
  statResShrd: number
  statDefGnr: number
  statDefShrd: number
  statDmgVuln: number
  scalingAtk: number
  scalingHp: number
  scalingDef: number
  scalingER: number
  hitScale: number
  hitCount: number
  multiplier: number
  flat: number
  fixedDmg: number
  skillHealBonus: number
  skillShield: number
  tuneRptrScl: number
  tuneRptrCrny: number
  tuneCritDmg: number
  negEfxMult: number
  negEfxFxdMv: number
  negEfxCritoo: number
  negEfxCritsa: number
  combatSpectro: number
  combatAero: number
  combatFusion: number
  combatGlacio: number
  combatElectro: number
  combatElecRage: number
}

// prepared target-skill optimizer run before final packed execution handoff
export interface PrepTargetSkill extends PrepOptShrdP {
  mode: 'targetSkill'
  runtime: ResRuntime
  skill: SkillDef
  selectedSkill: {
    id: string
    tab: string
    element: SkillDef['element']
    skillType: SkillDef['skillType']
    archetype: SkillDef['archetype']
  }
  sourceBaseStats: ResBaseStats
  sourceFinals: FinalStats
  compiled: CompTargetSkill
  setRtMask: number
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
}

// final packed target-skill payload sent into the execution layer
export interface PackedSkill extends PrepOptShrdP {
  mode: 'targetSkill'
  context: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
}

// prepared rotation optimizer run containing multiple packed contexts
// and one display context used for presenting representative stats/results.
export interface PrepRotRun extends PrepOptShrdP {
  mode: 'rotation'
  runtime: ResRuntime
  sourceBaseStats: ResBaseStats
  sourceFinals: FinalStats
  contextStride: number
  contextCount: number
  contexts: Float32Array
  contextWeight: Float32Array
  displayContext: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
}

export interface ThryProf {
  uid: string
  substats: Record<string, number>
}

export interface ThryEchoCt {
  id: string
  cost: number
  sets: number[]
  // true when the catalog echo carries at least one effect with
  // `targetScope: 'self'` (or implicit default). only self-buff cats are
  // eligible to serve as the main echo in theory search.
  hasSelfBff: boolean
}

export interface TheoryRow {
  slot: number
  id: string | null
  ids: string[]
  set: number
  main: string
  cost: number
  mainOk: boolean
}

// prepared target-skill theory run with fixed substat profiles and catalog rows
export interface PrepTheoryTarget extends PrepOptShrdP {
  mode: 'theoryTarget'
  staticData?: OptStartPay['staticData']
  theoryTotal: number
  runtime: ResRuntime
  skill: SkillDef
  selectedSkill: PrepTargetSkill['selectedSkill']
  sourceBaseStats: ResBaseStats
  sourceFinals: FinalStats
  compiled: CompTargetSkill
  setRtMask: number
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  profs: ThryProf[]
  cats: ThryEchoCt[]
  theoryRows: TheoryRow[]
  mainFltr: string[]
  selBonus: string | null
}

// prepared rotation theory run with the same display/evaluation context shape
export interface PrepTheoryRot extends PrepOptShrdP {
  mode: 'theoryRotation'
  staticData?: OptStartPay['staticData']
  theoryTotal: number
  runtime: ResRuntime
  sourceBaseStats: ResBaseStats
  sourceFinals: FinalStats
  contextStride: number
  contextCount: number
  contexts: Float32Array
  contextWeight: Float32Array
  displayContext: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  profs: ThryProf[]
  cats: ThryEchoCt[]
  theoryRows: TheoryRow[]
  mainFltr: string[]
  selBonus: string | null
}

// final packed rotation payload sent into the execution layer
export interface PckdRotXctnP extends PrepOptShrdP {
  mode: 'rotation'
  contextStride: number
  contextCount: number
  contexts: Float32Array
  contextWeight: Float32Array
  displayContext: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
}

// union of all prepared optimizer payload shapes
export type PrepOptPay =
    | PrepTargetSkill
    | PrepRotRun
    | PrepTheoryTarget
    | PrepTheoryRot

// union of all packed execution payload shapes
export type PckdOptXctnP =
    | PackedSkill
    | PckdRotXctnP
