/*
  Author: Runor Ewhro
  description: exports optional anchor diagnostics for authored template builds,
               run only for documented verified cases. submitted cards use their
               own ER and utility gear through the app evaluator.
*/

import type { ScenarioDef, ScenarioRefs } from '@/domain/leaderboard/ruleset'
import type { ActionPlan } from '@/domain/rotationActions/types'
import type { OpenedRuleset } from './rulesetReader'
import { validAnchors } from './scoreFormula'
import { hasScoringData } from './coverage'

export interface ReferenceRequest {
  def: ScenarioDef
  sequence: number
  plan: ActionPlan
}

export type ReferenceResult =
  | { status: 'ok'; baselineDamage: number; benchDamage: number; perfectDamage: number; programs: ScenarioRefs['programs'] }
  | { status: 'unsupported'; reason: string }

/** finds the three reference builds and their total rotation damage. */
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
      const result = hasScoringData(def)
        ? await search({ def, sequence, plan: ruleset.plans[def.teamId] })
        : { status: 'unsupported' as const, reason: 'insufficient_data' }
      if (result.status === 'ok' && validAnchors(result)) {
        refs.push({ scenarioId: def.id, sequence, status: 'ok', baselineDamage: result.baselineDamage, benchDamage: result.benchDamage,
          perfectDamage: result.perfectDamage, programs: result.programs })
      } else {
        const reason = result.status === 'ok' ? 'anchors_not_increasing' : result.reason
        reasons[reason] = (reasons[reason] ?? 0) + 1
        refs.push({ scenarioId: def.id, sequence, status: 'unsupported', baselineDamage: 0, benchDamage: 0, perfectDamage: 0,
          programs: { baseline: '', bench: '', perfect: '' } })
      }
      options.onProgress?.(refs.length, total)
    }
  }
  return { refs, reasons }
}
