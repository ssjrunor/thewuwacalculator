/*
  Author: Runor Ewhro
  Description: Builds a valid maxed resonator runtime for a target sequence,
               including state controls and mutually exclusive state paths.
*/

import type {
  ResDtls,
  ResModeGroup,
  ResStateGroup,
  ResStateControl,
  SkillTabKey,
} from '@/domain/entities/resonator'
import type { ResRuntime } from '@/domain/entities/runtime'
import {
  getResCntrNc,
  getResNumMax,
  mkResCntrScp,
  normResCntrOpt,
  normResRtCnt,
  resResCntrPt,
} from '@/domain/gameData/controlOptions'
import {
  getResModeGroups,
  getResStateControls,
  getResStateGroups,
} from '@/domain/gameData/resonatorStateGraph'
import { cmptTrcNodeB } from '@/domain/state/traceNodes'
import { evalCond } from '@/engine/effects/evaluator'

const SKILL_TABS: Array<Exclude<SkillTabKey, 'outroSkill'>> = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'tuneBreak',
]

const MAX_PASS_LIMIT = 8

export interface MaxResRtOpt {
  targetSequence?: number
}

function clampSequence(sequence: number): number {
  if (!Number.isFinite(sequence)) {
    return 0
  }

  return Math.min(Math.max(Math.round(sequence), 0), 6)
}

function getModeMaxValue(group: ResModeGroup): string {
  return (group.allowNone
    ? group.modes.find((mode) => mode.id !== 'none')
    : group.modes[0])?.id ?? group.defaultValue
}

function priRuleOk(
  rule: NonNullable<ResStateGroup['maxPriority']>[number],
  targetSequence: number,
): boolean {
  if (rule.sequenceMin !== undefined && targetSequence < rule.sequenceMin) {
    return false
  }

  if (rule.sequenceMax !== undefined && targetSequence > rule.sequenceMax) {
    return false
  }

  return true
}

function getGroupMaxKey(group: ResStateGroup, targetSequence: number): string | undefined {
  const priorityKey = group.maxPriority
    ?.find((rule) => rule.key && priRuleOk(rule, targetSequence))
    ?.key

  return priorityKey ?? group.maxKey ?? group.defaultKey ?? group.members?.[0]
}

function getGrpMaxVal(group: ResStateGroup, targetSequence: number): string | undefined {
  const priorityValue = group.maxPriority
    ?.find((rule) => rule.value !== undefined && priRuleOk(rule, targetSequence))
    ?.value

  return priorityValue ?? group.maxValue ?? group.defaultValue
}

function sameRtVal(
  left: boolean | number | string | undefined,
  right: boolean | number | string,
): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if ((typeof left === 'number' || typeof left === 'string') && (typeof right === 'number' || typeof right === 'string')) {
    return String(left) === String(right)
  }

  return false
}

function getSkillTabs(details: ResDtls): Array<Exclude<SkillTabKey, 'outroSkill'>> {
  return SKILL_TABS.filter((tab) => details.skillTabs.includes(tab))
}

function controlVisible(runtime: ResRuntime, control: ResStateControl): boolean {
  return evalCond(control.visibleWhen, mkResCntrScp(runtime))
}

function controlEnabled(runtime: ResRuntime, control: ResStateControl): boolean {
  return (control.controlDependencies ?? []).every((controlKey) => Boolean(runtime.state.controls[controlKey]))
    && evalCond(control.enabledWhen, mkResCntrScp(runtime))
}

function getDynCtlMax(control: ResStateControl, runtime: ResRuntime): number | undefined {
  return getResNumMax(runtime, control)
}

function getCtlMaxVal(
  control: ResStateControl,
  runtime: ResRuntime,
): boolean | number | string | undefined {
  if (control.kind === 'toggle') {
    return control.maxValue ?? true
  }

  if (control.kind === 'select') {
    const optionsList = resResCntrPt(runtime, control)
    const expMaxVal = control.maxValue
    if (
      expMaxVal !== undefined
      && optionsList.some((option) => sameRtVal(normResCntrOpt(option).value, expMaxVal))
    ) {
      return expMaxVal
    }

    const lastOption = optionsList[optionsList.length - 1]
    return lastOption === undefined ? undefined : normResCntrOpt(lastOption).value
  }

  return control.maxValue ?? getDynCtlMax(control, runtime)
}

