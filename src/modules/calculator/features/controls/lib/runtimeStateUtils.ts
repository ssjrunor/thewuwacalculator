/*
  Author: Runor Ewhro
  Description: Provides shared runtime state utils helpers for the controls surface.
*/

import type { SyntheticEvent as SyntVnt } from 'react'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { ResStateControl } from '@/domain/entities/resonator.ts'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore.ts'
import {
  getResCntrNc,
  getSrcSttNct,
  normResRtCnt,
} from '@/domain/gameData/controlOptions.ts'
import { writeRtPath } from '@/domain/gameData/runtimePath.ts'
import type { CondExpr, EffectDef, FormExpr, SourceState } from '@/domain/gameData/contracts.ts'
import { getResonator } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { listFfctForO, listStatesFor } from '@/domain/services/gameDataService.ts'
import {
  evalSrcSttOn,
  evalSourceState,
} from '@/modules/calculator/model/sourceEval.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

// shared helpers that keep runtime controls in sync across left pane panes and modals.
export type RtUpdHnd = (
  updater: (runtime: ResRuntime) => ResRuntime,
) => void

export function withDefResMg(event: SyntVnt<HTMLImageElement>) {
  withDefIconM(event)
}

export function setRtPath(
  onRtUpd: RtUpdHnd,
  path: string,
  value: string | number | boolean,
): void {
  onRtUpd((prev) => writeRtPath(prev, path, value))
}

export function setSourceState(
  onRtUpd: RtUpdHnd,
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  value: string | number | boolean,
  actRt: ResRuntime = tgtRt,
): void {
  onRtUpd((prev) => {
    let nextRuntime = writeRtPath(prev, state.path, value)

    if (state.kind === 'toggle' && value === true && state.resets?.length) {
      const allStates = listStatesFor(state.source.type, state.source.id)
      const scpdTgtRt = nextRuntime
      const scpdSrcRt = srcRt.id === tgtRt.id ? scpdTgtRt : srcRt
      const scpdActRt = actRt.id === tgtRt.id ? scpdTgtRt : actRt

      for (const rstCntrKey of state.resets) {
        const resetState = allStates.find((candidate) => candidate.controlKey === rstCntrKey)
        if (!resetState) {
          nextRuntime = writeRtPath(nextRuntime, `state.controls.${rstCntrKey}`, false)
          continue
        }

        nextRuntime = writeRtPath(
          nextRuntime,
          resetState.path,
          getSrcSttNct(scpdSrcRt, scpdTgtRt, resetState, scpdActRt),
        )
      }
    }

    return nextRuntime
  })
}

export function isSourceVisible(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): boolean {
  return evalSourceState(srcRt, tgtRt, state, actRt)
}

export function isSrcSttOn(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): boolean {
  return evalSrcSttOn(srcRt, tgtRt, state, actRt)
}

const CNTR_PRFX = 'state.controls.'

function condRfrnCntr(condition: CondExpr | undefined, controlKey: string): boolean {
  if (!condition) return false
  if ('path' in condition) {
    return condition.path === `${CNTR_PRFX}${controlKey}`
  }
  if (condition.type === 'and' || condition.type === 'or') {
    return condition.values.some((v) => condRfrnCntr(v, controlKey))
  }
  if (condition.type === 'not') {
    return condRfrnCntr(condition.value, controlKey)
  }
  return false
}

function formRfrnCntr(formula: FormExpr, controlKey: string): boolean {
  if ('path' in formula) {
    return formula.path === `${CNTR_PRFX}${controlKey}`
  }
  if ('values' in formula) {
    return formula.values.some((v) => formRfrnCntr(v, controlKey))
  }
  if ('value' in formula && typeof formula.value === 'object') {
    return formRfrnCntr(formula.value, controlKey)
  }
  return false
}

function ffctRfrnStt(effect: EffectDef, controlKey: string): boolean {
  if (condRfrnCntr(effect.condition, controlKey)) return true
  return effect.operations.some((op) => op.type !== 'add_immunity' && formRfrnCntr(op.value, controlKey))
}

function negFfctSrcRf(
  state: SourceState,
): boolean {
  if (state.source.type !== 'resonator') {
    return false
  }

  const negFfctSrcs = getResDtlsBy()[state.source.id]?.negativeEffectSources ?? []
  return negFfctSrcs.some((source) => condRfrnCntr(source.enabledWhen, state.controlKey))
}

