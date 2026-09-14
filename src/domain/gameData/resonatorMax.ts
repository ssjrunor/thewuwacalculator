/*
  Author: Runor Ewhro
  Description: Builds a valid maxed resonator runtime for a target sequence,
               including state controls and mutually exclusive state paths.
*/

import type {
  ResDtls,
  ResModeGroup,
  ResStateGroup,
  SkillTabKey,
} from '@/domain/entities/resonator'
import type { ResRuntime } from '@/domain/entities/runtime'
import {
  getResCntrMax,
  getResCntrNc,
  normResRtCnt,
} from '@/domain/gameData/controlOptions'
import {
  getResModeGroups,
  getResStateControls,
  getResStateGroups,
} from '@/domain/gameData/resonatorStateGraph'
import { cmptTrcNodeB } from '@/domain/state/traceNodes'

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
  return SKILL_TABS.filter((tab) => Boolean(details.skillsByTab[tab]))
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
      ),
    )

    for (const control of maxCtrls) {
      const nextValue = getResCntrMax(scopedRuntime, control)
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

  return {
    ...maxBaseRt,
    state: {
      ...maxBaseRt.state,
      controls: nextControls,
    },
  }
}

export function isResRtMaxed(
  runtime: ResRuntime,
  details: ResDtls | null | undefined,
): boolean {
  const maxRuntime = maxResRt(runtime, details, {
    targetSequence: runtime.base.sequence,
  })

  return runtime.base.level === maxRuntime.base.level
    && Object.entries(maxRuntime.base.skillLevels)
      .every(([key, value]) => runtime.base.skillLevels[key as keyof typeof runtime.base.skillLevels] === value)
    && (details?.traceNodes ?? [])
      .every((node) => Boolean(runtime.base.traceNodes.activeNodes[node.id]))
    && Object.entries(maxRuntime.state.controls)
      .every(([key, value]) => sameRtVal(runtime.state.controls[key], value))
}

export function setResRtSequence(
  runtime: ResRuntime,
  details: ResDtls | null | undefined,
  sequence: number,
): ResRuntime {
  const targetSequence = clampSequence(sequence)
  if (runtime.base.sequence === targetSequence) {
    return runtime
  }

  const preserveMax = Boolean(details) && isResRtMaxed(runtime, details)
  const nextRuntime = {
    ...runtime,
    base: {
      ...runtime.base,
      sequence: targetSequence,
    },
  }

  if (preserveMax) {
    return maxResRt(nextRuntime, details, { targetSequence })
  }

  return {
    ...nextRuntime,
    state: {
      ...nextRuntime.state,
      controls: normResRtCnt(nextRuntime),
    },
  }
}
