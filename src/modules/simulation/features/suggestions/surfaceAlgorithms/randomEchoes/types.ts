/*
  Author: Runor Ewhro
  Description: Defines random-Echo preparation, result, and worker-message
               contracts shared by the suggestion host and worker.
*/

import type { RandGnrtSets } from '@/domain/entities/suggestions'
import type { EchoInstance } from '@/domain/entities/runtime'
import type { GameDataMode } from '@/domain/entities/gameDataMode'
import type { OptStatWeight } from '@/engine/optimizer/search/filtering'
import type { SuggestContext, SuggestInput } from '@/engine/suggestions/types'

export interface RandomEchoInput extends SuggestInput {
  settings: RandGnrtSets
  resultsLimit?: number
}

export interface RandomEchoPrep {
  context: SuggestContext
  runtimeId: string
  rawWeightMap: OptStatWeight
  statWeight: OptStatWeight
  settings: RandGnrtSets
  resultsLimit?: number
}

export interface RandomEchoEntry {
  damage: number
  echoes: Array<EchoInstance | null>
}

export interface RandomEchoWorkerRequest {
  id: number
  gameDataMode?: GameDataMode
  payload: RandomEchoPrep
}

export type RandomEchoWorkerResponse =
  | { id: number; ok: true; result: RandomEchoEntry[] }
  | { id: number; ok: false; error: string }
