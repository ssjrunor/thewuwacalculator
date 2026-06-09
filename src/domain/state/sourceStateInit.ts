/*
  Author: Runor Ewhro
  Description: Initializes and maxes source state controls for weapons,
               main echoes, and echo sets.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import { isNoWeaponId } from '@/domain/entities/runtime'
import {
  ECHO_SET_DEFS,
  getEchoSetCn,
  type SetDef,
} from '@/data/gameData/echoSets/effects'
import type { SourceState } from '@/domain/gameData/contracts'
import {
  getSrcSttNct,
  mkSrcSttScp,
  sourceOptions,
} from '@/domain/gameData/controlOptions'
import { getMainEchoS } from '@/domain/services/runtimeSourceService'
import { listStatesFor } from '@/domain/services/gameDataService'
import { evalCond } from '@/engine/effects/evaluator'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import { wpnAtkAt } from '@/domain/state/weaponState'

export type RtCtlMap = Record<string, boolean | number | string>

const RT_CNTR_PRFX = 'runtime.state.controls.'
const MAX_WPN_LVL = 90

function sameValue(left: unknown, right: unknown): boolean {
  return String(left) === String(right)
}

export function srcSttKey(state: SourceState): string {
  return state.path.startsWith(RT_CNTR_PRFX)
    ? state.path.slice(RT_CNTR_PRFX.length)
    : state.controlKey
}

function srcReqMet(srcRt: ResRuntime, state: SourceState): boolean {
  const sttsByCtl = new Map(
    listStatesFor(state.source.type, state.source.id)
      .map((entry) => [entry.controlKey, entry]),
  )

  return (state.requires ?? state.controlDependencies ?? [])
    .every((controlKey) => {
      const curVal = srcRt.state.controls[controlKey]
      if (curVal !== undefined) {
        return Boolean(curVal)
      }

      return Boolean(sttsByCtl.get(controlKey)?.defaultValue)
    })
}

function srcSttVis(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): boolean {
  return srcReqMet(srcRt, state)
    && evalCond(state.visibleWhen, mkSrcSttScp(srcRt, tgtRt, state, actRt))
    && evalCond(state.enabledWhen, mkSrcSttScp(srcRt, tgtRt, state, actRt))
}

function clampNumber(value: number, min: number, max?: number): number {
  if (max == null) {
    return Math.max(value, min)
  }

  return Math.min(Math.max(value, min), max)
}

export function srcSttNumMax(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): number | undefined {
  const scope = mkSrcSttScp(srcRt, tgtRt, state, actRt)

  for (const entry of state.maxWhen ?? []) {
    if (evalCond(entry.when, scope)) {
      return entry.max
    }
  }

  return state.max
}

export function srcSttMax(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): boolean | number | string {
  if (state.kind === 'toggle') {
    return typeof state.maxValue === 'boolean' ? state.maxValue : true
  }

  if (state.kind === 'select') {
    const options = sourceOptions(srcRt, tgtRt, state, actRt)
    if (
      state.maxValue !== undefined
      && options.some((option) => sameValue(option.id, state.maxValue))
    ) {
      return state.maxValue
    }

    return options.at(-1)?.id ?? getSrcSttNct(srcRt, tgtRt, state, actRt)
  }

  const min = state.min ?? 0
  const max = srcSttNumMax(srcRt, tgtRt, state, actRt)
  const rawValue = Number(max ?? state.maxValue ?? state.defaultValue ?? min)
  return clampNumber(Number.isFinite(rawValue) ? rawValue : min, min, max)
}

function srcSttDef(
  srcRt: ResRuntime,
  tgtRt: ResRuntime,
  state: SourceState,
  actRt: ResRuntime = tgtRt,
): boolean | number | string {
  return getSrcSttNct(srcRt, tgtRt, state, actRt)
}

export function clrSrcCtrls(
  controls: RtCtlMap,
  source: { type: SourceState['source']['type']; id: string | null | undefined },
  prefix = '',
): void {
  if (!source.id || (source.type === 'weapon' && isNoWeaponId(source.id))) {
    return
  }

  const targetPrefix = `${prefix}${source.type}:${source.id}:`
  for (const key of Object.keys(controls)) {
    if (key.startsWith(targetPrefix)) {
      delete controls[key]
    }
  }
}

function apSrcStts(
  runtime: ResRuntime,
  controls: RtCtlMap,
  states: SourceState[],
  options: { maxed: boolean; prefix?: string },
): void {
  const prefix = options.prefix ?? ''
  let scopedRuntime = {
    ...runtime,
    state: {
      ...runtime.state,
      controls,
    },
  }

  for (const state of states) {
    if (!srcSttVis(scopedRuntime, scopedRuntime, state, scopedRuntime)) {
      continue
    }

    const controlKey = srcSttKey(state)
    const nextValue = options.maxed
      ? srcSttMax(scopedRuntime, scopedRuntime, state, scopedRuntime)
      : srcSttDef(scopedRuntime, scopedRuntime, state, scopedRuntime)

    if (state.kind === 'toggle' && nextValue === true) {
      for (const resetKey of state.resets ?? []) {
        controls[`${prefix}${resetKey}`] = false
      }
    }

    controls[`${prefix}${controlKey}`] = nextValue
    scopedRuntime = {
      ...scopedRuntime,
      state: {
        ...scopedRuntime.state,
        controls,
      },
    }
  }
}

export function apWpnStts(
  controls: RtCtlMap,
  runtime: ResRuntime,
  weaponId: string | null | undefined,
  options: { maxed: boolean; prefix?: string },
): void {
  if (!weaponId || isNoWeaponId(weaponId)) {
    return
  }

  apSrcStts(
    runtime,
    controls,
    listStatesFor('weapon', weaponId),
    options,
  )
}

export function initWpnStts(
  runtime: ResRuntime,
  options: {
    weaponId?: string | null
    prevWpnId?: string | null
    maxed: boolean
  },
): ResRuntime {
  const weaponId = options.weaponId ?? runtime.build.weapon.id
  const controls = { ...runtime.state.controls }

  clrSrcCtrls(controls, { type: 'weapon', id: options.prevWpnId ?? runtime.build.weapon.id })
  apWpnStts(controls, runtime, weaponId, { maxed: options.maxed })

  return {
    ...runtime,
    state: {
      ...runtime.state,
      controls,
    },
  }
}

export function maxWpnStts(runtime: ResRuntime): ResRuntime {
  return initWpnStts(runtime, {
    weaponId: runtime.build.weapon.id,
    prevWpnId: null,
    maxed: true,
  })
}

function clampRank(rank: number): number {
  if (!Number.isFinite(rank)) {
    return 1
  }

  return Math.min(Math.max(Math.round(rank), 1), 5)
}

export function maxWpnRt(
  runtime: ResRuntime,
  options: { targetRank?: number; prevWpnId?: string | null } = {},
): ResRuntime {
  const targetRank = clampRank(options.targetRank ?? runtime.build.weapon.rank)
  const weaponId = runtime.build.weapon.id
  const nextRuntime = {
    ...runtime,
    build: {
      ...runtime.build,
      weapon: {
        ...runtime.build.weapon,
        level: MAX_WPN_LVL,
        rank: targetRank,
        baseAtk: wpnAtkAt(weaponId, MAX_WPN_LVL),
      },
    },
  }

  return initWpnStts(nextRuntime, {
    weaponId,
    prevWpnId: options.prevWpnId,
    maxed: true,
  })
}

export function wpnSttsMaxed(runtime: ResRuntime): boolean {
  const weaponId = runtime.build.weapon.id
  if (!weaponId || isNoWeaponId(weaponId)) {
    return true
  }

  const controls: RtCtlMap = { ...runtime.state.controls }
  const expected = {
    ...runtime,
    state: {
      ...runtime.state,
      controls,
    },
  }
  apWpnStts(controls, expected, weaponId, { maxed: true })

  return Object.entries(controls).every(([key, value]) => runtime.state.controls[key] === value)
}

function echoSrcSig(echoes: ResRuntime['build']['echoes']): string {
  const mainEchoId =
    echoes.find((echo) => echo?.mainEcho)?.id
    ?? echoes[0]?.id
    ?? echoes.find((echo) => echo != null)?.id
    ?? ''
  const setCounts = countEchoSets(echoes)
  const sets = Object.entries(setCounts)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([id, count]) => `${id}:${count}`)
    .join(',')

  return `${mainEchoId}|${sets}`
}

export function echoSrcChg(
  previousEchoes: ResRuntime['build']['echoes'] | undefined,
  nextEchoes: ResRuntime['build']['echoes'],
): boolean {
  if (!previousEchoes) {
    return true
  }

  return echoSrcSig(previousEchoes) !== echoSrcSig(nextEchoes)
}

function clrEchoCtrls(controls: RtCtlMap): void {
  for (const key of Object.keys(controls)) {
    if (key.startsWith('echo:') || key.startsWith('echoSet:')) {
      delete controls[key]
    }
  }
}

function echoSetPieceReq(def: SetDef): number {
  if (def.setMax === 1) return 1
  if (def.setMax === 3) return 3
  return 5
}

function echoSetMax(state: SetDef['states'][string]): boolean | number {
  const perStep = state.perStep ?? state.perStack ?? state.max
  const isToggle = perStep.every((step, index) => step.value === state.max[index].value)

  if (isToggle) {
    return true
  }

  return Math.round(
    Math.max(...perStep.map((step, index) => state.max[index].value / step.value)),
  )
}

function apEchoSetPnl(
  runtime: ResRuntime,
  controls: RtCtlMap,
): void {
  const setCounts = countEchoSets(runtime.build.echoes)

  for (const def of ECHO_SET_DEFS) {
    if ((setCounts[String(def.id)] ?? 0) < echoSetPieceReq(def)) {
      continue
    }

    for (const [stateId, state] of Object.entries(def.states)) {
      controls[getEchoSetCn(def.id, stateId)] = echoSetMax(state)
    }
  }
}

export function maxEchoStts(runtime: ResRuntime): ResRuntime {
  const controls = { ...runtime.state.controls }
  clrEchoCtrls(controls)

  let scopedRuntime = {
    ...runtime,
    state: {
      ...runtime.state,
      controls,
    },
  }

  const mainEcho = getMainEchoS(runtime)
  if (mainEcho) {
    apSrcStts(
      scopedRuntime,
      controls,
      listStatesFor(mainEcho.type, mainEcho.id),
      { maxed: true },
    )
  }

  scopedRuntime = {
    ...scopedRuntime,
    state: {
      ...scopedRuntime.state,
      controls,
    },
  }

  for (const setId of Object.keys(countEchoSets(runtime.build.echoes))) {
    apSrcStts(
      scopedRuntime,
      controls,
      listStatesFor('echoSet', setId),
      { maxed: true },
    )
    scopedRuntime = {
      ...scopedRuntime,
      state: {
        ...scopedRuntime.state,
        controls,
      },
    }
  }

  apEchoSetPnl(scopedRuntime, controls)

  return {
    ...runtime,
    state: {
      ...runtime.state,
      controls,
    },
  }
}

export function maxEchoIfChg(
  runtime: ResRuntime,
  previousEchoes?: ResRuntime['build']['echoes'],
): ResRuntime {
  return echoSrcChg(previousEchoes, runtime.build.echoes)
    ? maxEchoStts(runtime)
    : runtime
}
