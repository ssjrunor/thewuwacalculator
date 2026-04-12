import type { ReactNode } from 'react'
import { readRuntimePath } from '@/domain/gameData/runtimePath'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { SourceStateDefinition } from '@/domain/gameData/contracts'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import { NumberInput } from '@/modules/calculator/components/workspace/panes/left/controls/NumberInput'
import {
  isSourceStateEnabled,
  setSourceStateValue,
  type RuntimeUpdateHandler,
} from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import { resolveSourceStateOptions } from '@/modules/calculator/model/sourceStateEvaluation'
import { getSourceStateDisplay } from '@/modules/calculator/model/sourceStateDisplay'

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    return value === 'true'
  }
  if (typeof value === 'number') {
    return value > 0
  }
  return fallback
}

export function renderRuntimeState(
  runtime: ResonatorRuntimeState,
  state: SourceStateDefinition,
  onUpdate: RuntimeUpdateHandler,
  options?: {
    sourceRuntime?: ResonatorRuntimeState
    targetRuntime?: ResonatorRuntimeState
    activeRuntime?: ResonatorRuntimeState
  },
): ReactNode {
  const sourceRuntime = options?.sourceRuntime ?? runtime
  const targetRuntime = options?.targetRuntime ?? runtime
  const activeRuntime = options?.activeRuntime ?? targetRuntime
  const display = getSourceStateDisplay(state)
  const currentValue = readRuntimePath(targetRuntime, state.path)
  const isEnabled = isSourceStateEnabled(sourceRuntime, targetRuntime, state, activeRuntime)

  if (state.kind === 'toggle') {
    const checked = toBoolean(currentValue ?? state.defaultValue, false)
    return (
      <div
        key={state.controlKey}
        className={`co-runtime-state${checked ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
      >
        <span className="co-runtime-state__label">{display.label}</span>
        <label className="co-runtime-state__toggle">
          <input
            type="checkbox"
            checked={checked}
            disabled={!isEnabled}
            onChange={(event) => {
              setSourceStateValue(
                onUpdate,
                sourceRuntime,
                targetRuntime,
                state,
                event.target.checked,
                activeRuntime,
              )
            }}
          />
          <span className="co-runtime-state__switch" />
        </label>
      </div>
    )
  }

  if (state.kind === 'stack') {
    const min = Math.max(0, Math.floor(state.min ?? 0))
    const defaultStack = toNumber(state.defaultValue, min)
    const max = Math.max(min, Math.floor(state.max ?? defaultStack))
    const stackValue = toNumber(currentValue ?? state.defaultValue, min)
    return (
      <div
        key={state.controlKey}
        className={`co-runtime-state${stackValue > min ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
      >
        <span className="co-runtime-state__label">{display.label}</span>
        <div className="co-runtime-state__stack">
          {Array.from({ length: max - min + 1 }, (_, offset) => {
            const value = min + offset
            return (
              <button
                key={value}
                type="button"
                className={`co-runtime-state__stack-btn${value === stackValue ? ' is-active' : ''}`}
                disabled={!isEnabled}
                onClick={() => {
                  setSourceStateValue(onUpdate, sourceRuntime, targetRuntime, state, value, activeRuntime)
                }}
              >
                {value}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  if (state.kind === 'select') {
    const selectOptions = resolveSourceStateOptions(sourceRuntime, targetRuntime, state, activeRuntime)
    const selectedValue = String(currentValue ?? state.defaultValue ?? selectOptions[0]?.id ?? '')
    const isActive = toNumber(selectedValue, 0) > 0
    return (
      <div
        key={state.controlKey}
        className={`co-runtime-state${isActive ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
      >
        <span className="co-runtime-state__label">{display.label}</span>
        <div className="co-runtime-state__select">
          <LiquidSelect
            value={selectedValue}
            options={selectOptions.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
            onChange={(value) => {
              setSourceStateValue(onUpdate, sourceRuntime, targetRuntime, state, value, activeRuntime)
            }}
            disabled={!isEnabled}
            baseClass="co-runtime-select"
            ariaLabel={display.label}
            preferredPlacement="down"
          />
        </div>
      </div>
    )
  }

  const min = state.min ?? 0
  const max = state.max
  const numericValue = toNumber(currentValue ?? state.defaultValue, min)
  return (
    <div
      key={state.controlKey}
      className={`co-runtime-state${numericValue > 0 ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
    >
      <span className="co-runtime-state__label">{display.label}</span>
      <div className="co-runtime-state__number">
        <NumberInput
          value={numericValue}
          min={min}
          max={max}
          step={0.1}
          disabled={!isEnabled}
          onChange={(value) => {
            setSourceStateValue(onUpdate, sourceRuntime, targetRuntime, state, value, activeRuntime)
          }}
        />
      </div>
    </div>
  )
}
