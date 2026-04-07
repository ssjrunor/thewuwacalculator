import type { ReactNode } from 'react'
import { readRuntimePath } from '@/domain/gameData/runtimePath'
import type { SourceStateDefinition } from '@/domain/gameData/contracts'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import { RichDescription } from '@/shared/ui/RichDescription'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import { NumberInput } from '@/modules/calculator/components/workspace/panes/left/controls/NumberInput'
import { getSourceStateDisplay } from '@/modules/calculator/model/sourceStateDisplay'
import { resolveSourceStateOptions } from '@/modules/calculator/model/sourceStateEvaluation'
import {
  isSourceStateEnabled,
  setSourceStateValue,
  setRuntimePath,
} from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import type { RuntimeUpdateHandler } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import { getSourceStateDisabledReason } from '@/modules/calculator/model/stateDisabledReason'

// renders the control for each resonator source state and wires into the runtime update helpers.
interface SourceStateControlProps {
  sourceRuntime: ResonatorRuntimeState
  targetRuntime: ResonatorRuntimeState
  state: SourceStateDefinition
  activeRuntime?: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
  teamTargetSelect?: ReactNode
  hideDescription?: boolean
  descriptionParams?: Array<string | number>
}

// renders the control for each resonator source state and wires into the runtime update helpers.

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return value === 'true'
  }

  if (typeof value === 'number') {
    return value > 0
  }

  return false
}

export function SourceStateControl({
  sourceRuntime,
  targetRuntime,
  state,
  activeRuntime = targetRuntime,
  onRuntimeUpdate,
  teamTargetSelect,
  hideDescription,
  descriptionParams,
}: SourceStateControlProps) {
  const current = readRuntimePath(targetRuntime, state.path)
  const isEnabled = isSourceStateEnabled(sourceRuntime, targetRuntime, state, activeRuntime)
  const disabledReason = !isEnabled ? getSourceStateDisabledReason(state) : null
  const display = getSourceStateDisplay(state)
  const selectOptions = state.kind === 'select'
    ? resolveSourceStateOptions(sourceRuntime, targetRuntime, state, activeRuntime)
    : []

  if (state.kind === 'toggle') {
    return (
      <div className={['stack', 'state-control-field', !isEnabled ? 'is-disabled' : ''].join(' ')}>
        {teamTargetSelect}
        <label className={['toggle-row', !isEnabled ? 'is-disabled' : ''].join(' ')}>
          <span>{display.label}</span>
          <input
            type="checkbox"
            checked={toBoolean(current ?? state.defaultValue ?? false)}
            disabled={!isEnabled}
            onChange={(event) => setSourceStateValue(onRuntimeUpdate, sourceRuntime, targetRuntime, state, event.target.checked, activeRuntime)}
          />
        </label>
        {!hideDescription && display.description ? (
          <RichDescription
            description={display.description}
            params={descriptionParams}
            unstyled={state.source.type === 'echoSet'}
          />
        ) : null}
        {disabledReason ? <div className="state-control-reason">{disabledReason}</div> : null}
      </div>
    )
  }

  if (state.kind === 'select' && selectOptions.length > 0) {
    return (
      <div className={['stack', 'state-control-field', !isEnabled ? 'is-disabled' : ''].join(' ')}>
        {teamTargetSelect}
        <label className={!isEnabled ? 'is-disabled' : undefined}>
          {display.label}
          <LiquidSelect
            value={String(current ?? state.defaultValue ?? selectOptions[0]?.id ?? '')}
            options={selectOptions.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
            disabled={!isEnabled}
            onChange={(nextValue) => setSourceStateValue(onRuntimeUpdate, sourceRuntime, targetRuntime, state, nextValue, activeRuntime)}
          />
        </label>
        {!hideDescription && display.description ? (
          <RichDescription
            description={display.description}
            params={descriptionParams}
            unstyled={state.source.type === 'echoSet'}
          />
        ) : null}
        {disabledReason ? <div className="state-control-reason">{disabledReason}</div> : null}
      </div>
    )
  }

  const min = state.min ?? 0
  const max = state.max
  const step = state.kind === 'stack' ? 1 : 0.1

  return (
    <div className={['stack', 'state-control-field', !isEnabled ? 'is-disabled' : ''].join(' ')}>
      {teamTargetSelect}
      <label className={!isEnabled ? 'is-disabled' : undefined}>
        {display.label}
        <NumberInput
          value={toNumber(current ?? state.defaultValue ?? 0)}
          min={min}
          max={max}
          step={step}
          disabled={!isEnabled}
          onChange={(value) => setRuntimePath(onRuntimeUpdate, state.path, value)}
        />
      </label>
      {!hideDescription && display.description ? (
        <RichDescription
          description={display.description}
          params={descriptionParams}
          unstyled={state.source.type === 'echoSet'}
        />
      ) : null}
      {disabledReason ? <div className="state-control-reason">{disabledReason}</div> : null}
    </div>
  )
}
