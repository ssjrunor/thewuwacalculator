/*
  Author: Runor Ewhro
  Description: Resolves conditional select-option sets for resonator controls
               and source states, and normalizes invalid stored control values.
*/

import { getResonatorDetailsById } from '@/data/gameData/resonators/resonatorDataStore'
import type { ResonatorStateControl } from '@/domain/entities/resonator'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { SourceStateDefinition, SourceStateOption } from '@/domain/gameData/contracts'
import { buildTeamCompositionInfo } from '@/domain/gameData/teamComposition'
import { evaluateCondition } from '@/engine/effects/evaluator'
import { computeEchoSetCounts } from '@/engine/pipeline/buildCombatContext'

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function buildResonatorControlScope(runtime: ResonatorRuntimeState) {
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

export function resolveResonatorControlOptions(
  runtime: ResonatorRuntimeState,
  control: ResonatorStateControl,
): number[] {
  const scope = buildResonatorControlScope(runtime)

  for (const optionSet of control.optionsWhen ?? []) {
    if (evaluateCondition(optionSet.when, scope)) {
      return optionSet.options
    }
  }

  if (control.sequenceAwareOptions) {
    return runtime.base.sequence >= control.sequenceAwareOptions.threshold
      ? control.sequenceAwareOptions.atOrAbove
      : control.sequenceAwareOptions.below
  }

  return control.options ?? []
}

export function getResonatorControlInactiveValue(
  control: ResonatorStateControl,
  runtime?: ResonatorRuntimeState,
): boolean | number {
  if (control.kind === 'toggle') {
    return false
  }

  if (control.kind === 'select') {
    const firstOption = runtime ? resolveResonatorControlOptions(runtime, control)[0] : control.options?.[0]
    return control.min ?? firstOption ?? 0
  }

  return control.min ?? 0
}

export function normalizeResonatorRuntimeControls(
  runtime: ResonatorRuntimeState,
  controls: Record<string, boolean | number | string> = runtime.state.controls,
): Record<string, boolean | number | string> {
  const details = getResonatorDetailsById()[runtime.id]
  if (!details) {
    return controls
  }

  const availableControls = [
    ...details.statePanels.flatMap((panel) => panel.controls),
    ...details.resonanceChains.flatMap((entry) => entry.controls ?? []),
  ]

  const nextControls = { ...controls }
  let changed = false

  for (const control of availableControls) {
    const scopedRuntime = {
      ...runtime,
      state: {
        ...runtime.state,
        controls: nextControls,
      },
    }

    if (control.disabledWhen && nextControls[control.disabledWhen.key] === control.disabledWhen.equals) {
      const inactiveValue = getResonatorControlInactiveValue(control, scopedRuntime)
      if (nextControls[control.key] !== inactiveValue) {
        nextControls[control.key] = inactiveValue
        changed = true
      }
      continue
    }

    if (control.kind === 'select') {
      const options = resolveResonatorControlOptions(scopedRuntime, control)
      const currentValue = Number(nextControls[control.key] ?? Number.NaN)

      if (!options.includes(currentValue)) {
        nextControls[control.key] = getResonatorControlInactiveValue(control, scopedRuntime)
        changed = true
      }
      continue
    }

    if (control.kind === 'number') {
      const min = control.min ?? 0
      const max = control.sequenceAwareCap
        ? runtime.base.sequence >= control.sequenceAwareCap.threshold
          ? control.sequenceAwareCap.atOrAbove
          : control.sequenceAwareCap.below
        : control.max

      const numericValue = Number(nextControls[control.key] ?? min)
      const boundedValue = max == null
        ? Math.max(numericValue, min)
        : clampNumber(numericValue, min, max)

      if (boundedValue !== numericValue) {
        nextControls[control.key] = boundedValue
        changed = true
      }
    }
  }

  return changed ? nextControls : controls
}

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

export function buildSourceStateScope(
  sourceRuntime: ResonatorRuntimeState,
  targetRuntime: ResonatorRuntimeState,
  state: SourceStateDefinition,
  activeRuntime: ResonatorRuntimeState = targetRuntime,
) {
  const scopedTargetRuntime = resolveStateTargetRuntime(sourceRuntime, targetRuntime, state)
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

export function resolveSourceStateOptions(
  sourceRuntime: ResonatorRuntimeState,
  targetRuntime: ResonatorRuntimeState,
  state: SourceStateDefinition,
  activeRuntime: ResonatorRuntimeState = targetRuntime,
): SourceStateOption[] {
  const scope = buildSourceStateScope(sourceRuntime, targetRuntime, state, activeRuntime)

  for (const optionSet of state.optionsWhen ?? []) {
    if (evaluateCondition(optionSet.when, scope)) {
      return optionSet.options
    }
  }

  return state.options ?? []
}

export function getSourceStateInactiveValue(
  sourceRuntime: ResonatorRuntimeState,
  targetRuntime: ResonatorRuntimeState,
  state: SourceStateDefinition,
  activeRuntime: ResonatorRuntimeState = targetRuntime,
): boolean | number | string {
  if (state.kind === 'toggle') {
    return false
  }

  if (state.kind === 'select') {
    return state.defaultValue ?? resolveSourceStateOptions(sourceRuntime, targetRuntime, state, activeRuntime)[0]?.id ?? ''
  }

  return state.defaultValue ?? state.min ?? 0
}
