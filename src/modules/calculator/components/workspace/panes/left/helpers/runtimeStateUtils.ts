import type { SyntheticEvent } from 'react'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { ResonatorStateControl } from '@/domain/entities/resonator'
import { getResonatorDetailsById } from '@/data/gameData/resonators/resonatorDataStore'
import {
  getResonatorControlInactiveValue,
  getSourceStateInactiveValue,
  normalizeResonatorRuntimeControls,
} from '@/domain/gameData/controlOptions'
import { writeRuntimePath } from '@/domain/gameData/runtimePath'
import type { ConditionExpression, EffectDefinition, FormulaExpression, SourceStateDefinition } from '@/domain/gameData/contracts'
import { getResonator } from '@/modules/calculator/model/resonator'
import { listEffectsForOwnerKey, listStatesForSource } from '@/domain/services/gameDataService'
import {
  evaluateSourceStateEnabled,
  evaluateSourceStateVisibility,
} from '@/modules/calculator/model/sourceStateEvaluation'
import { withDefaultIconImage } from '@/shared/lib/imageFallback'

// shared helpers that keep runtime controls in sync across left pane panes and modals.
export type RuntimeUpdateHandler = (
  updater: (runtime: ResonatorRuntimeState) => ResonatorRuntimeState,
) => void

export function withDefaultResonatorImage(event: SyntheticEvent<HTMLImageElement>) {
  withDefaultIconImage(event)
}

export function setRuntimePath(
  onRuntimeUpdate: RuntimeUpdateHandler,
  path: string,
  value: string | number | boolean,
): void {
  onRuntimeUpdate((prev) => writeRuntimePath(prev, path, value))
}

export function setSourceStateValue(
  onRuntimeUpdate: RuntimeUpdateHandler,
  sourceRuntime: ResonatorRuntimeState,
  targetRuntime: ResonatorRuntimeState,
  state: SourceStateDefinition,
  value: string | number | boolean,
  activeRuntime: ResonatorRuntimeState = targetRuntime,
): void {
  onRuntimeUpdate((prev) => {
    let nextRuntime = writeRuntimePath(prev, state.path, value)

    if (state.kind === 'toggle' && value === true && state.resets?.length) {
      const allStates = listStatesForSource(state.source.type, state.source.id)
      const scopedTargetRuntime = nextRuntime
      const scopedSourceRuntime = sourceRuntime.id === targetRuntime.id ? scopedTargetRuntime : sourceRuntime
      const scopedActiveRuntime = activeRuntime.id === targetRuntime.id ? scopedTargetRuntime : activeRuntime

      for (const resetControlKey of state.resets) {
        const resetState = allStates.find((candidate) => candidate.controlKey === resetControlKey)
        if (!resetState) {
          nextRuntime = writeRuntimePath(nextRuntime, `state.controls.${resetControlKey}`, false)
          continue
        }

        nextRuntime = writeRuntimePath(
          nextRuntime,
          resetState.path,
          getSourceStateInactiveValue(scopedSourceRuntime, scopedTargetRuntime, resetState, scopedActiveRuntime),
        )
      }
    }

    return nextRuntime
  })
}

export function isSourceStateVisible(
  sourceRuntime: ResonatorRuntimeState,
  targetRuntime: ResonatorRuntimeState,
  state: SourceStateDefinition,
  activeRuntime: ResonatorRuntimeState = targetRuntime,
): boolean {
  return evaluateSourceStateVisibility(sourceRuntime, targetRuntime, state, activeRuntime)
}

export function isSourceStateEnabled(
  sourceRuntime: ResonatorRuntimeState,
  targetRuntime: ResonatorRuntimeState,
  state: SourceStateDefinition,
  activeRuntime: ResonatorRuntimeState = targetRuntime,
): boolean {
  return evaluateSourceStateEnabled(sourceRuntime, targetRuntime, state, activeRuntime)
}

const CONTROLS_PREFIX = 'state.controls.'

function conditionReferencesControl(condition: ConditionExpression | undefined, controlKey: string): boolean {
  if (!condition) return false
  if ('path' in condition) {
    return condition.path === `${CONTROLS_PREFIX}${controlKey}`
  }
  if (condition.type === 'and' || condition.type === 'or') {
    return condition.values.some((v) => conditionReferencesControl(v, controlKey))
  }
  if (condition.type === 'not') {
    return conditionReferencesControl(condition.value, controlKey)
  }
  return false
}

function formulaReferencesControl(formula: FormulaExpression, controlKey: string): boolean {
  if ('path' in formula) {
    return formula.path === `${CONTROLS_PREFIX}${controlKey}`
  }
  if ('values' in formula) {
    return formula.values.some((v) => formulaReferencesControl(v, controlKey))
  }
  if ('value' in formula && typeof formula.value === 'object') {
    return formulaReferencesControl(formula.value, controlKey)
  }
  return false
}

function effectReferencesState(effect: EffectDefinition, controlKey: string): boolean {
  if (conditionReferencesControl(effect.condition, controlKey)) return true
  return effect.operations.some((op) => formulaReferencesControl(op.value, controlKey))
}

