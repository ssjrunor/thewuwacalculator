/*
  Author: Runor Ewhro
  Description: converts condition expressions and control dependencies into
               readable disabled-reason strings for source states and
               resonator controls in the ui.
*/

import type { ConditionExpression, EvalScopeRoot, SourceStateDefinition } from '@/domain/gameData/contracts'
import { parseControlKey } from '@/domain/gameData/stateKeys'
import { getOwnerForKey, getStateForControlKey } from '@/domain/services/gameDataService'
import type { ResonatorStateControl } from '@/modules/calculator/model/resonator'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'

// friendly labels for common combat stack paths that would otherwise look too raw
const STACK_LABELS: Partial<Record<string, string>> = {
  'state.combat.spectroFrazzle': 'Spectro Frazzle',
  'state.combat.aeroErosion': 'Aero Erosion',
  'state.combat.fusionBurst': 'Fusion Burst',
  'state.combat.havocBane': 'Havoc Bane',
  'state.combat.glacioChafe': 'Glacio Chafe',
  'state.combat.electroFlare': 'Electro Flare',
  'state.combat.electroRage': 'Electro Rage',
}

// try to resolve a nice display label for a control key
// first check registered source states, then fall back to the owner label
function getControlLabel(controlKey: string): string | null {
  const state = getStateForControlKey(controlKey)
  if (state) {
    return state.label
  }

  try {
    const { ownerKey } = parseControlKey(controlKey)
    return getOwnerForKey(ownerKey)?.label ?? null
  } catch {
    return null
  }
}

// strip trailing punctuation so labels can be embedded in sentences cleanly
function normalizeLabel(label: string): string {
  return label.replace(/[?!.:]+$/g, '').trim()
}

// convert one runtime-path requirement into a readable sentence
// this handles the common condition patterns that show up in the calculator ui
function describeRuntimeRequirement(
    root: EvalScopeRoot | undefined,
    path: string,
    operator: ConditionExpression['type'],
    value?: string | number | boolean,
): string | null {
  // control-based requirements like toggles, stacks, and selectors
  if (path.startsWith('state.controls.')) {
    const controlKey = path.replace(/^state\.controls\./, '')
    const label = normalizeLabel(getControlLabel(controlKey) ?? controlKey)

    if (operator === 'truthy') {
      return `Requires ${label}.`
    }

    if (operator === 'eq') {
      if (value === true) return `Requires ${label}.`
      if (value === false) return `Requires ${label} to be disabled.`
      return `Requires ${label} to be ${value}.`
    }

    if (operator === 'neq') {
      if (value === false) return `Requires ${label}.`
      return `Requires ${label} to not be ${value}.`
    }

    if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
      const symbol = operator === 'gt' ? '>' : operator === 'gte' ? '>=' : operator === 'lt' ? '<' : '<='
      return `Requires ${label} ${symbol} ${value}.`
    }
  }

  // special-case progression requirements so they read naturally
  if (path === 'base.sequence' && (operator === 'gt' || operator === 'gte')) {
    const threshold = typeof value === 'number' ? (operator === 'gt' ? value + 1 : value) : value
    return `Requires Sequence ${threshold}.`
  }

  if (path === 'base.level' && (operator === 'gt' || operator === 'gte')) {
    const threshold = typeof value === 'number' ? (operator === 'gt' ? value + 1 : value) : value
    return `Requires Level ${threshold}.`
  }

  // combat stack requirements such as frazzle or erosion
  const stackLabel = STACK_LABELS[path]
  if (stackLabel && (operator === 'truthy' || operator === 'gt' || operator === 'gte')) {
    const threshold = operator === 'truthy'
        ? 1
        : typeof value === 'number'
            ? (operator === 'gt' ? value + 1 : value)
            : 1
    return `Requires at least ${threshold === 1 ? 'a' : threshold} stack${threshold === 1 ? '' : 's'} of ${stackLabel}.`
  }

  // team composition requirements by attribute
  if (root === 'context' && path.startsWith('team.attributeCounts.')) {
    const attribute = path.replace(/^team\.attributeCounts\./, '')
    const label = attribute.charAt(0).toUpperCase() + attribute.slice(1)

    if (operator === 'truthy') {
      return `Requires a ${label} Resonator in the team.`
    }

    if (operator === 'gt' || operator === 'gte') {
      const threshold = typeof value === 'number' ? (operator === 'gt' ? value + 1 : value) : value
      return `Requires ${threshold} ${label} Resonator${threshold === 1 ? '' : 's'} in the team.`
    }

    if (operator === 'eq') {
      return `Requires ${value} ${label} Resonator${value === 1 ? '' : 's'} in the team.`
    }
  }

  // team composition requirements by specific resonator id
  if (root === 'context' && path.startsWith('team.presenceById.')) {
    const resonatorId = path.replace(/^team\.presenceById\./, '')
    const resonatorName = getResonatorSeedById(resonatorId)?.name ?? resonatorId

    if (operator === 'truthy' || (operator === 'eq' && value === true)) {
      return `Requires ${resonatorName} in the team.`
    }
  }

  // for raw runtime paths we currently do not generate generic english descriptions
  if (root === 'sourceRuntime' || root === 'targetRuntime' || root === 'activeRuntime') {
    return null
  }

  return null
}

