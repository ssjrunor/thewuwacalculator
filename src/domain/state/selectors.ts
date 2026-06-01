/*
  Author: Runor Ewhro
  Description: Defines memoized store selectors for active runtime, combat,
               optimizer, team lookup, and calculator-derived state.
*/

import {type AppStore} from '@/domain/state/store'
import type { CalcState } from '@/domain/entities/appState'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { OptContext } from '@/domain/entities/optimizer'
import {
  mkInitRtLkp,
  mkWorkRtBndl,
  getActResId,
} from '@/domain/state/runtimeAdapters'
import { mkCmbtGrphFr } from '@/domain/state/combatGraph'
import { mkPrepWork, type PrepWork } from '@/engine/pipeline/preparedWorkspace'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { mkInvSgDrvd, type InvSgDrvd } from '@/domain/state/inventoryUsage'

interface WorkDrvdStt {
  prepWork: PrepWork
  actRt: ResRuntime | null
  partRtsById: Record<string, ResRuntime>
  actTgtSels: Record<string, string | null>
  combatGraph: ReturnType<typeof mkCmbtGrphFr>
}

interface VrvwDrvdStt extends WorkDrvdStt {
  initRtsById: Record<string, ResRuntime>
}

interface PrepWorkCchE {
  rtRev: number
  actResId: string | null
  enemyProfile: EnemyProfile
  value: WorkDrvdStt
}

interface InitRtLkpCch {
  rtRev: number
  value: Record<string, ResRuntime>
}

let workDrvdCch: PrepWorkCchE | null = null
let vrvwDrvdCch: {
  rtRev: number
  actResId: string | null
  enemyProfile: EnemyProfile
  value: VrvwDrvdStt
} | null = null
let initRtLkpCch: InitRtLkpCch | null = null
let invSgCch: {
  profiles: CalcState['profiles']
  invBuilds: CalcState['inventoryBuilds']
  seeEquipped: boolean
  value: InvSgDrvd
} | null = null

function mkWorkDrvd(calculator: CalcState): WorkDrvdStt {
  const workspace = mkWorkRtBndl(calculator)
  const combatGraph = mkCmbtGrphFr(calculator, workspace)
  const activeSeed = workspace.actRt ? getResSeedBy(workspace.actRt.id) : null
  const enemyProfile = calculator.session.enemyProfile

  return {
    prepWork: mkPrepWork({
      revision: calculator.runtimeRevision,
      runtime: workspace.actRt,
      seed: activeSeed,
      enemy: enemyProfile,
      prtcRntmById: workspace.partRtsById,
      activeTarget: workspace.actTgtSels,
      combatGraph,
    }),
    actRt: workspace.actRt,
    partRtsById: workspace.partRtsById,
    actTgtSels: workspace.actTgtSels,
    combatGraph,
  }
}

export function selWorkDrvd(state: AppStore): WorkDrvdStt {
  const actResId = getActResId(state.calculator)
  const enemyProfile = state.calculator.session.enemyProfile
  const cached = workDrvdCch

  if (
    cached
    && cached.rtRev === state.calculator.runtimeRevision
    && cached.actResId === actResId
    && cached.enemyProfile === enemyProfile
  ) {
    return cached.value
  }

  const value = mkWorkDrvd(state.calculator)
  workDrvdCch = {
    rtRev: state.calculator.runtimeRevision,
    actResId: actResId,
    enemyProfile,
    value,
  }
  return value
}

export function selVrvwDrvd(state: AppStore): VrvwDrvdStt {
  const actResId = getActResId(state.calculator)
  const enemyProfile = state.calculator.session.enemyProfile
  const cached = vrvwDrvdCch

  if (
    cached
    && cached.rtRev === state.calculator.runtimeRevision
    && cached.actResId === actResId
    && cached.enemyProfile === enemyProfile
  ) {
    return cached.value
  }

  const workspace = selWorkDrvd(state)
  const initRntmById = selInitRtLkp(state)
  const value = {
    ...workspace,
    initRtsById: initRntmById,
  }

  vrvwDrvdCch = {
    rtRev: state.calculator.runtimeRevision,
    actResId: actResId,
    enemyProfile,
    value,
  }

  return value
}

// select the active resonator id
export function selActResId(state: AppStore): string | null {
  return getActResId(state.calculator)
}

// select the current enemy profile
export function selEnemyProf(state: AppStore): EnemyProfile {
  return state.calculator.session.enemyProfile
}

// select the participant runtime lookup
export function selPartRtLkp(state: AppStore): Record<string, ResRuntime> {
  return selWorkDrvd(state).partRtsById
}

// select the initialized runtime lookup
export function selInitRtLkp(state: AppStore): Record<string, ResRuntime> {
  const cached = initRtLkpCch
  if (cached && cached.rtRev === state.calculator.runtimeRevision) {
    return cached.value
  }

  const value = mkInitRtLkp(state.calculator)
  initRtLkpCch = {
    rtRev: state.calculator.runtimeRevision,
    value,
  }

  return value
}

// select the active target routing map
export function selActTgtSlc(state: AppStore): Record<string, string | null> {
  return selWorkDrvd(state).actTgtSels
}

// select the derived combat graph
export function selCmbtGrph(state: AppStore) {
  return selWorkDrvd(state).combatGraph
}

// select the active runtime
export function selActRt(state: AppStore): ResRuntime | null {
  return selWorkDrvd(state).actRt
}

// select app-level inventory ownership indexes
export function selInvSg(state: AppStore): InvSgDrvd {
  const cached = invSgCch
  if (
    cached
    && cached.profiles === state.calculator.profiles
    && cached.invBuilds === state.calculator.inventoryBuilds
    && state.ui.seeEquipped === cached.seeEquipped
  ) {
    return cached.value
  }

  const value = mkInvSgDrvd(
    state.calculator.profiles, state.calculator.inventoryBuilds, state.ui.seeEquipped)
  invSgCch = {
    profiles: state.calculator.profiles,
    invBuilds: state.calculator.inventoryBuilds,
    seeEquipped: state.ui.seeEquipped,
    value,
  }
  return value
}

// select the optimizer context
export function selOptCtx(state: AppStore): OptContext | null {
  return state.calculator.optimizerContext
}