function negativeEffectSourceReferencesState(
  state: SourceStateDefinition,
): boolean {
  if (state.source.type !== 'resonator') {
    return false
  }

  const negativeEffectSources = getResonatorDetailsById()[state.source.id]?.negativeEffectSources ?? []
  return negativeEffectSources.some((source) => conditionReferencesControl(source.enabledWhen, state.controlKey))
}

export function getStateEffectTargetScopes(
  state: SourceStateDefinition,
): Array<NonNullable<EffectDefinition['targetScope']> | 'self'> {
  const scopes = new Set<NonNullable<EffectDefinition['targetScope']> | 'self'>()

  for (const effect of listEffectsForOwnerKey(state.ownerKey)) {
    if (!effectReferencesState(effect, state.controlKey)) {
      continue
    }

    scopes.add(effect.targetScope ?? 'self')
  }

  if (negativeEffectSourceReferencesState(state)) {
    scopes.add('teamWide')
  }

  return Array.from(scopes)
}

export function collectSourceStateDependencyKeys(
  states: SourceStateDefinition[],
  shouldIncludeState: (state: SourceStateDefinition) => boolean,
): Set<string> {
  const statesByControlKey = new Map(states.map((state) => [state.controlKey, state]))
  const included = new Set<string>()

  function includeState(controlKey: string) {
    if (included.has(controlKey)) {
      return
    }

    const state = statesByControlKey.get(controlKey)
    if (!state) {
      return
    }

    included.add(controlKey)

    for (const dependency of state.controlDependencies ?? []) {
      includeState(dependency)
    }
  }

  for (const state of states) {
    if (shouldIncludeState(state)) {
      includeState(state.controlKey)
    }
  }

  return included
}

export function filterSourceStatesWithDependencies(
  states: SourceStateDefinition[],
  shouldIncludeState: (state: SourceStateDefinition) => boolean,
  shouldRenderState: (state: SourceStateDefinition) => boolean,
): SourceStateDefinition[] {
  const includedControlKeys = collectSourceStateDependencyKeys(states, shouldIncludeState)

  return states.filter((state) =>
    includedControlKeys.has(state.controlKey)
    && shouldRenderState(state),
  )
}

export function stateHasTeamFacingEffects(
  state: SourceStateDefinition,
  options: { includeTeamWide: boolean },
): boolean {
  const hasTeamFacingEffect = getStateEffectTargetScopes(state).some((targetScope) => {
    if (
      targetScope === 'active'
      || targetScope === 'activeOther'
      || targetScope === 'otherTeammates'
    ) {
      return true
    }

    return options.includeTeamWide && targetScope === 'teamWide'
  })

  if (hasTeamFacingEffect) {
    return true
  }

  return negativeEffectSourceReferencesState(state)
}

export function getStateTeamTargetMode(state: SourceStateDefinition): 'active' | 'activeOther' | null {
  const effects = getStateEffectTargetScopes(state)

  if (effects.some((effect) => effect === 'active')) {
    return 'active'
  }

  if (effects.some((effect) => effect === 'activeOther')) {
    return 'activeOther'
  }

  return null
}

export function getTeamTargetOptions(
  teamRuntime: ResonatorRuntimeState,
  ownerRuntimeId: string,
  mode: 'active' | 'activeOther',
) {
  const memberIds = Array.from(
    new Set([teamRuntime.id, ...teamRuntime.build.team.filter((memberId): memberId is string => Boolean(memberId))]),
  )

  const eligibleIds = mode === 'activeOther'
    ? memberIds.filter((memberId) => memberId !== ownerRuntimeId)
    : memberIds

  return eligibleIds
    .map((memberId) => {
      const member = getResonator(memberId)
      if (!member) {
        return null
      }

      return {
        value: memberId,
        label: member.name,
      }
    })
    .filter((option): option is { value: string; label: string } => option != null)
}

export function getControlInactiveValue(
  control: ResonatorStateControl,
  runtime?: ResonatorRuntimeState,
): boolean | number {
  return getResonatorControlInactiveValue(control, runtime)
}

export function applyCascadeResets(
  runtime: ResonatorRuntimeState,
  prevControls: Record<string, boolean | number | string>,
  nextControls: Record<string, boolean | number | string>,
  allControls: ResonatorStateControl[],
): Record<string, boolean | number | string> {
  const result = { ...nextControls }
  const controlsByKey = Object.fromEntries(allControls.map((c) => [c.key, c]))

  for (const key of Object.keys(result)) {
    if (result[key] === prevControls[key]) continue
    const control = controlsByKey[key]
    if (!control) continue
    if (control.kind === 'toggle' && result[key] === true && control.resets?.length) {
      for (const resetKey of control.resets) {
        const target = controlsByKey[resetKey]
        result[resetKey] = target
          ? getResonatorControlInactiveValue(target, {
            ...runtime,
            state: {
              ...runtime.state,
              controls: result,
            },
          })
          : false
      }
    }
  }

  for (const candidate of allControls) {
    if (!candidate.disabledWhen) continue
    if (result[candidate.disabledWhen.key] === candidate.disabledWhen.equals) {
      result[candidate.key] = getResonatorControlInactiveValue(candidate, {
        ...runtime,
        state: {
          ...runtime.state,
          controls: result,
        },
      })
    }
  }

  return normalizeResonatorRuntimeControls({
    ...runtime,
    state: {
      ...runtime.state,
      controls: result,
    },
  }, result)
}