export function getSttFfctTg(
  state: SourceState,
): Array<NonNullable<EffectDef['targetScope']> | 'self'> {
  const scopes = new Set<NonNullable<EffectDef['targetScope']> | 'self'>()

  for (const effect of listFfctForO(state.ownerKey)) {
    if (!ffctRfrnStt(effect, state.controlKey)) {
      continue
    }

    scopes.add(effect.targetScope ?? 'self')
  }

  if (negFfctSrcRf(state)) {
    scopes.add('teamWide')
  }

  return Array.from(scopes)
}

export function cllcSrcSttDp(
  states: SourceState[],
  shldNcldStt: (state: SourceState) => boolean,
): Set<string> {
  const sttsByCntrKe = new Map(states.map((state) => [state.controlKey, state]))
  const included = new Set<string>()

  function includeState(controlKey: string) {
    if (included.has(controlKey)) {
      return
    }

    const state = sttsByCntrKe.get(controlKey)
    if (!state) {
      return
    }

    included.add(controlKey)

    for (const dependency of state.controlDependencies ?? []) {
      includeState(dependency)
    }
  }

  for (const state of states) {
    if (shldNcldStt(state)) {
      includeState(state.controlKey)
    }
  }

  return included
}

export function fltrSrcSttsW(
  states: SourceState[],
  shldNcldStt: (state: SourceState) => boolean,
  shldViewStt: (state: SourceState) => boolean,
): SourceState[] {
  const ncldCntrKeys = cllcSrcSttDp(states, shldNcldStt)

  return states.filter((state) =>
    ncldCntrKeys.has(state.controlKey)
    && shldViewStt(state),
  )
}

export function sttHasTeamFc(
  state: SourceState,
  options: { ncldTeamWide: boolean },
): boolean {
  const hasTeamFcngF = getSttFfctTg(state).some((targetScope) => {
    if (
      targetScope === 'active'
      || targetScope === 'activeOther'
      || targetScope === 'otherTeammates'
    ) {
      return true
    }

    return options.ncldTeamWide && targetScope === 'teamWide'
  })

  if (hasTeamFcngF) {
    return true
  }

  return negFfctSrcRf(state)
}

export function getStateTeamTag(state: SourceState): 'active' | 'activeOther' | null {
  const effects = getSttFfctTg(state)

  if (effects.some((effect) => effect === 'active')) {
    return 'active'
  }

  if (effects.some((effect) => effect === 'activeOther')) {
    return 'activeOther'
  }

  return null
}

export function getTeamTgtPt(
  teamRuntime: ResRuntime,
  ownRtId: string,
  mode: 'active' | 'activeOther',
) {
  const memberIds = Array.from(
    new Set([teamRuntime.id, ...teamRuntime.build.team.filter((memberId): memberId is string => Boolean(memberId))]),
  )

  const eligibleIds = mode === 'activeOther'
    ? memberIds.filter((memberId) => memberId !== ownRtId)
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

export function getCntrNctvV(
  control: ResStateControl,
  runtime?: ResRuntime,
): boolean | number {
  return getResCntrNc(control, runtime)
}

export function applyCscdRst(
  runtime: ResRuntime,
  prevControls: Record<string, boolean | number | string>,
  nextControls: Record<string, boolean | number | string>,
  allControls: ResStateControl[],
): Record<string, boolean | number | string> {
  const result = { ...nextControls }
  const cntrByKey = Object.fromEntries(allControls.map((c) => [c.key, c]))

  for (const key of Object.keys(result)) {
    if (result[key] === prevControls[key]) continue
    const control = cntrByKey[key]
    if (!control) continue
    if (control.kind === 'toggle' && result[key] === true && control.resets?.length) {
      for (const resetKey of control.resets) {
        const target = cntrByKey[resetKey]
        result[resetKey] = target
          ? getResCntrNc(target, {
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
      result[candidate.key] = getResCntrNc(candidate, {
        ...runtime,
        state: {
          ...runtime.state,
          controls: result,
        },
      })
    }
  }

  return normResRtCnt({
    ...runtime,
    state: {
      ...runtime.state,
      controls: result,
    },
  }, result)
}
