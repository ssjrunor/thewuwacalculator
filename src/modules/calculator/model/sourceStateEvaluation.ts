/*
  Author: Runor Ewhro
  Description: builds state-evaluation scopes for source states and resolves
               whether those states should be visible or enabled for a given
               source/target/active runtime combination.
*/

import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import { buildTeamCompositionInfo } from '@/domain/gameData/teamComposition'
import type { SourceStateDefinition } from '@/domain/gameData/contracts'
import { evaluateCondition } from '@/engine/effects/evaluator'
import { computeEchoSetCounts } from '@/engine/pipeline/buildCombatContext'

// decide which runtime should be treated as the effective target for this state
// team/both display scopes point back to the source when evaluating teammates
function resolveStateTargetRuntime(
    sourceRuntime: ResonatorRuntimeState,
    targetRuntime: ResonatorRuntimeState,
    state: SourceStateDefinition,
): ResonatorRuntimeState {
  const teamScopedState = state.displayScope === 'team' || state.displayScope === 'both'

  if (teamScopedState && sourceRuntime.id !== targetRuntime.id) {
    return sourceRuntime
  }

  return targetRuntime
}

// build the evaluator scope object used by visibleWhen/enabledWhen
// includes source, target, active runtime, team info, and echo set counts
export function buildSourceStateScope(
    sourceRuntime: ResonatorRuntimeState,
    targetRuntime: ResonatorRuntimeState,
    state: SourceStateDefinition,
    activeRuntime: ResonatorRuntimeState = targetRuntime,
) {
  const scopedTargetRuntime = resolveStateTargetRuntime(sourceRuntime, targetRuntime, state)

  // build a de-duplicated team list centered around the current active runtime
  const teamMemberIds = Array.from(
      new Set([
        activeRuntime.id,
        ...activeRuntime.build.team.filter((memberId): memberId is string => Boolean(memberId)),
      ]),
  )
  const team = buildTeamCompositionInfo(teamMemberIds)

  return {
    sourceRuntime,
    targetRuntime: scopedTargetRuntime,
    activeRuntime,
    context: {
      team,
      source: {
        type: state.source.type,
        id: state.source.id,
      },
      sourceRuntime,
      targetRuntime: scopedTargetRuntime,
      activeRuntime,
      targetRuntimeId: scopedTargetRuntime.id,
      activeResonatorId: activeRuntime.id,
      teamMemberIds,
      echoSetCounts: computeEchoSetCounts(sourceRuntime.build.echoes),
    },
  }
}

// evaluate whether this state should be shown in the ui for the current scope
export function evaluateSourceStateVisibility(
    sourceRuntime: ResonatorRuntimeState,
    targetRuntime: ResonatorRuntimeState,
    state: SourceStateDefinition,
    activeRuntime: ResonatorRuntimeState = targetRuntime,
): boolean {
  return evaluateCondition(
      state.visibleWhen,
      buildSourceStateScope(sourceRuntime, targetRuntime, state, activeRuntime),
  )
}

// evaluate whether this state should be interactive/enabled for the current scope
export function evaluateSourceStateEnabled(
    sourceRuntime: ResonatorRuntimeState,
    targetRuntime: ResonatorRuntimeState,
    state: SourceStateDefinition,
    activeRuntime: ResonatorRuntimeState = targetRuntime,
): boolean {
  return evaluateCondition(
      state.enabledWhen,
      buildSourceStateScope(sourceRuntime, targetRuntime, state, activeRuntime),
  )
}