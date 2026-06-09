/*
  Author: Runor Ewhro
  Description: Renders the source state control surface for the calculator controls flow.
*/

import type { ReactNode } from 'react'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore.ts'
import { readRtPath } from '@/domain/gameData/runtimePath.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { ResModeGroup } from '@/domain/entities/resonator.ts'
import { getResModeGroups } from '@/domain/gameData/resonatorStateGraph.ts'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { NumberInput } from '@/modules/calculator/features/controls/NumberInput.tsx'
import { getStateText } from '@/modules/calculator/model/sourceStateDisplay.ts'
import { srcSttOpts as sourceOptions } from '@/modules/calculator/model/sourceEval.ts'
import {
  isSrcSttOn,
  setSourceState,
  setRtPath,
} from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import type { RtUpdHnd } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { getSrcSttDsb } from '@/modules/calculator/model/stateDisabledReason.ts'
import { getSrcSttNct } from '@/domain/gameData/controlOptions.ts'
import { srcSttNumMax } from '@/domain/state/sourceStateInit.ts'

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

function getModeGroup(state: SourceState): ResModeGroup | undefined {
  if (state.source.type !== 'resonator') {
    return undefined
  }

  const details = getResDtlsBy()[state.source.id]
  return getResModeGroups(details).find((group) => group.controlKey === state.controlKey)
}

function modeInitial(label: string): string {
  return label.trim().slice(0, 1).toUpperCase() || 'M'
}

function mergeKeywords(...lists: Array<string[] | undefined>): string[] {
  return Array.from(new Set(lists.flatMap((list) => list ?? [])))
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
  const resolvedValue = current ?? getSrcSttNct(srcRt, trgtRt, state, actRt)
  const modeGroup = state.kind === 'select' ? getModeGroup(state) : undefined

  if (state.kind === 'toggle') {
    const checked = toBoolean(resolvedValue)
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

  if (modeGroup) {
    const modeValue = String(resolvedValue ?? modeGroup.defaultValue)
    const hasNone = modeGroup.modes.some((mode) => mode.id === 'none')
    const modeItems = modeGroup.modes.filter((mode) => mode.id !== 'none')
    const noMode = hasNone && modeValue === 'none'
    const setMode = (value: string) => {
      if (!isEnabled) {
        return
      }

      setSourceState(onRtPdt, srcRt, trgtRt, state, value, actRt)
    }

    return (
      <div className={['stack', 'state-control-field', 'res-mode-source-field', !isEnabled ? 'is-disabled' : '', noMode ? 'is-empty' : ''].filter(Boolean).join(' ')}>
        {teamTrgtSlct}
        <div className="res-mode-panel res-mode-panel--source">
          <div className="res-mode-top">
            <h4>{modeGroup.label || display.label}</h4>
            {hasNone ? (
              <button
                type="button"
                className={['res-mode-clear', noMode ? 'is-active' : ''].filter(Boolean).join(' ')}
                aria-pressed={noMode}
                disabled={!isEnabled}
                onClick={() => setMode('none')}
              >
                {noMode ? 'No mode' : 'Clear'}
              </button>
            ) : null}
          </div>
          <div className="res-mode-list" role="radiogroup" aria-label={modeGroup.label || display.label}>
            {noMode ? <p className="res-mode-empty">No resonance mode selected.</p> : null}
            {modeItems.map((mode) => {
              const active = mode.id === modeValue

              return (
                <button
                  key={`${modeGroup.id}-${mode.id}`}
                  type="button"
                  className={[
                    'res-mode-entry',
                    mode.icon ? 'has-icon' : 'no-icon',
                    active ? 'is-active' : 'is-compact',
                  ].filter(Boolean).join(' ')}
                  role="radio"
                  aria-checked={active}
                  disabled={!isEnabled}
                  onClick={() => setMode(mode.id)}
                >
                  <span className="res-mode-glyph" aria-hidden="true">
                    {mode.icon ? (
                      <img src={mode.icon} alt="" onError={withDefIconM} />
                    ) : (
                      <span>{modeInitial(mode.label)}</span>
                    )}
                  </span>
                  <div className="res-mode-copy">
                    <div className="res-mode-name">
                      <span>{mode.label}</span>
                      {active ? <span className="res-mode-now">Active</span> : null}
                    </div>
                    {active && mode.body && !hideDscr ? (
                      <RichDscr
                        description={mode.body}
                        className="res-mode-body"
                        xtrKywr={mergeKeywords(mode.keywords)}
                      />
                    ) : null}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
        {dsblRsn ? <div className="state-control-reason">{dsblRsn}</div> : null}
      </div>
    )
  }

  if (state.kind === 'select' && selPtns.length > 0) {
    const selVl = String(resolvedValue)
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
  const max = srcSttNumMax(srcRt, trgtRt, state, actRt)
  const step = state.kind === 'stack' ? 1 : 0.1
  const numericValue = toNumber(resolvedValue)
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
