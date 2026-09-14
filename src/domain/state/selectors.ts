/*
  Author: Runor Ewhro
  Description: Defines memoized store selectors for active runtime, combat,
               Optimizer, team lookup, and Simulation-derived state.
*/

import {type AppStore} from '@/domain/state/store'
import type { LegacyProfileMap } from '@/domain/entities/appState'
import type { EnemyProfile } from '@/domain/entities/appState'
import {
  contextScenarioMember,
  type CombatScenario,
  type TeamMemberId,
} from '@/domain/entities/combatScenario'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import type { ResRuntime } from '@/domain/entities/runtime'
import {
  mkInitRtLkp,
} from '@/domain/state/runtimeAdapters'
import type { PrepWork } from '@/engine/pipeline/preparedWorkspace'
import { mkInvSgDrvd, type InvSgDrvd } from '@/domain/state/inventoryUsage'
import { prepareCombatScenarioForUi } from '@/engine/pipeline/combatScenario'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { projectScenarioWorkspaceProfiles } from '@/domain/state/scenarioRuntime'

export interface WorkDrvdStt {
  scenario: CombatScenario | null
  prepWork: PrepWork
  actRt: ResRuntime | null
  partRtsById: Record<string, ResRuntime>
  actTgtSels: Record<string, string | null>
  combatGraph: CombatGraph | null
}

interface VrvwDrvdStt extends WorkDrvdStt {
  initRtsById: Record<string, ResRuntime>
}

interface PrepWorkCchE {
  scenario: CombatScenario
  value: WorkDrvdStt
}

interface InitRtLkpCch {
  workspace: AppStore['combat']
  value: Record<string, ResRuntime>
}

let workDrvdCch: PrepWorkCchE | null = null
let vrvwDrvdCch: {
  scenario: CombatScenario
  workspace: AppStore['combat']
  value: VrvwDrvdStt
} | null = null
let initRtLkpCch: InitRtLkpCch | null = null
let profilesCch: {
  workspace: AppStore['combat']
  value: LegacyProfileMap
} | null = null
let invSgCch: {
  profiles: LegacyProfileMap
  invBuilds: AppStore['library']['builds']
  seeEquipped: boolean
  value: InvSgDrvd
} | null = null

function mkWorkDrvd(scenario: CombatScenario): WorkDrvdStt {
  const prepared = prepareCombatScenarioForUi(scenario)

  return {
    scenario,
    prepWork: prepared.workspace,
    actRt: prepared.subjectRuntime,
    partRtsById: prepared.runtimesById,
    actTgtSels: prepared.selectedTargets,
    combatGraph: prepared.workspace.combatGraph,
  }
}

export function selWorkDrvd(state: AppStore): WorkDrvdStt {
  const scenario = selectedCombatScenario(state.combat)
  const cached = workDrvdCch

  if (cached?.scenario === scenario) {
    return cached.value
  }

  const value = mkWorkDrvd(scenario)
  workDrvdCch = {
    scenario,
    value,
  }
  return value
}

export function selVrvwDrvd(state: AppStore): VrvwDrvdStt {
  const scenario = selectedCombatScenario(state.combat)
  const cached = vrvwDrvdCch

  if (
    cached
    && cached.scenario === scenario
    && cached.workspace === state.combat
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
    scenario,
    workspace: state.combat,
    value,
  }

  return value
}

export function selCombatScenario(state: AppStore): CombatScenario | null {
  return selWorkDrvd(state).scenario
}

export function selSubjectMemberId(state: AppStore): TeamMemberId | null {
  return selectedCombatScenario(state.combat).team.members[0]?.id ?? null
}

export function selSubjectResonatorId(state: AppStore): string | null {
  return selectedCombatScenario(state.combat).team.members[0]?.resonatorId ?? null
}

export function selContextMemberId(state: AppStore): TeamMemberId | null {
  return contextScenarioMember(selectedCombatScenario(state.combat)).id
}

export function selContextResonatorId(state: AppStore): string | null {
  return contextScenarioMember(selectedCombatScenario(state.combat)).resonatorId
}

// select the active resonator id
/** @deprecated Use the scenario subject selectors; this aliases member zero during migration. */
export function selActResId(state: AppStore): string | null {
  return selSubjectResonatorId(state)
}

// select the current enemy profile
export function selEnemyProf(state: AppStore): EnemyProfile {
  return selectedCombatScenario(state.combat).target
}

// select the participant runtime lookup
export function selPartRtLkp(state: AppStore): Record<string, ResRuntime> {
  return selWorkDrvd(state).partRtsById
}

// select the initialized runtime lookup
export function selInitRtLkp(state: AppStore): Record<string, ResRuntime> {
  const cached = initRtLkpCch
  if (
    cached
    && cached.workspace === state.combat
  ) {
    return cached.value
  }

  const value = mkInitRtLkp(state.combat)
  initRtLkpCch = {
    workspace: state.combat,
    value,
  }

  return value
}

export function selScenarioProfiles(state: AppStore): LegacyProfileMap {
  const cached = profilesCch
  if (cached?.workspace === state.combat) return cached.value
  const value = projectScenarioWorkspaceProfiles(state.combat)
  profilesCch = { workspace: state.combat, value }
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
  const profiles = selScenarioProfiles(state)
  if (
    cached
    && cached.profiles === profiles
    && cached.invBuilds === state.library.builds
    && state.ui.seeEquipped === cached.seeEquipped
  ) {
    return cached.value
  }

  const value = mkInvSgDrvd(
    profiles, state.library.builds, state.ui.seeEquipped)
  invSgCch = {
    profiles,
    invBuilds: state.library.builds,
    seeEquipped: state.ui.seeEquipped,
    value,
  }
  return value
}
