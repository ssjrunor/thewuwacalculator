/*
  Author: Runor Ewhro
  Description: Resolves conditional select-option sets for resonator controls
               and source states, and normalizes invalid stored control values.
*/

import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import type { ResStateControl } from '@/domain/entities/resonator'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SourceState, SrcSttPtn } from '@/domain/gameData/contracts'
import { makeTeamComp } from '@/domain/gameData/teamComposition'
import { evalCond } from '@/engine/effects/evaluator'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function mkResCntrScp(runtime: ResRuntime) {
  const teamMemIds = Array.from(
    new Set([
      runtime.id,
      ...runtime.build.team.filter((memberId): memberId is string => Boolean(memberId)),
    ]),
  )
  const team = makeTeamComp(teamMemIds)

  return {
    sourceRuntime: runtime,
    targetRuntime: runtime,
    activeRuntime: runtime,
    context: {
      team,
      source: {
        type: 'resonator' as const,
        id: runtime.id,
      },
      sourceRuntime: runtime,
      targetRuntime: runtime,
      activeRuntime: runtime,
      targetRuntimeId: runtime.id,
      activeResonatorId: runtime.id,
      teamMemberIds: teamMemIds,
      echoSetCounts: countEchoSets(runtime.build.echoes),
    },
  }
}

export function resResCntrPt(
  runtime: ResRuntime,
  control: ResStateControl,
): number[] {
  const scope = mkResCntrScp(runtime)

  for (const optionSet of control.optionsWhen ?? []) {
    if (evalCond(optionSet.when, scope)) {
      return optionSet.options
    }
  }

  if (control.sequenceAwareOptions) {
    return runtime.base.sequence >= control.sequenceAwareOptions.threshold
      ? control.sequenceAwareOptions.atOrAbove
      : control.sequenceAwareOptions.below
  }

  return control.options ?? []
}

export function getResCntrNc(
  control: ResStateControl,
  runtime?: ResRuntime,
): boolean | number {
  if (control.defaultValue !== undefined) {
    return control.defaultValue
  }

  if (control.kind === 'toggle') {
    return false
  }

  if (control.kind === 'select') {
    const firstOption = runtime ? resResCntrPt(runtime, control)[0] : control.options?.[0]
    return control.min ?? firstOption ?? 0
  }

  return control.min ?? 0
}

export function normResRtCnt(
  runtime: ResRuntime,
  controls: Record<string, boolean | number | string> = runtime.state.controls,
): Record<string, boolean | number | string> {
  const details = getResDtlsBy()[runtime.id]
  if (!details) {
    return controls
  }

  const vlblCntr = [
    ...details.statePanels.flatMap((panel) => panel.controls),
    ...details.resonanceChains.flatMap((entry) => entry.controls ?? []),
  ]

  const nextControls = { ...controls }
  let changed = false

  for (const control of vlblCntr) {
    const scpdRt = {
      ...runtime,
      state: {
        ...runtime.state,
        controls: nextControls,
      },
    }

    if (control.disabledWhen && nextControls[control.disabledWhen.key] === control.disabledWhen.equals) {
      const nctvVl = getResCntrNc(control, scpdRt)
      if (nextControls[control.key] !== nctvVl) {
        nextControls[control.key] = nctvVl
        changed = true
      }
      continue
    }

    if (control.kind === 'select') {
      const options = resResCntrPt(scpdRt, control)
      const currentValue = Number(nextControls[control.key] ?? Number.NaN)

      if (!options.includes(currentValue)) {
        nextControls[control.key] = getResCntrNc(control, scpdRt)
        changed = true
      }
      continue
    }

    if (control.kind === 'number') {
      const min = control.min ?? 0
      const max = control.sequenceAwareCap
        ? runtime.base.sequence >= control.sequenceAwareCap.threshold
          ? control.sequenceAwareCap.atOrAbove
          : control.sequenceAwareCap.below
        : control.max

      const numericValue = Number(nextControls[control.key] ?? min)
      const boundedValue = max == null
        ? Math.max(numericValue, min)
        : clampNumber(numericValue, min, max)

      if (boundedValue !== numericValue) {
        nextControls[control.key] = boundedValue
        changed = true
      }
    }
  }

  return changed ? nextControls : controls
}

function resSttTgtRt(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
): ResRuntime {
  const teamScpdStt = state.displayScope === 'team' || state.displayScope === 'both'

  if (teamScpdStt && srcRt.id !== tgtRt.id) {
    return srcRt
  }

  return tgtRt
}

export function mkSrcSttScp(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
) {
  const scpdTgtRt = resSttTgtRt(srcRt, tgtRt, state)
  const teamMemIds = Array.from(
    new Set([
      actRt.id,
      ...actRt.build.team.filter((memberId): memberId is string => Boolean(memberId)),
    ]),
  )
  const team = makeTeamComp(teamMemIds)

  return {
    sourceRuntime: srcRt,
    targetRuntime: scpdTgtRt,
    activeRuntime: actRt,
    context: {
      team,
      source: {
        type: state.source.type,
        id: state.source.id,
      },
      sourceRuntime: srcRt,
      targetRuntime: scpdTgtRt,
      activeRuntime: actRt,
      targetRuntimeId: scpdTgtRt.id,
      activeResonatorId: actRt.id,
      teamMemberIds: teamMemIds,
      echoSetCounts: countEchoSets(srcRt.build.echoes),
    },
  }
}

export function sourceOptions(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): SrcSttPtn[] {
  const scope = mkSrcSttScp(srcRt, tgtRt, state, actRt)

  for (const optionSet of state.optionsWhen ?? []) {
    if (evalCond(optionSet.when, scope)) {
      return optionSet.options
    }
  }

  return state.options ?? []
}

export function getSrcSttNct(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): boolean | number | string {
  if (state.kind === 'toggle') {
    return false
  }

  if (state.kind === 'select') {
    return state.defaultValue ?? sourceOptions(srcRt, tgtRt, state, actRt)[0]?.id ?? ''
  }

  return state.defaultValue ?? state.min ?? 0
}
