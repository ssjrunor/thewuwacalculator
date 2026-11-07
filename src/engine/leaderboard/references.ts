/*
  Author: Runor Ewhro
  description: the reference step: for every scenario and sequence, the dps of
               three reference builds (baseline 0%, benchmark 100%, perfect
               200%) that every build on that board is measured against. the
               search itself is injected; it needs the rotation executed, so
               until execution is connected the pending search marks every
               entry unsupported, and those scenarios score nothing.
*/

import type { ScenarioDef, ScenarioRefs } from '@/domain/leaderboard/ruleset'
import type { ActionPlan } from '@/domain/rotationActions/types'
import type { OpenedRuleset } from './rulesetReader'
import { validAnchors } from './scoreFormula'

export interface ReferenceRequest {
  def: ScenarioDef
  sequence: number
  plan: ActionPlan
}

export type ReferenceResult =
  | { status: 'ok'; baselineDps: number; benchDps: number; perfectDps: number; programs: ScenarioRefs['programs'] }
  | { status: 'unsupported'; reason: string }

/** finds the three reference builds of one scenario at one sequence and the dps of each. */
export type ReferenceSearch = (request: ReferenceRequest) => Promise<ReferenceResult>

export const pendingReferenceSearch: ReferenceSearch = async () => ({ status: 'unsupported', reason: 'rotation_execution_pending' })

export const ALL_SEQUENCES = [0, 1, 2, 3, 4, 5, 6] as const

export interface ReferenceRun {
  refs: ScenarioRefs[]
  /** why entries are unsupported, counted. */
  reasons: Record<string, number>
}

// reference values are keyed by scenario and sequence; invalid or non-increasing anchors produce unsupported entries.
export async function computeReferences(ruleset: OpenedRuleset, search: ReferenceSearch, options: {
  sequences?: readonly number[]
  scenarioIds?: ReadonlySet<string>
  onProgress?: (done: number, total: number) => void
} = {}): Promise<ReferenceRun> {
  const sequences = options.sequences ?? ALL_SEQUENCES
  const defs = ruleset.defs.filter((def) => !options.scenarioIds || options.scenarioIds.has(def.id))
  const refs: ScenarioRefs[] = []
  const reasons: Record<string, number> = {}
  const total = defs.length * sequences.length
  for (const def of defs) {
    for (const sequence of sequences) {
      const result = await search({ def, sequence, plan: ruleset.plans[def.teamId] })
      if (result.status === 'ok' && validAnchors(result)) {
        refs.push({ scenarioId: def.id, sequence, status: 'ok', baselineDps: result.baselineDps, benchDps: result.benchDps,
          perfectDps: result.perfectDps, programs: result.programs })
      } else {
        const reason = result.status === 'ok' ? 'anchors_not_increasing' : result.reason
        reasons[reason] = (reasons[reason] ?? 0) + 1
        refs.push({ scenarioId: def.id, sequence, status: 'unsupported', baselineDps: 0, benchDps: 0, perfectDps: 0,
          programs: { baseline: '', bench: '', perfect: '' } })
      }
      options.onProgress?.(refs.length, total)
    }
  }
  return { refs, reasons }
}
