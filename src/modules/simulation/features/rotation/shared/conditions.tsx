/*
  Author: Runor Ewhro
  Description: defines the editable condition rows and choice builders used by
               rotation condition nodes and when-rule editors.
*/

import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import {
  formatEffectConditionName,
  getStateEffectName,
  getStateText,
} from '@/modules/simulation/model/sourceStateDisplay.ts'
import { getWpnById } from '@/domain/services/weaponCatalogService.ts'
import { resPssvPrms } from '@/modules/simulation/features/weapons/lib/weapon.ts'
import type { RotationNode, RtChng, SourceState } from '@/domain/gameData/contracts.ts'
import type {
  CondAction,
  CondChoice,
  FeatureConditionDraft,
  RotationConditionOptions,
  RotationConditionValue,
  RotationMember,
} from './authoringTypes.ts'

export const ROT_FORMULA_OWNER_KEY = 'rotation:formula'

export function isFormulaChoice(choice: CondChoice | null | undefined): boolean {
  return choice?.state.ownerKey === ROT_FORMULA_OWNER_KEY
}
import { NumberInput } from '@/modules/simulation/features/controls/NumberInput.tsx'

export function makeCondValue(definition: SourceState): RotationConditionValue {
  // default values from game data win; otherwise choose the smallest value that makes the condition meaningful.
  if (definition.defaultValue !== undefined) {
    return definition.defaultValue
  }

  if (definition.kind === 'toggle') {
    return true
  }

  if (definition.kind === 'select') {
    return definition.options?.[0]?.id ?? ''
  }

  return Math.max(definition.min ?? 0, definition.kind === 'stack' ? 1 : 0)
}

/** A state sitting at its zero: switched off, empty, or holding nothing. */
export function isCondValueOff(value: RotationConditionValue | undefined): boolean {
  if (value === undefined || value === false) {
    return true
  }

  if (typeof value === 'number') {
    return !Number.isFinite(value) || value === 0
  }

  if (typeof value === 'string') {
    return value === '' || value === 'off' || value === 'none'
  }

  return false
}

export function seedCondValue(
  definition: SourceState,
  standing: RotationConditionValue | undefined,
  maxValue?: RotationConditionValue,
): RotationConditionValue {
  if (standing !== undefined && !isCondValueOff(standing)) {
    return isNmrcCondSt(definition) ? standing : makeCondValue(definition)
  }

  if (definition.kind === 'toggle') {
    return typeof maxValue === 'boolean' ? maxValue : true
  }

  if (definition.kind === 'select') {
    const options = definition.options ?? []
    return maxValue !== undefined
      && (options.length === 0 || options.some((option) => option.id === String(maxValue)))
      ? String(maxValue)
      : makeCondValue(definition)
  }

  const min = definition.min ?? 0
  const max = Number(maxValue ?? definition.max ?? definition.maxValue)
  return Number.isFinite(max) && max > min ? max : makeCondValue(definition)
}

export function cycleCondValue(
  definition: SourceState,
  standing: RotationConditionValue | undefined,
): RotationConditionValue {
  const options = definition.options ?? []
  if (options.length === 0) {
    return makeCondValue(definition)
  }

  const index = options.findIndex((option) => option.id === String(standing ?? ''))
  const from = index < 0 ? 0 : index
  return options[(from - 1 + options.length) % options.length]?.id
    ?? makeCondValue(definition)
}

export function viewCondVlFl(
  definition: SourceState,
  value: RotationConditionValue,
  onChange: (value: RotationConditionValue) => void,
) {
  if (definition.kind === 'toggle') {
    const checked = value === true

    return (
      <div className="feature-condition-boolean-stack" role="group" aria-label={`${definition.label} value`}>
        <button
          type="button"
          className={`feature-condition-boolean-stack__btn${checked ? ' is-active' : ''}`}
          aria-pressed={checked}
          onClick={() => onChange(true)}
        >
          True
        </button>
        <button
          type="button"
          className={`feature-condition-boolean-stack__btn${!checked ? ' is-active' : ''}`}
          aria-pressed={!checked}
          onClick={() => onChange(false)}
        >
          False
        </button>
      </div>
    )
  }

  if (definition.kind === 'select') {
    return (
      <LiquidSelect
        value={String(value)}
        options={(definition.options ?? []).map((option) => ({
          value: option.id,
          label: option.label,
        }))}
        onChange={(nextValue) => onChange(nextValue)}
        ariaLabel={`${definition.label} value`}
      />
    )
  }

  const min = definition.kind === 'stack' ? definition.min ?? 0 : definition.min

  return (
    <NumberInput
      min={min}
      max={definition.max}
      step={definition.kind === 'stack' ? 1 : 0.1}
      value={typeof value === 'number' ? value : Number(value) || 0}
      onChange={(nextValue) => {
        onChange(definition.kind === 'stack' ? Math.max(min ?? 0, Math.floor(nextValue)) : nextValue)
      }}
    />
  )
}

export function formatStateValue(
  definition: SourceState,
  value: string | number | boolean | undefined,
): string {
  if (definition.kind === 'toggle') {
    return value === true ? 'True' : 'False'
  }

  if (definition.kind === 'select') {
    return definition.options?.find((option) => option.id === value)?.label ?? String(value ?? '')
  }

  return String(value ?? '')
}

export function getCondChoice(
  choices: CondChoice[],
  change: RtChng | undefined,
  fallbackResId?: string,
): CondChoice | null {
  if (!change) {
    return null
  }

  // enemy and rotation-level changes are globally scoped, while resonator changes need the owning resonator id to
  // avoid matching a teammate state with the same path.
  return choices.find((choice) => {
    if (choice.changeTarget === 'enemy' || choice.changeTarget === 'rotation') {
      return choice.state.path === change.path
    }

    return choice.resonatorId === (change.resonatorId ?? fallbackResId)
      && choice.state.path === change.path
  }) ?? null
}

