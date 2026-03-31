/*
  Author: Runor Ewhro
  Description: builds evaluation scope for resonator state controls and
               resolves whether a control is enabled for the current runtime.
*/

import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { ResonatorStateControl } from '@/domain/entities/resonator'
import { buildTeamCompositionInfo } from '@/domain/gameData/teamComposition'
import { evaluateCondition } from '@/engine/effects/evaluator'
import { computeEchoSetCounts } from '@/engine/pipeline/buildCombatContext'

// build the standard evaluator scope used for resonator-local control checks
// the runtime acts as source, target, and active runtime because these controls
// are evaluated from the perspective of the current resonator
function buildResonatorControlScope(runtime: ResonatorRuntimeState) {
  // create a de-duplicated team member list including the active resonator
  const teamMemberIds = Array.from(
      new Set([
        runtime.id,
        ...runtime.build.team.filter((memberId): memberId is string => Boolean(memberId)),
      ]),
  )
  const team = buildTeamCompositionInfo(teamMemberIds)

  return {
    sourceRuntime: runtime,
    targetRuntime: runtime,
    activeRuntime: runtime,
    context: {
      team,
      source: {
        type: 'resonator' as const,
        id: runtime.id,
      },
      sourceRuntime: runtime,
      targetRuntime: runtime,
      activeRuntime: runtime,
      targetRuntimeId: runtime.id,
      activeResonatorId: runtime.id,
      teamMemberIds,
      echoSetCounts: computeEchoSetCounts(runtime.build.echoes),
    },
  }
}

// evaluate whether a resonator control should currently be enabled
export function evaluateResonatorControlEnabled(
    runtime: ResonatorRuntimeState,
    control: ResonatorStateControl,
): boolean {
  return evaluateCondition(control.enabledWhen, buildResonatorControlScope(runtime))
}