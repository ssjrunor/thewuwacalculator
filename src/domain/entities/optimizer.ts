/*
  Author: Runor Ewhro
  Description: Defines optimizer state types for set selections, stat
               constraints, settings, and runtime-bound optimizer context.
*/

import type { ResonatorId, ResonatorRuntimeState } from './runtime'

export interface OptimizerSetSelections {
  3: number[]
  5: number[]
}

export interface OptimizerStatConstraint {
  minTotal?: string
  maxTotal?: string
}

export interface OptimizerSettings {
  targetSkillId: string | null
  targetMode: 'skill' | 'combo'
  targetComboSourceId: string | null
  rotationMode: boolean
  resultsLimit: number
  keepPercent: number
  lowMemoryMode: boolean
  enableGpu: boolean
  lockedMainEchoId: string | null
  allowedSets: OptimizerSetSelections
  mainStatFilter: string[]
  selectedBonus: string | null
  statConstraints: Record<string, OptimizerStatConstraint>
}

export interface OptimizerContextState {
  resonatorId: ResonatorId
  runtime: ResonatorRuntimeState
  settings: OptimizerSettings
}