export function maxResRt(
  runtime: ResRuntime,
  details: ResDtls | null | undefined,
  options: MaxResRtOpt = {},
): ResRuntime {
  const targetSequence = clampSequence(options.targetSequence ?? runtime.base.sequence)
  const nextControls = {
    ...runtime.state.controls,
  }

  for (const group of getResStateGroups(details)) {
    if (group.controlKey) {
      nextControls[group.controlKey] = getGrpMaxVal(group, targetSequence) ?? getModeMaxValue(group as ResModeGroup)
    }
  }

  const nextSkillLevels = {
    ...runtime.base.skillLevels,
  }

  if (details) {
    for (const tab of getSkillTabs(details)) {
      nextSkillLevels[tab] = 10
    }
  }

  const nextTrcNodes = details
    ? Object.fromEntries(details.traceNodes.map((node) => [node.id, true]))
    : runtime.base.traceNodes.activeNodes

  const maxBaseRt = {
    ...runtime,
    base: {
      ...runtime.base,
      level: 90,
      sequence: targetSequence,
      skillLevels: nextSkillLevels,
      traceNodes: details ? cmptTrcNodeB(details, nextTrcNodes) : runtime.base.traceNodes,
    },
    state: {
      ...runtime.state,
      controls: nextControls,
    },
  }

  if (!details) {
    return maxBaseRt
  }

  const allControls = getResStateControls(details)
  const ctrlsByKey = new Map(allControls.map((control) => [control.key, control]))
  const modeCtlKeys = new Set(getResModeGroups(details).map((group) => group.controlKey))
  const exclMemKeys = new Set(getResStateGroups(details).flatMap((group) => group.members ?? []))
  const selExclKeys = new Set<string>()
  const rstBlockKeys = new Set<string>()

  const getOffVal = (controlKey: string, scopedRuntime: ResRuntime): boolean | number | string => {
    const control = ctrlsByKey.get(controlKey)
    if (control?.kind === 'toggle' && exclMemKeys.has(controlKey)) {
      return false
    }

    if (control) {
      return getResCntrNc(control, scopedRuntime)
    }

    return false
  }

  for (const group of getResStateGroups(details)) {
    if (!group.members?.length) {
      continue
    }

    const maxKey = getGroupMaxKey(group, targetSequence)
    if (maxKey) {
      selExclKeys.add(maxKey)
    }
    const scopedRuntime = {
      ...maxBaseRt,
      state: {
        ...maxBaseRt.state,
        controls: nextControls,
      },
    }

    for (const memberKey of group.members) {
      if (memberKey === maxKey) {
        continue
      }

      rstBlockKeys.add(memberKey)
      nextControls[memberKey] = getOffVal(memberKey, scopedRuntime)
    }
  }

  const applyResets = (
    resets: string[] | undefined,
    scopedRuntime: ResRuntime,
  ): boolean => {
    let changed = false

    for (const resetKey of resets ?? []) {
      rstBlockKeys.add(resetKey)
      const offVal = getOffVal(resetKey, scopedRuntime)
      if (!sameRtVal(nextControls[resetKey], offVal)) {
        nextControls[resetKey] = offVal
        changed = true
      }
    }

    return changed
  }

  for (let pass = 0; pass < MAX_PASS_LIMIT; pass += 1) {
    let changed = false
    const scopedRuntime = {
      ...maxBaseRt,
      state: {
        ...maxBaseRt.state,
        controls: nextControls,
      },
    }

    const maxCtrls = allControls.filter((control) =>
      !rstBlockKeys.has(control.key)
      && !modeCtlKeys.has(control.key)
      && (
        selExclKeys.has(control.key)
        ||
        !control.resets?.some((resetKey) => rstBlockKeys.has(resetKey))
        || Boolean(nextControls[control.key])
      )
      && controlVisible(scopedRuntime, control)
      && controlEnabled(scopedRuntime, control),
    )

    for (const control of maxCtrls) {
      const nextValue = getCtlMaxVal(control, scopedRuntime)
      if (nextValue === undefined) {
        continue
      }

      if (control.kind === 'toggle' && nextValue === true) {
        changed = applyResets(control.resets, scopedRuntime) || changed
      }

      if (!sameRtVal(nextControls[control.key], nextValue)) {
        nextControls[control.key] = nextValue
        changed = true
      }
    }

    if (!changed) {
      break
    }
  }

  const maxedRt = {
    ...maxBaseRt,
    state: {
      ...maxBaseRt.state,
      controls: nextControls,
    },
  }

  return {
    ...maxedRt,
    state: {
      ...maxedRt.state,
      controls: normResRtCnt(maxedRt, nextControls),
    },
  }
}
