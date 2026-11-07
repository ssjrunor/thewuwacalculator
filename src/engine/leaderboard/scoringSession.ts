/*
  Author: Runor Ewhro
  description: binds a process to one game-data snapshot and creates scenario scoring contexts.
*/

import { initGameData, setGameDataReader } from '@/data/gameData'
import { createInterpreterEnvironment, type InterpreterEnvironment } from '@/engine/rotationGen'
import type { OpenedRuleset } from './rulesetReader'
import { refsKey } from './rulesetReader'
import type { RotationExecutor, ScenarioScoringContext } from './scoreScenario'
import { scenarioInputDeps } from './scenarioInputDeps'

export class ScoringDataConflict extends Error {
  constructor(bound: string, wanted: string) {
    super(`this process holds game data ${bound.slice(0, 12)}, the ruleset needs ${wanted.slice(0, 12)}`)
    this.name = 'ScoringDataConflict'
  }
}

let boundFingerprint: string | null = null
let bindings: Promise<void> | null = null

/** point the app's game data at the ruleset's snapshot (once per process). */
export async function bindRulesetGameData(ruleset: OpenedRuleset): Promise<void> {
  if (boundFingerprint && boundFingerprint !== ruleset.gameDataFingerprint) {
    throw new ScoringDataConflict(boundFingerprint, ruleset.gameDataFingerprint)
  }
  // record the fingerprint before asynchronous initialization so simultaneous callers cannot bind different snapshots.
  if (!bindings) {
    boundFingerprint = ruleset.gameDataFingerprint
    setGameDataReader(ruleset.gameDataReader)
    // a failed initialization clears the binding and reader, allowing the same process to retry loading cleanly.
    bindings = initGameData({ mode: ruleset.manifest.dataMode }).catch((error) => {
      boundFingerprint = null
      bindings = null
      setGameDataReader(null)
      throw error
    })
  }
  return bindings
}

export interface ScoringSession {
  ruleset: OpenedRuleset
  interpreter: InterpreterEnvironment
  context(execute: RotationExecutor): ScenarioScoringContext
}

// initialize the interpreter from this ruleset's data readers and expose the matching plans, teammates, and reference lookup.
export async function openScoringSession(ruleset: OpenedRuleset, options: {
  /** false when the process's game data was loaded elsewhere (tests). */
  bindGameData?: boolean
} = {}): Promise<ScoringSession> {
  if (options.bindGameData ?? true) await bindRulesetGameData(ruleset)
  const interpreter = await createInterpreterEnvironment({
    mode: ruleset.manifest.dataMode,
    gameData: ruleset.gameData,
    interpretationData: ruleset.interpretationData,
  })
  const deps = scenarioInputDeps()
  return {
    ruleset,
    interpreter,
    context: (execute) => ({
      interpreter,
      plans: ruleset.plans,
      teammates: ruleset.teammates,
      deps,
      refsFor: (scenarioId, sequence) => ruleset.refs?.get(refsKey(scenarioId, sequence)) ?? null,
      execute,
    }),
  }
}
