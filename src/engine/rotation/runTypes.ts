/*
  Author: Runor Ewhro
  Description: Defines the public execution, inspection, scoring, and damage
               callback contracts shared by rotation callers.
*/

import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type {
  DamageFeature,
  RotationNode,
} from '@/domain/gameData/contracts.ts'
import type {
  DamageResult,
  SkillAggType,
  SkillDef,
} from '@/domain/entities/stats.ts'
import type { DamageCombatState } from '@/engine/formulas/damage.ts'

type EffectiveStats = NonNullable<DamageFeature['effectiveStats']>

export type InspectValue =
  | {
    kind: 'feature'
    resonatorId?: string
    normal: number
    crit: number
    avg: number
    ggrgType: SkillAggType
    effectiveStats?: EffectiveStats
  }
  | {
    kind: 'condition'
    path: string
    before?: string | number | boolean
    value: string | number | boolean | undefined
  }
  | { kind: 'repeat'; times: number }
  | { kind: 'uptime'; ratio: number }
  | { kind: 'loop'; markerKind: 'start'; label: string; runs: number }

export interface InspectEntry {
  nodeId: string
  nodeType: RotationNode['type']
  executed: boolean
  value?: InspectValue
  loopRuns?: Record<string, number>
  loopRunCnts?: Record<string, number>
  runtimeById?: Record<string, ResRuntime>
  selectedTargetsByRuntimeId?: Record<string, Record<string, string | null>>
  activeResonatorId?: string
  enemy?: EnemyProfile
}

export type RunDetail = 'full' | 'summary'

export interface SimulationOpts {
  sequence?: RotationNode[]
  program?: RotationNode[]
  detail?: RunDetail
}

export interface InspectOpts {
  items?: RotationNode[]
  includeSnapshots?: boolean
}

export interface DetailedRunOpts extends InspectOpts {
  detail?: RunDetail
}

export interface DamageInvocation {
  resonatorId: string
  lane: number
  group: number
  suppressWhenEmpty: boolean
  skill: SkillDef
  runtime: ResRuntime
  enemy: EnemyProfile
  level: number
  combat: DamageCombatState
  finalPlane: Float64Array
  finalOffset: number
  nodeMultiplier: number
  weight: number
  loopDivisor: number
  immunityAll: number
  immunityElements: number
  immunitySkillTypes: number
  immunityNegative: number
}

export interface ProgramOpts {
  detail?: RunDetail
  inspect?: boolean
  includeSnapshots?: boolean
  fallbackResonatorId?: string
  captureEntries?: boolean
  /** Borrowed array and object views must be consumed synchronously. */
  onDamageInvocation?: (invocation: DamageInvocation) => void
}

export interface RunMetrics {
  numericForks: number
  numericCheckpoints: number
  objectOverlayCopies: number
  runtimeMaterializations: number
  graphMaterializations: number
  legacyConditionEvaluations: number
  scalarFeatures: number
  capturedEntries: number
}

export interface ProgramResult {
  entries: DamageFeature[]
  inspection: InspectEntry[]
  metrics: RunMetrics
}

export interface NumericScore {
  total: Pick<DamageResult, 'normal' | 'crit' | 'avg'>
  resonators: Array<{ id: string; normal: number; crit: number; avg: number }>
  normalizedTotal: Pick<DamageResult, 'normal' | 'crit' | 'avg'>
  normalizedResonators: Array<{
    id: string
    normal: number
    crit: number
    avg: number
  }>
  metrics: RunMetrics
}
