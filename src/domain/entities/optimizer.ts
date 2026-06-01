/*
  Author: Runor Ewhro
  Description: Defines optimizer state types for set selections, stat
               constraints, settings, and runtime-bound optimizer context.
*/

import type { ResonatorId, ResRuntime } from './runtime'

export interface OptSetChoice {
  1: number[]
  3: number[]
  5: number[]
}

export interface OptStatCstr {
  minTotal?: string
  maxTotal?: string
}

export type OptSearchMode = 'inventory' | 'theory'

export interface OptSets {
  targetSkillId: string | null
  targetMode: 'skill' | 'combo'
  targetComboSourceId: string | null
  rotationMode: boolean
  searchMode: OptSearchMode
  resultsLimit: number
  keepPercent: number
  lowMemoryMode: boolean
  enableGpu: boolean
  lockedMainEchoId: string | null
  allowedSets: OptSetChoice
  mainStatFilter: string[]
  selectedBonus: string | null
  statConstraints: Record<string, OptStatCstr>
}

export interface OptContext {
  resonatorId: ResonatorId
  runtime: ResRuntime
  settings: OptSets
}