export function isNmrcCondSt(state: SourceState): boolean {
  return state.kind === 'stack' || state.kind === 'number'
}

export function condActionFromChange(change: RtChng | undefined): CondAction | undefined {
  return change?.type === 'add'
    ? 'add'
    : change?.type === 'set'
      ? 'set'
      : undefined
}

export function normFeatCond(
  action: CondAction,
  choice: CondChoice | null | undefined,
): CondAction {
  // non-numeric states cannot be incremented, so stale "add" drafts are coerced back to set before serialization.
  return action === 'add' && choice && !isNmrcCondSt(choice.state) ? 'set' : action
}

export function makeCondChange(
  choice: CondChoice,
  action: 'add',
  value: number,
): Extract<RtChng, { type: 'add' }>
export function makeCondChange(
  choice: CondChoice,
  action: 'set',
  value: RotationConditionValue,
): Extract<RtChng, { type: 'set' }>
export function makeCondChange(
  choice: CondChoice,
  action: CondAction,
  value: RotationConditionValue,
): RtChng {
  const change: RtChng = action === 'add'
    ? { type: 'add', path: choice.state.path, value: Number(value) }
    : { type: 'set', path: choice.state.path, value }
  if (!choice.changeTarget || choice.changeTarget === 'runtime') {
    change.resonatorId = choice.resonatorId
  }
  return change
}

export function makeFeatureDraft(
  choice: CondChoice | undefined,
  action: CondAction = 'set',
  makeNodeId: (prefix: string) => string,
  /** value read from where the state stands where this directive runs */
  seedValue?: RotationConditionValue,
): FeatureConditionDraft {
  const nrmlCtn = normFeatCond(action, choice)
  return {
    id: makeNodeId('rotation:feature-condition'),
    action: nrmlCtn,
    choiceId: choice?.id ?? '',
    value: nrmlCtn === 'add'
      ? 1
      : seedValue ?? (choice ? makeCondValue(choice.state) : true),
  }
}

export function makeFeatCond(
  change: RtChng,
  choices: CondChoice[],
  makeNodeId: (prefix: string) => string,
  fallbackResId?: string,
): FeatureConditionDraft {
  const choice = getCondChoice(choices, change, fallbackResId)
  const action = normFeatCond(condActionFromChange(change) ?? 'set', choice)

  return {
    id: makeNodeId('rotation:feature-condition'),
    action,
    choiceId: choice?.id ?? '',
    value: action === 'add'
      ? typeof change.value === 'number'
        ? change.value
        : 1
      : change.type === 'toggle'
        ? (change.value ?? true)
        : change.value,
  }
}

export function serFeatCondD(
  rows: FeatureConditionDraft[],
  choices: CondChoice[],
): RtChng[] {
  // rows without a current catalog choice are dropped because serializing them would create uneditable runtime paths.
  return rows.reduce<RtChng[]>((changes, row) => {
    const choice = choices.find((entry) => entry.id === row.choiceId)
    if (!choice) {
      return changes
    }

    const action = normFeatCond(row.action, choice)
    if (action === 'add') {
      const value = Number(row.value)
      changes.push(makeCondChange(
        choice,
        'add',
        Number.isFinite(value) ? value : 0,
      ))
      return changes
    }

    changes.push(makeCondChange(choice, 'set', row.value))
    return changes
  }, [])
}

export function makeRawCondition(
  change: RtChng,
  choices: CondChoice[],
  makeNodeId: (prefix: string) => string,
  options: RotationConditionOptions = {},
): Extract<RotationNode, { type: 'condition' }> {
  const choice = getCondChoice(choices, change, options.fallbackResId)

  return {
    id: options.id ?? makeNodeId('rotation:condition'),
    type: 'condition',
    resonatorId:
      choice?.changeTarget === 'rotation'
        ? undefined
        : change.resonatorId
          ?? (choice && (!choice.changeTarget || choice.changeTarget === 'runtime') ? choice.resonatorId : undefined)
          ?? options.fallbackResId,
    label: choice?.label,
    enabled: options.enabled ?? true,
    changes: [change],
  }
}

export function conditionChoiceLabel(choice: CondChoice): string {
  if (choice.changeTarget === 'rotation') {
    return choice.label
  }

  // The source heading is useful for grouping, but a condition's name should
  // identify the effect/passive rather than the weapon item that owns it.
  return formatEffectConditionName(choice.effectName ?? choice.sourceName, choice.label)
}

export function buildConditionChoices(
  member: Pick<RotationMember, 'id' | 'name' | 'runtime'>,
  state: SourceState,
  options?: {
    id?: string
    label?: string
    description?: string
    dscrPrms?: Array<string | number>
    changeTarget?: 'runtime' | 'enemy' | 'rotation'
  },
): CondChoice {
  const display = getStateText(state)
  const wpnDscrPrms =
    state.source.type === 'weapon'
      ? (() => {
          const weapon = getWpnById(state.source.id)
          return weapon ? resPssvPrms(weapon.passive.params, member.runtime.build.weapon.rank) : undefined
        })()
      : undefined

  return {
    id: options?.id ?? `${member.id}:${state.controlKey}`,
    resonatorId: member.id,
    resName: member.name,
    sourceName: display.sourceName ?? member.name,
    effectName: state.source.type === 'weapon' || state.source.type === 'echoSet'
      ? getStateEffectName(state)
      : undefined,
    label: options?.label ?? display.label,
    description: options?.description ?? display.description,
    dscrPrms: options?.dscrPrms ?? wpnDscrPrms,
    state,
    changeTarget: options?.changeTarget,
  }
}
