/*
  Author: Runor Ewhro
  Description: Renders the source state control surface for the calculator controls flow.
*/

import type { ReactNode } from 'react'
import { readRtPath } from '@/domain/gameData/runtimePath.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { NumberInput } from '@/modules/calculator/features/controls/NumberInput.tsx'
import { getStateText } from '@/modules/calculator/model/sourceStateDisplay.ts'
import { resolveSourceStateOptions as sourceOptions } from '@/modules/calculator/model/sourceEval.ts'
import {
  isSrcSttOn,
  setSourceState,
  setRtPath,
} from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import type { RtUpdHnd } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { getSrcSttDsb } from '@/modules/calculator/model/stateDisabledReason.ts'

// renders the control for each resonator source state and wires into the runtime update helpers.
interface SrcSttCntrPr {
  srcRt: ResRuntime
  tgtRt: ResRuntime
  state: SourceState
  actRt?: ResRuntime
  onRtPdt: RtUpdHnd
  teamTgtSlct?: ReactNode
  hideDscr?: boolean
  dscrPrms?: Array<string | number>
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

export function SourceStateCtrl({
  srcRt: srcRt,
  tgtRt: trgtRt,
  state,
  actRt: actRt = trgtRt,
  onRtPdt: onRtPdt,
  teamTgtSlct: teamTrgtSlct,
  hideDscr: hideDscr,
  dscrPrms: dscrPrms,
}: SrcSttCntrPr) {
  const current = readRtPath(trgtRt, state.path)
  const isEnabled = isSrcSttOn(srcRt, trgtRt, state, actRt)
  const dsblRsn = !isEnabled ? getSrcSttDsb(state) : null
  const display = getStateText(state)
  const selPtns = state.kind === 'select'
    ? sourceOptions(srcRt, trgtRt, state, actRt)
    : []

  if (state.kind === 'toggle') {
    const checked = toBoolean(current ?? state.defaultValue ?? false)
    return (
      <div className={['stack', 'state-control-field', !isEnabled ? 'is-disabled' : ''].join(' ')}>
        {teamTrgtSlct}
        <label className={['toggle-row', checked ? 'is-active' : '', !isEnabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
          <span>{display.label}</span>
          <input
            type="checkbox"
            checked={checked}
            disabled={!isEnabled}
            onChange={(event) => setSourceState(onRtPdt, srcRt, trgtRt, state, event.target.checked, actRt)}
          />
        </label>
        {!hideDscr && display.description ? (
          <RichDscr
            description={display.description}
            params={dscrPrms}
            unstyled={state.source.type === 'echoSet'}
          />
        ) : null}
        {dsblRsn ? <div className="state-control-reason">{dsblRsn}</div> : null}
      </div>
    )
  }

  if (state.kind === 'select' && selPtns.length > 0) {
    const selVl = String(current ?? state.defaultValue ?? selPtns[0]?.id ?? '')
    const isActive = toNumber(selVl) > 0
    return (
      <div className={['stack', 'state-control-field', !isEnabled ? 'is-disabled' : ''].join(' ')}>
        {teamTrgtSlct}
        <label className={[isActive ? 'is-active' : '', !isEnabled ? 'is-disabled' : ''].filter(Boolean).join(' ') || undefined}>
          {display.label}
          <LiquidSelect
            value={selVl}
            options={selPtns.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
            disabled={!isEnabled}
            onChange={(nextValue) => setSourceState(onRtPdt, srcRt, trgtRt, state, nextValue, actRt)}
          />
        </label>
        {!hideDscr && display.description ? (
          <RichDscr
            description={display.description}
            params={dscrPrms}
            unstyled={state.source.type === 'echoSet'}
          />
        ) : null}
        {dsblRsn ? <div className="state-control-reason">{dsblRsn}</div> : null}
      </div>
    )
  }

  const min = state.min ?? 0
  const max = state.max
  const step = state.kind === 'stack' ? 1 : 0.1
  const numericValue = toNumber(current ?? state.defaultValue ?? 0)
  const isActive = numericValue > min

  return (
    <div className={['stack', 'state-control-field', !isEnabled ? 'is-disabled' : ''].join(' ')}>
      {teamTrgtSlct}
      <label className={[isActive ? 'is-active' : '', !isEnabled ? 'is-disabled' : ''].filter(Boolean).join(' ') || undefined}>
        {display.label}
        <NumberInput
          value={numericValue}
          min={min}
          max={max}
          step={step}
          disabled={!isEnabled}
          onChange={(value) => setRtPath(onRtPdt, state.path, value)}
        />
      </label>
      {!hideDscr && display.description ? (
        <RichDscr
          description={display.description}
          params={dscrPrms}
          unstyled={state.source.type === 'echoSet'}
        />
      ) : null}
      {dsblRsn ? <div className="state-control-reason">{dsblRsn}</div> : null}
    </div>
  )
}
