/*
  Author: Runor Ewhro
  Description: Resolves conditional select-option sets for resonator controls
               and source states, and normalizes invalid stored control values.
*/

import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import type {
  ResControlOption,
  ResControlOptionValue,
  ResStateControl,
} from '@/domain/entities/resonator'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SourceState, SrcSttPtn } from '@/domain/gameData/contracts'
import { getResStateControls } from '@/domain/gameData/resonatorStateGraph'
import { makeTeamComp } from '@/domain/gameData/teamComposition'
import { evalCond } from '@/engine/effects/evaluator'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

type ResResolvedControlOption = {
  value: ResControlOptionValue
  label: string
}

export function normResCntrOpt(
  option: ResControlOptionValue | ResControlOption,
): ResResolvedControlOption {
  if (typeof option === 'object') {
    return {
      value: option.id,
      label: option.label,
    }
  }

  return {
    value: option,
    label: String(option),
  }
}

function sameSelectValue(left: unknown, right: unknown): boolean {
  return String(left) === String(right)
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
): Array<ResControlOptionValue | ResControlOption> {
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
): boolean | number | string {
  if (control.kind === 'toggle') {
    return control.defaultValue ?? false
  }

  if (control.kind === 'select') {
    const options = runtime ? resResCntrPt(runtime, control) : control.options
    const defaultValue = control.defaultValue
    if (
      defaultValue !== undefined
      && (!options?.length || options.some((option) => sameSelectValue(normResCntrOpt(option).value, defaultValue)))
    ) {
      return defaultValue
    }

    const firstOption = options?.[0]
    return firstOption === undefined ? control.min ?? '' : normResCntrOpt(firstOption).value
  }

  return control.defaultValue ?? control.min ?? 0
}

export function getResNumMax(
  runtime: ResRuntime,
  control: Pick<ResStateControl, 'max' | 'maxWhen'>,
): number | undefined {
  const scope = mkResCntrScp(runtime)

  for (const entry of control.maxWhen ?? []) {
    if (evalCond(entry.when, scope)) {
      return entry.max
    }
  }

  return control.max
}

export function normResRtCnt(
  runtime: ResRuntime,
  controls: Record<string, boolean | number | string> = runtime.state.controls,
): Record<string, boolean | number | string> {
  const details = getResDtlsBy()[runtime.id]
  if (!details) {
    return controls
  }

  const vlblCntr = getResStateControls(details)

  const nextControls = { ...controls }
  let changed = false

  for (const control of vlblCntr) {
    if (nextControls[control.key] !== undefined) {
      continue
    }

    nextControls[control.key] = getResCntrNc(control, {
      ...runtime,
      state: {
        ...runtime.state,
        controls: nextControls,
      },
    })
    changed = true
  }

  for (const control of vlblCntr) {
    const scpdRt = {
      ...runtime,
      state: {
        ...runtime.state,
        controls: nextControls,
      },
    }

    const unavailable = !evalCond(control.visibleWhen, mkResCntrScp(scpdRt))
      || !(control.controlDependencies ?? []).every((controlKey) => Boolean(nextControls[controlKey]))

    if (unavailable) {
      const nctvVl = getResCntrNc(control, scpdRt)
      if (nextControls[control.key] !== nctvVl) {
        nextControls[control.key] = nctvVl
        changed = true
      }
      continue
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
      const currentValue = nextControls[control.key]

      if (!options.some((option) => sameSelectValue(normResCntrOpt(option).value, currentValue))) {
        nextControls[control.key] = getResCntrNc(control, scpdRt)
        changed = true
      }
      continue
    }

    if (control.kind === 'number') {
      const min = control.min ?? 0
      const max = getResNumMax(scpdRt, control)

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
    return state.defaultValue ?? false
  }

  if (state.kind === 'select') {
    const options = sourceOptions(srcRt, tgtRt, state, actRt)
    if (
      state.defaultValue !== undefined
      && (!options.length || options.some((option) => sameSelectValue(option.id, state.defaultValue)))
    ) {
      return state.defaultValue
    }

    return options[0]?.id ?? ''
  }

  return state.defaultValue ?? state.min ?? 0
}
