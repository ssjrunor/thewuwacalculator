/*
  Author: Runor Ewhro
  Description: Renders the render runtime state surface for the calculator optimizer flow.
*/

import type { ReactNode } from 'react'
import { readRtPath } from '@/domain/gameData/runtimePath'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SourceState } from '@/domain/gameData/contracts'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import { NumberInput } from '@/modules/calculator/features/controls/NumberInput'
import {
  isSrcSttOn,
  setSourceState,
  type RtUpdHnd,
} from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { srcSttOpts as sourceOptions } from '@/modules/calculator/model/sourceEval.ts'
import { getStateText } from '@/modules/calculator/model/sourceStateDisplay'
import { getSrcSttNct } from '@/domain/gameData/controlOptions'

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

export function viewRtStt(
  runtime: ResRuntime,
  state: SourceState,
  onUpdate: RtUpdHnd,
  options?: {
    srcRt?: ResRuntime
    tgtRt?: ResRuntime
    actRt?: ResRuntime
  },
): ReactNode {
  const srcRt = options?.srcRt ?? runtime
  const tgtRt = options?.tgtRt ?? runtime
  const actRt = options?.actRt ?? tgtRt
  const display = getStateText(state)
  const curVal = readRtPath(tgtRt, state.path)
  const isEnabled = isSrcSttOn(srcRt, tgtRt, state, actRt)
  const resolvedValue = curVal ?? getSrcSttNct(srcRt, tgtRt, state, actRt)

  if (state.kind === 'toggle') {
    const checked = toBoolean(resolvedValue, false)
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
              setSourceState(
                onUpdate,
                srcRt,
                tgtRt,
                state,
                event.target.checked,
                actRt,
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
    const stackValue = toNumber(resolvedValue, min)
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
                  setSourceState(onUpdate, srcRt, tgtRt, state, value, actRt)
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
    const selPtns = sourceOptions(srcRt, tgtRt, state, actRt)
    const selVl = String(resolvedValue)
    const isActive = toNumber(selVl, 0) > 0
    return (
      <div
        key={state.controlKey}
        className={`co-runtime-state${isActive ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
      >
        <span className="co-runtime-state__label">{display.label}</span>
        <div className="co-runtime-state__select">
          <LiquidSelect
            value={selVl}
            options={selPtns.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
            onChange={(value) => {
              setSourceState(onUpdate, srcRt, tgtRt, state, value, actRt)
            }}
            disabled={!isEnabled}
            baseClass="co-runtime-select"
            ariaLabel={display.label}
            prfrPlcm="down"
          />
        </div>
      </div>
    )
  }

  const min = state.min ?? 0
  const max = state.max
  const numericValue = toNumber(resolvedValue, min)
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
            setSourceState(onUpdate, srcRt, tgtRt, state, value, actRt)
          }}
        />
      </div>
    </div>
  )
}
