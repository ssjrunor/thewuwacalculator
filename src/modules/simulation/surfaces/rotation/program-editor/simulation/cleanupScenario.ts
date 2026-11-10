/*
  Author: Runor Ewhro
  description: runs a scenario export through the editor cleanup until a fresh
               run finds no targets, and rejects any pass that changes feature results.
*/

import type { CombatScenario } from '@/domain/entities/combatScenario.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { prepareCombatScenario } from '@/engine/pipeline/combatScenario.ts'
import type { FeatureResult } from '@/domain/gameData/contracts.ts'
import { visibleRotMembers } from '@/modules/simulation/surfaces/rotation/shared/catalog.ts'
import { applyRotationCleanup, cleanupCounts, planRotationCleanup } from '../model/cleanup.ts'
import { editorSectionsToRotation } from '../model/toRotationNodes.ts'
import { rotationCleanupSources } from '../model/cleanupSources.ts'
import { executeRunTrace, projectRun } from './runProgram.ts'

// serialize the per-feature results a cleanup must preserve exactly
function featureOutcomes(entries: FeatureResult[]): string {
  return JSON.stringify(entries.map(entry => ({
    nodeId: entry.nodeId, resonatorId: entry.resonatorId, featureId: entry.feature.id,
    aggregationType: entry.aggregationType, multiplier: entry.multiplier, weight: entry.weight,
    normal: entry.normal, crit: entry.crit, avg: entry.avg,
  })))
}

/*
  clean a scenario's rotation with the bound game-data snapshot, the same way
  loading and running it in the editor would.
  each pass: run the program, compare feature results with the first run,
  plan cleanup from the projected sections, then serialize the cleaned program.
  throws when a program repeats, a plan changes nothing, or results differ.
*/
export function cleanupScenarioRotation(input: CombatScenario) {
  let scenario = structuredClone(input)
  const counts = { inert: 0, dead: 0, redundant: 0, reordered: 0, detached: 0, total: 0 }
  const seen = new Set<string>()
  let baseline: string | undefined
  let passes = 0
  for (;;) {
    const signature = JSON.stringify(scenario.program.program)
    if (seen.has(signature)) throw new Error('Scenario cleanup did not converge')
    seen.add(signature)
    const prepared = prepareCombatScenario(scenario)
    const runtime = prepared.subjectRuntime
    const seed = getResSeedBy(runtime.id)
    if (!seed) throw new Error(`Missing editor seed for ${runtime.id}`)
    const members = visibleRotMembers(runtime, { ...prepared.runtimesById })
    const runInput = { runtime, seed, runtimesById: { ...prepared.runtimesById },
      targetSelections: { ...prepared.selectedTargets }, enemy: scenario.target, members,
      prepWork: prepared.workspace, includeFlatRows: false, cacheDetailed: false }
    const execution = executeRunTrace(runInput)
    const outcomes = featureOutcomes(execution.entries)
    if (baseline != null && outcomes !== baseline) throw new Error('Scenario cleanup changed feature outcomes')
    baseline ??= outcomes
    const run = projectRun({ ...runInput, execution })
    const plan = planRotationCleanup(run.sections, rotationCleanupSources(members, scenario.target.id))
    if (!plan.targets.length) {
      scenario.program.lastRanAt = run.ranAt
      return { scenario, counts, passes }
    }
    const cleaned = applyRotationCleanup(run.sections, plan)
    if (cleaned === run.sections) throw new Error('Scenario cleanup made no progress')
    const applied = cleanupCounts(plan)
    for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] += applied[key]
    // runtime projections are cached by scenario identity, so each pass builds
    // a new scenario object and the next run reads the serialized program
    scenario = { ...scenario, program: { ...scenario.program,
      program: editorSectionsToRotation(cleaned, scenario.program.program).flatMap(section => section.items) } }
    passes++
  }
}