// recursively convert a condition tree into a readable explanation
function formatConditionReason(condition?: ConditionExpression): string | null {
  if (!condition) {
    return null
  }

  switch (condition.type) {
    case 'always':
      return null

    case 'truthy':
      return describeRuntimeRequirement(condition.from, condition.path, 'truthy')

    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return describeRuntimeRequirement(condition.from, condition.path, condition.type, condition.value)

    case 'not': {
      const inner = formatConditionReason(condition.value)
      return inner ? `Disabled while ${inner.replace(/\.$/, '').toLowerCase()}.` : null
    }

    case 'and': {
      const reasons = condition.values
          .map((entry) => formatConditionReason(entry))
          .filter((entry): entry is string => Boolean(entry))

      return reasons.length > 0 ? reasons.join(' ') : null
    }

    case 'or': {
      const reasons = condition.values
          .map((entry) => formatConditionReason(entry))
          .filter((entry): entry is string => Boolean(entry))

      return reasons.length > 0
          ? `Requires one of: ${reasons.map((entry) => entry.replace(/\.$/, '')).join(' or ')}.`
          : null
    }

    default:
      return null
  }
}

// source states can provide an explicit disabled reason;
// otherwise derive one from enabledWhen
export function getSourceStateDisabledReason(state: SourceStateDefinition): string | null {
  if (state.disabledReason) {
    return state.disabledReason
  }

  return formatConditionReason(state.enabledWhen)
}

// build a disabled reason for normal resonator controls
// priority order:
// 1. explicit disabledReason
// 2. derived enabledWhen explanation
// 3. legacy disabledWhen dependency explanation
export function getResonatorControlDisabledReason(
    control: ResonatorStateControl,
    controlsByKey: Record<string, ResonatorStateControl>,
): string | null {
  if (control.disabledReason) {
    return control.disabledReason
  }

  if (control.enabledWhen) {
    const reason = formatConditionReason(control.enabledWhen)
    if (reason) {
      return reason
    }
  }

  if (!control.disabledWhen) {
    return null
  }

  // try to resolve the dependency label from local controls first,
  // then from global state/control metadata
  const dependencyLabel = normalizeLabel(
      controlsByKey[control.disabledWhen.key]?.label ?? getControlLabel(control.disabledWhen.key) ?? control.disabledWhen.key,
  )

  if (control.disabledWhen.equals === false) {
    return `Requires ${dependencyLabel}.`
  }

  if (control.disabledWhen.equals === true) {
    return `Unavailable while ${dependencyLabel} is enabled.`
  }

  return `Requires ${dependencyLabel} to be ${String(control.disabledWhen.equals)}.`
}
