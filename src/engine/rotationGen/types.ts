/*
  Author: Runor Ewhro
  description: defines interpreter inputs, rule records, and generated program results.
*/

import type { CombatScenario } from '../../domain/entities/combatScenario'

// rule operations address heterogeneous JSON values through authored property paths.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RuntimeValue = any
export type RuntimeRecord = Record<string, RuntimeValue>
export type JsonLoader = (path: string) => Promise<unknown>
export type DataMode = 'live' | 'beta'

export interface CharacterRuleLibrary {
  has(id: string | number): boolean
  coverage(id: string | number): Promise<RuntimeRecord | null>
  load(ids: string[], mode: DataMode): Promise<Record<string, RuntimeRecord>>
}

export interface GearLibrary {
  module(kind: 'weapon' | 'mainEcho' | 'sonata', id: number | string, selection?: number): RuntimeRecord
}

export interface InterpreterLoaders {
  mode: DataMode
  /** logical paths omit .json and are relative to the ruleset's game-data directory. */
  gameData: JsonLoader
  /** logical paths omit .json and are relative to the interpretation-data directory. */
  interpretationData: JsonLoader
}

export interface InterpreterEnvironment {
  mode: DataMode
  gameData: JsonLoader
  characters: CharacterRuleLibrary
  gear: GearLibrary
  echoCatalog: RuntimeRecord[]
  echoSources: RuntimeRecord[]
  weaponSources: RuntimeRecord[]
  sonataDefinitions: RuntimeRecord[]
  enemySources: RuntimeRecord[]
}

export interface InterpretationDiagnostics extends RuntimeRecord {
  code?: string
  message?: string
}

export type InterpretationResult = {
  status: 'interpreted'
  scenario: CombatScenario
  duration: number
  diagnostics: InterpretationDiagnostics
} | {
  status: 'unsupported'
  diagnostics: InterpretationDiagnostics
}
