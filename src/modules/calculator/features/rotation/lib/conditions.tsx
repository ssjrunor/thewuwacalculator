/*
  Author: Runor Ewhro
  Description: Defines the editable condition rows and choice builders used by
               rotation condition nodes and when-rule editors.
*/

import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { fmtRtChng } from '@/shared/lib/formatGameData.ts'
import { getStateText } from '@/modules/calculator/model/sourceStateDisplay.ts'
import { getWpnById } from '@/domain/services/weaponCatalogService.ts'
import { resPssvPrms } from '@/modules/calculator/features/weapons/lib/weapon.ts'
import type { CondExpr, RotationNode, RtChng, SourceState } from '@/domain/gameData/contracts.ts'
import type { CondChoice, CondAction, FeatCondDrft, RotCondBldrP, RotCondVl, RotMemEnt } from './types.ts'

export function makeCondValue(definition: SourceState): RotCondVl {
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

export function viewCondVlFl(
  definition: SourceState,
  value: RotCondVl,
  onChange: (value: RotCondVl) => void,
) {
  // render by state kind so the editor cannot submit impossible values for toggles, selects, stacks, or numeric states.
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

  return (
    <input
      type="number"
      min={definition.min ?? 0}
      max={definition.max}
      step={definition.kind === 'stack' ? 1 : 0.1}
      className="resonator-level-input"
      value={typeof value === 'number' ? value : Number(value) || 0}
      onChange={(event) => {
        const raw = Number(event.target.value)
        onChange(definition.kind === 'stack' ? Math.floor(raw || 0) : raw || 0)
      }}
    />
  )
}

export function fmtSttVl(
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

export function fmtCondChng(change: RtChng, choice?: CondChoice | null): string {
  // fall back to the raw formatter when catalog choices disappear, keeping orphaned rotation nodes readable.
  if (!choice) {
    return fmtRtChng(change)
  }

  if (change.type === 'set') {
    if (typeof change.value === 'number' && !Number.isNaN(change.value)) {
      return choice.state.kind === 'stack'
        ? `${choice.label} at ${fmtSttVl(choice.state, change.value)} stack${(change.value ?? 0) !== 1 ? 's' : ''}`
        : `Set ${choice.label} to ${fmtSttVl(choice.state, change.value)}`
    }
    if (typeof change.value === 'boolean') {
      return `${choice.label} ${change.value ? 'active' : 'inactive'}`
    }
    return `Let ${choice.label} be ${fmtSttVl(choice.state, change.value)}`
  }

  if (change.type === 'add') {
    return `${choice.label} + ${String(change.value)}`
  }

  return `${choice.label} = ${fmtSttVl(choice.state, change.value ?? true)}`
}

function flttWhenCond(condition: CondExpr | undefined): CondExpr[] {
  if (!condition || condition.type === 'always') {
    return []
  }

  // chips flatten `and` conditions for compact display, while `or` and `not` are formatted by the caller.
  if (condition.type === 'and') {
    return condition.values.flatMap(flttWhenCond)
  }

  return [condition]
}

function fmtWhenCondS(choice: CondChoice | null, condition: Extract<CondExpr, { path: string }>): string {
  if (!choice) {
    return condition.path
  }

  if (choice.changeTarget === 'rotation') {
    return choice.label
  }

  const owner = choice.sourceName || choice.resName
  if (!owner || choice.label === owner || choice.label.startsWith(`${owner} `)) {
    return choice.label
  }

  return `${owner}'s ${choice.label}`
}

function fmtWhenCondV(
  value: string | number | boolean | undefined,
  choice: CondChoice | null,
): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  return choice ? fmtSttVl(choice.state, value) : String(value ?? '')
}

function getWhenCondP(type: CondExpr['type']): string {
  switch (type) {
    case 'eq':
    case 'truthy':
      return '='
    case 'neq':
      return '!='
    case 'gt':
      return '>'
    case 'gte':
      return '>='
    case 'lt':
      return '<'
    case 'lte':
      return '<='
    case 'includes':
      return 'has'
    default:
      return type
  }
}

function findCondChcF(
  choices: CondChoice[],
  condition: Extract<CondExpr, { path: string }>,
): CondChoice | null {
  return choices.find((choice) => choice.state.path === condition.path) ?? null
}

export function fmtWhenCondL(
  condition: CondExpr | undefined,
  choices: CondChoice[],
): string[] {
  // when chips are display-only labels, so unsupported expressions degrade to their expression type instead of blocking
  // the rotation row.
  return flttWhenCond(condition).map((entry) => {
    if (entry.type === 'not') {
      return `not ${fmtWhenCondL(entry.value, choices).join(' and ')}`
    }

    if (entry.type === 'or') {
      return entry.values
        .flatMap((value) => fmtWhenCondL(value, choices))
        .join(' or ')
    }

    if (!('path' in entry)) {
      return entry.type
    }

    const choice = findCondChcF(choices, entry)
    const subject = fmtWhenCondS(choice, entry)
    const value = entry.type === 'truthy' ? true : 'value' in entry ? entry.value : true
    return `${subject} ${getWhenCondP(entry.type)} ${fmtWhenCondV(value, choice)}`
  }).filter(Boolean)
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

export function normFeatCond(
  action: CondAction,
  choice: CondChoice | null | undefined,
): CondAction {
  // non-numeric states cannot be incremented, so stale "add" drafts are coerced back to set before serialization.
  return action === 'add' && choice && !isNmrcCondSt(choice.state) ? 'set' : action
}

export function mkFeatCondDr(
  choice: CondChoice | undefined,
  action: CondAction = 'set',
  makeNodeId: (prefix: string) => string,
): FeatCondDrft {
  const nrmlCtn = normFeatCond(action, choice)
  return {
    id: makeNodeId('rotation:feature-condition'),
    action: nrmlCtn,
    choiceId: choice?.id ?? '',
    value: nrmlCtn === 'add' ? 1 : choice ? makeCondValue(choice.state) : true,
  }
}

export function makeFeatCond(
  change: RtChng,
  choices: CondChoice[],
  makeNodeId: (prefix: string) => string,
  fallbackResId?: string,
): FeatCondDrft {
  const choice = getCondChoice(choices, change, fallbackResId)
  const action = normFeatCond(change.type === 'add' ? 'add' : 'set', choice)

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
  rows: FeatCondDrft[],
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
      const change: RtChng = {
        type: 'add',
        path: choice.state.path,
        value: Number.isFinite(value) ? value : 0,
      }
      if (!choice.changeTarget || choice.changeTarget === 'runtime') {
        change.resonatorId = choice.resonatorId
      }
      changes.push(change)
      return changes
    }

    const change: RtChng = {
      type: 'set',
      path: choice.state.path,
      value: row.value,
    }
    if (!choice.changeTarget || choice.changeTarget === 'runtime') {
      change.resonatorId = choice.resonatorId
    }
    changes.push(change)
    return changes
  }, [])
}

export function mkRotCondNod(
  change: RtChng,
  choices: CondChoice[],
  makeNodeId: (prefix: string) => string,
  options: RotCondBldrP = {},
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

export function fmtCondChcLb(choice: CondChoice): string {
  if (choice.changeTarget === 'rotation') {
    return choice.label
  }

  if (!choice.sourceName || choice.label === choice.sourceName || choice.label.startsWith(`${choice.sourceName} `)) {
    return choice.label
  }

  return `${choice.sourceName} · ${choice.label}`
}

export function mkCondChc(
  member: Pick<RotMemEnt, 'id' | 'name' | 'runtime'>,
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
    label: options?.label ?? display.label,
    description: options?.description ?? display.description,
    dscrPrms: options?.dscrPrms ?? wpnDscrPrms,
    state,
    changeTarget: options?.changeTarget,
  }
}

export function prsPtnlNtgrN(rawValue: string, minimum: number): number | null {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return null
  }

  const value = Number(trimmed)
  if (!Number.isFinite(value)) {
    return null
  }

  return Math.max(minimum, Math.floor(value))
}
