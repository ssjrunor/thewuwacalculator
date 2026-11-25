/*
  Author: Runor Ewhro
  description: the conditions a rotation reaches, each at its highest value
               during the run: a toggle on once it is ever on, a number or stack
               count at its largest value, a select at its highest option index.
               scoring reads them from its existing run and stores them on the
               scored input, so a card's scenario starts with every effect its
               rotation enables and its combat stats include them. runs are
               unaffected because the preamble writes every state before the
               first hit.
*/

import type { CombatScenario } from '@/domain/entities/combatScenario'
import type { ScenarioInput } from '@/domain/leaderboard/scenarioInput'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { RotationNode, RuntimeValue, SourceState } from '@/domain/gameData/contracts'
import type { InspectEntry } from '@/engine/rotation/runTypes'
import { executeCombatScenarioProgram, prepareCombatScenario } from '@/engine/pipeline/combatScenario'
import { rotationMemberStates } from '@/engine/rotation/openingChoices'
import { projectScenarioEngineRuntimes } from '@/engine/runtime/scenarioRuntime'

/** each member's peak control values, by resonator id. */
export type PeakControls = Record<string, Record<string, RuntimeValue>>

/** the higher of two values of one control; strings that are not known select options keep the earlier value. */
function higher(state: SourceState | undefined, held: RuntimeValue, next: RuntimeValue): RuntimeValue {
  if (state?.kind === 'select') {
    const at = (value: RuntimeValue) => (state.options ?? []).findIndex((option) => String(option.id) === String(value))
    return at(next) > at(held) ? next : held
  }
  if (typeof held === 'boolean' || typeof next === 'boolean') return Boolean(held) || Boolean(next)
  if (typeof held === 'number' && typeof next === 'number') return Math.max(held, next)
  return held
}

/** every member control at the highest value a hit of the run saw it at, read off the run's inspection snapshots. */
export function peaksOfRun(scenario: CombatScenario, inspection: readonly InspectEntry[]): PeakControls {
  const { subjectRuntime } = projectScenarioEngineRuntimes(scenario)
  // a member's states depend on its equipment, which the run never changes, so one lookup per member covers every snapshot
  const statesById = new Map<string, Map<string, SourceState>>()
  const statesOf = (runtime: ResRuntime) => {
    let states = statesById.get(runtime.id)
    if (!states) {
      states = new Map(rotationMemberStates(runtime, subjectRuntime).map((state) => [state.controlKey, state]))
      statesById.set(runtime.id, states)
    }
    return states
  }
  const peaks: PeakControls = {}
  for (const entry of inspection) {
    for (const runtime of Object.values(entry.runtimeById ?? {})) {
      const states = statesOf(runtime)
      const peak = (peaks[runtime.id] ??= {})
      for (const [key, value] of Object.entries(runtime.state.controls)) {
        peak[key] = key in peak ? higher(states.get(key), peak[key], value) : value
      }
    }
  }
  return peaks
}

/** runs the scenario's program and returns its peaks. */
export function peakControls(scenario: CombatScenario, program: RotationNode[] = scenario.program.program): PeakControls {
  const result = executeCombatScenarioProgram(prepareCombatScenario(scenario), program)
  return result ? peaksOfRun(scenario, result.inspection) : {}
}

/** the input with each member's peaks applied for createScenario to seed; members the run never reached are unchanged. */
export function withInputPeaks(input: ScenarioInput, peaks: PeakControls): ScenarioInput {
  return { ...input, members: input.members.map((member) => {
    const peak = peaks[member.resonatorId]
    return peak ? { ...member, controls: { ...peak } } : member
  }) }
}
