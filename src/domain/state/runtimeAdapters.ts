/*
  Author: Runor Ewhro
  Description: Provides helpers for adapting calculator profile state into
               active and team runtime views, lookup maps, and persisted updates.
*/

import type { CalcState } from '@/domain/entities/appState'
import { cloneSntSet, DEF_SET_COND } from '@/domain/entities/sonataSetConditionals'
import type { SlotLocalState } from '@/domain/entities/profile'
import type { SlotId } from '@/domain/entities/session'
import { normResRtCnt } from '@/domain/gameData/controlOptions'
import { normNegFfctC } from '@/domain/gameData/negativeEffects'
import type {
  ResRuntime,
  TeamMemRt,
  TeamMemRtVie,
  TeamSlots,
} from '@/domain/entities/runtime'
import {
  cloneSlotRml,
  makeCustomBuff,
  mkDefSkllLvl,
  makeTeamMember,
  makeTraceNode,
  normProfTeam,
} from '@/domain/state/defaults'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import {
  matRtFromPro,
  matTeamMemFr,
} from '@/domain/state/runtimeMaterialization'
import { maxEchoIfChg } from '@/domain/state/sourceStateInit'
import {
  cloneBuffs,
  cloneRotation,
  cloneSkllLvl,
  cloneTrcNode,
  cloneWpnMkSt,
} from '@/domain/state/runtimeCloning'
import { catTmWpnAtk } from '@/domain/state/weaponState'

export interface WorkRtBndl {
  actResId: string | null
  actTeamSlots: TeamSlots
  actTgtSels: Record<string, string | null>
  actRt: ResRuntime | null
  partRtsById: Record<string, ResRuntime>
}

function normRtNegFfc(runtime: ResRuntime): ResRuntime {
  const controls = normResRtCnt(runtime)
  const combat = normNegFfctC(runtime)
  const cntrNchn = Object.keys(controls).every((key) => controls[key] === runtime.state.controls[key])
    && Object.keys(runtime.state.controls).every((key) => runtime.state.controls[key] === controls[key])
  const cmbtNchn = Object.keys(combat).every(
    (key) => combat[key as keyof typeof combat] === runtime.state.combat[key as keyof typeof combat],
  )

  if (cntrNchn && cmbtNchn) {
    return runtime
  }

  return {
    ...runtime,
    state: {
      ...runtime.state,
      controls,
      combat,
    },
  }
}

function mkLclSttFrom(
    runtimeState: ResRuntime['state'],
    xstnLcl?: SlotLocalState,
): SlotLocalState {
  return {
    controls: { ...runtimeState.controls },
    manualBuffs: cloneBuffs(runtimeState.manualBuffs),
    combat: { ...runtimeState.combat },
    setConditionals: cloneSntSet(
      xstnLcl?.setConditionals ?? DEF_SET_COND,
    ),
  }
}

// build the selected target routing map from the active profile
export function mkSelTgtResM(
    calculator: CalcState,
): Record<string, string | null> {
  // all routing, including teammate routing, is stored on the active resonator profile
  const activeId = getActResId(calculator)
  if (!activeId) return {}

  return {
    ...(calculator.profiles[activeId]?.runtime.routing.selectedTargetsByOwnerKey),
  }
}

// materialize the active main runtime bundle once so callers can reuse
// active runtime, participant runtimes, team slots, and routing selections
export function mkWorkRtBndl(calculator: CalcState): WorkRtBndl {
  const actResId = getActResId(calculator)
  if (!actResId) {
    return {
      actResId: null,
      actTeamSlots: [null, null, null],
      actTgtSels: {},
      actRt: null,
      partRtsById: {},
    }
  }

  const actProf = calculator.profiles[actResId]
  if (!actProf) {
    return {
      actResId: actResId,
      actTeamSlots: [actResId, null, null],
      actTgtSels: {},
      actRt: null,
      partRtsById: {},
    }
  }

  const actTeamSlts: TeamSlots = [
    actResId,
    actProf.runtime.teamRuntimes?.[0]?.id ?? null,
    actProf.runtime.teamRuntimes?.[1]?.id ?? null,
  ]
  const activeTarget = {
    ...actProf.runtime.routing.selectedTargetsByOwnerKey,
  }
  const seed = getResSeedBy(actResId)
  const rawActRt = seed
      ? matRtFromPro({
        seed,
        profile: actProf,
        slotId: 'active',
        localState: actProf.runtime.local,
        teamSlots: actTeamSlts,
        rotation: actProf.runtime.rotation,
      })
      : null
  const actRt = rawActRt ? normRtNegFfc(rawActRt) : null

  const partRntmById: Record<string, ResRuntime> = {}
  if (actRt) {
    partRntmById[actRt.id] = actRt
  }

  const cmpcTeamRntm = actProf.runtime.teamRuntimes ?? [null, null]
  for (let slotIndex = 0; slotIndex < cmpcTeamRntm.length; slotIndex += 1) {
    const compactRuntime = cmpcTeamRntm[slotIndex]
    if (!compactRuntime) {
      continue
    }

    const teammateSeed = getResSeedBy(compactRuntime.id)
    if (!teammateSeed) {
      continue
    }

    const runtime = matTeamMemFr(
        teammateSeed,
        compactRuntime,
        actProf.runtime.local.controls,
        actRt?.state.combat ?? actProf.runtime.local.combat,
        actTeamSlts,
    )
    partRntmById[runtime.id] = normRtNegFfc(runtime)
  }

  return {
    actResId: actResId,
    actTeamSlots: actTeamSlts,
    actTgtSels: activeTarget,
    actRt: actRt,
    partRtsById: partRntmById,
  }
}

// get the active resonator id from session state
export function getActResId(calculator: CalcState): string | null {
  return calculator.session.activeResonatorId
}

// build the active team slots from the active profile
export function mkActTeamSlt(calculator: CalcState): TeamSlots {
  const actResId = getActResId(calculator)
  if (!actResId) {
    return [null, null, null]
  }

  const actProf = calculator.profiles[actResId]
  if (!actProf) {
    return [actResId, null, null]
  }

  const tmr = actProf.runtime.teamRuntimes ?? [null, null]
  return [actResId, tmr[0]?.id ?? null, tmr[1]?.id ?? null]
}

// get the resonator id occupying a given slot
export function getSlotResId(calculator: CalcState, slotId: SlotId): string | null {
  const team = mkActTeamSlt(calculator)

  switch (slotId) {
    case 'active':
      return team[0]
    case 'team1':
      return team[1]
    case 'team2':
      return team[2]
  }
}

// find the slot id for a resonator currently on the team
export function findSlotIdFo(calculator: CalcState, resonatorId: string): SlotId | null {
  const team = mkActTeamSlt(calculator)
  if (team[0] === resonatorId) return 'active'
  if (team[1] === resonatorId) return 'team1'
  if (team[2] === resonatorId) return 'team2'
  return null
}

// find the compact team runtime slot index for a teammate
function findTeamRtSl(calculator: CalcState, resonatorId: string): number | null {
  const activeId = getActResId(calculator)
  if (!activeId) return null

  const actProf = calculator.profiles[activeId]
  if (!actProf) return null

  const tmr = actProf.runtime.teamRuntimes ?? [null, null]
  if (tmr[0]?.id === resonatorId) return 0
  if (tmr[1]?.id === resonatorId) return 1
  return null
}

// materialize one teammate runtime from its compact stored form
function mkTeamMemRtF(
    calculator: CalcState,
    slotIndex: number,
): ResRuntime | null {
  const activeId = getActResId(calculator)
  if (!activeId) return null

  const actProf = calculator.profiles[activeId]
  if (!actProf) return null

  const tmr = (actProf.runtime.teamRuntimes ?? [null, null])[slotIndex]
  if (!tmr) return null

  const seed = getResSeedBy(tmr.id)
  if (!seed) return null

  return normRtNegFfc(matTeamMemFr(
    seed,
    tmr,
    actProf.runtime.local.controls,
    actProf.runtime.local.combat,
    mkActTeamSlt(calculator),
  ))
}

// build a full runtime for a resonator from calculator state
export function mkRtFromProf(
    calculator: CalcState,
    resonatorId: string,
): ResRuntime | null {
  const workspace = mkWorkRtBndl(calculator)
  if (workspace.actRt?.id === resonatorId) {
    return workspace.actRt
  }

  const workPart = workspace.partRtsById[resonatorId]
  if (workPart) {
    return workPart
  }

  const slotId = findSlotIdFo(calculator, resonatorId)
  if (!slotId) {
    return null
  }

  // teammates are materialized from the active profile's compact team runtimes
  if (slotId !== 'active') {
    const slotIndex = findTeamRtSl(calculator, resonatorId)
    if (slotIndex === null) return null
    return mkTeamMemRtF(calculator, slotIndex)
  }

  const seed = getResSeedBy(resonatorId)
  const profile = calculator.profiles[resonatorId]
  if (!seed || !profile) {
    return null
  }

  return normRtNegFfc(matRtFromPro({
    seed,
    profile,
    slotId: 'active',
    localState: profile.runtime.local,
    teamSlots: mkActTeamSlt(calculator),
    rotation: profile.runtime.rotation,
  }))
}

// build a normalized initialized runtime view for a profile
export function mkInitRtView(
    calculator: CalcState,
    resonatorId: string,
): ResRuntime | null {
  const seed = getResSeedBy(resonatorId)
  const profile = calculator.profiles[resonatorId]
  if (!seed || !profile) {
    return null
  }

  return normRtNegFfc(matRtFromPro({
    seed,
    profile,
    slotId: 'active',
    localState: profile.runtime.local,
    teamSlots: normProfTeam(resonatorId, profile.runtime.team),
    rotation: profile.runtime.rotation,
  }))
}

// build the active runtime
export function mkActRt(calculator: CalcState): ResRuntime | null {
  return mkWorkRtBndl(calculator).actRt
}

// build a lookup of all active participant runtimes
export function mkPartRtLkp(calculator: CalcState): Record<string, ResRuntime> {
  return mkWorkRtBndl(calculator).partRtsById
}

// build a participant runtime lookup from one runtime and optional fallbacks
export function makeRuntimeMap(
    runtime: ResRuntime,
    fllbRntmById: Record<string, ResRuntime> = {},
): Record<string, ResRuntime> {
  const runtimes: Record<string, ResRuntime> = {
    [runtime.id]: runtime,
  }

  for (const memberId of runtime.build.team.slice(1)) {
    if (!memberId) {
      continue
    }

    const compactRuntime = (runtime.teamRuntimes ?? [null, null]).find((entry) => entry?.id === memberId) ?? null
    if (compactRuntime) {
      const seed = getResSeedBy(memberId)
      if (seed) {
        runtimes[memberId] = matTeamMemFr(
          seed,
          compactRuntime,
          runtime.state.controls,
          runtime.state.combat,
          runtime.build.team,
        )
        runtimes[memberId] = normRtNegFfc(runtimes[memberId])
        continue
      }
    }

    const fllbRt = fllbRntmById[memberId]
    if (fllbRt) {
      runtimes[memberId] = fllbRt
    }
  }

  return runtimes
}

// build initialized runtime views for every stored profile
export function mkInitRtLkp(calculator: CalcState): Record<string, ResRuntime> {
  const runtimes: Record<string, ResRuntime> = {}

  for (const resonatorId of Object.keys(calculator.profiles)) {
    const runtime = mkInitRtView(calculator, resonatorId)
    if (runtime) {
      runtimes[resonatorId] = runtime
    }
  }

  return runtimes
}

// build the lightweight team member runtime view used by teammate editing
export function mkTeamMemRtV(
    calculator: CalcState,
    resonatorId: string,
): TeamMemRtVie | null {
  const slotIndex = findTeamRtSl(calculator, resonatorId)
  if (slotIndex === null) return null

  const activeId = getActResId(calculator)
  if (!activeId) return null

  const actProf = calculator.profiles[activeId]
  if (!actProf) return null

  const tmr = (actProf.runtime.teamRuntimes ?? [null, null])[slotIndex]
  if (!tmr) return null

  // extract namespaced controls from the active profile controls
  const prefix = `team:${tmr.id}:`
  const controls: Record<string, boolean | number | string> = {}
  for (const key of Object.keys(actProf.runtime.local.controls)) {
    if (key.startsWith(prefix)) {
      controls[key.slice(prefix.length)] = actProf.runtime.local.controls[key]
    }
  }

  return {
    id: resonatorId,
    base: {
      sequence: tmr.base.sequence,
    },
    build: {
      weapon: catTmWpnAtk(tmr.build.weapon, 90),
      echoes: tmr.build.echoes,
    },
    state: {
      controls,
      manualBuffs: cloneBuffs(tmr.manualBuffs ?? makeCustomBuff()),
      combat: { ...actProf.runtime.local.combat },
    },
  }
}

// build a lookup of all teammate runtime views
export function mkTeamMemRtL(calculator: CalcState): Record<string, TeamMemRtVie> {
  const runtimes: Record<string, TeamMemRtVie> = {}
  const activeId = getActResId(calculator)
  if (!activeId) return runtimes

  const actProf = calculator.profiles[activeId]
  if (!actProf) return runtimes

  const tmRuntimes = actProf.runtime.teamRuntimes ?? [null, null]
  for (let i = 0; i < 2; i += 1) {
    const tmr = tmRuntimes[i]
    if (!tmr) continue
    const view = mkTeamMemRtV(calculator, tmr.id)
    if (view) {
      runtimes[tmr.id] = view
    }
  }

  return runtimes
}

// write a teammate runtime back into the active profile team runtime storage
function applyTeam(
    calculator: CalcState,
    resonatorId: string,
    runtime: ResRuntime,
): CalcState {
  const activeId = getActResId(calculator)
  if (!activeId) return calculator

  const actProf = calculator.profiles[activeId]
  if (!actProf) return calculator

  const slotIndex = findTeamRtSl(calculator, resonatorId)
  if (slotIndex === null) return calculator
  const previousTmr = (actProf.runtime.teamRuntimes ?? [null, null])[slotIndex]
  const nextRuntime = maxEchoIfChg(runtime, previousTmr?.build.echoes)

  // build updated compact team member runtime
  const updatedTmr: TeamMemRt = {
    id: resonatorId,
    base: {
      sequence: nextRuntime.base.sequence,
    },
    build: {
      weapon: catTmWpnAtk(nextRuntime.build.weapon, 90),
      echoes: nextRuntime.build.echoes,
    },
    manualBuffs: cloneBuffs(nextRuntime.state.manualBuffs),
  }

  // update team runtimes array
  const nextTeamRuns = [...(actProf.runtime.teamRuntimes ?? [null, null])] as [
        TeamMemRt | null,
        TeamMemRt | null,
  ]
  nextTeamRuns[slotIndex] = updatedTmr

  // replace old namespaced controls with the new ones
  const prefix = `team:${resonatorId}:`
  const nextControls: Record<string, boolean | number | string> = {}
  for (const [key, value] of Object.entries(actProf.runtime.local.controls)) {
    if (!key.startsWith(prefix)) {
      nextControls[key] = value
    }
  }
  for (const [key, value] of Object.entries(nextRuntime.state.controls)) {
    nextControls[`${prefix}${key}`] = value
  }

  // derive team slots from compact team runtimes
  const nextTeam: TeamSlots = [activeId, nextTeamRuns[0]?.id ?? null, nextTeamRuns[1]?.id ?? null]

  return {
    ...calculator,
    profiles: {
      ...calculator.profiles,
      [activeId]: {
        ...actProf,
        runtime: {
          ...actProf.runtime,
          local: {
            ...actProf.runtime.local,
            controls: nextControls,
          },
          team: nextTeam,
          teamRuntimes: nextTeamRuns,
        },
      },
    },
  }
}

// reconcile compact team runtimes to match normalized team slots
function rcncTeamRntm(
    team: TeamSlots,
    current: [TeamMemRt | null, TeamMemRt | null],
): [TeamMemRt | null, TeamMemRt | null] {
  const result: [TeamMemRt | null, TeamMemRt | null] = [null, null]

  for (let i = 0; i < 2; i += 1) {
    const memberId = team[i + 1]
    if (!memberId) {
      result[i] = null
      continue
    }

    // keep the existing entry if it still matches this slot
    if (current[i]?.id === memberId) {
      result[i] = current[i]
      continue
    }

    // teammate may have swapped positions
    const otherIndex = 1 - i
    if (current[otherIndex]?.id === memberId) {
      result[i] = current[otherIndex]
      continue
    }

    // create a new compact runtime for a newly added teammate
    const seed = getResSeedBy(memberId)
    if (seed) {
      result[i] = makeTeamMember(seed)
    }
  }

  return result
}

// apply a runtime back into calculator persisted state
export function applyRtToCal(
    calculator: CalcState,
    resonatorId: string,
    runtime: ResRuntime,
): CalcState {
  const slotId = findSlotIdFo(calculator, resonatorId)
  if (!slotId) {
    return calculator
  }

  // teammates write into the active profile team runtime storage
  if (slotId !== 'active') {
    return applyTeam(calculator, resonatorId, runtime)
  }

  // active resonator writes directly into its own profile
  const nrmlRtTeam = normProfTeam(runtime.id, runtime.build.team)
  const xstnRt = calculator.profiles[resonatorId]?.runtime
  const nextRuntime = maxEchoIfChg(runtime, xstnRt?.build.echoes)

  const fllbRt = {
    progression: {
      level: 1,
      sequence: 0,
      skillLevels: mkDefSkllLvl(),
      traceNodes: makeTraceNode(),
    },
    build: {
      weapon: nextRuntime.build.weapon,
      echoes: nextRuntime.build.echoes,
    },
    local: mkLclSttFrom(nextRuntime.state, xstnRt?.local),
    routing: cloneSlotRml(xstnRt?.routing),
    team: nrmlRtTeam,
    rotation: cloneRotation(nextRuntime.rotation),
    teamRuntimes: rcncTeamRntm(nrmlRtTeam, nextRuntime.teamRuntimes ?? [null, null]),
  }

  const nextProfiles = {
    ...calculator.profiles,
    [resonatorId]: {
      ...(calculator.profiles[resonatorId] ?? {
        resonatorId,
        runtime: fllbRt,
      }),
      runtime: {
        ...(xstnRt ?? fllbRt),
        progression: {
          level: nextRuntime.base.level,
          sequence: nextRuntime.base.sequence,
          skillLevels: cloneSkllLvl(nextRuntime.base.skillLevels),
          traceNodes: cloneTrcNode(nextRuntime.base.traceNodes),
        },
        build: {
          weapon: cloneWpnMkSt(nextRuntime.build.weapon),
          echoes: nextRuntime.build.echoes,
        },
        local: mkLclSttFrom(nextRuntime.state, xstnRt?.local),
        routing: cloneSlotRml(xstnRt?.routing),
        team: nrmlRtTeam,
        rotation: cloneRotation(nextRuntime.rotation),
        teamRuntimes: rcncTeamRntm(
            nrmlRtTeam,
            nextRuntime.teamRuntimes ?? xstnRt?.teamRuntimes ?? [null, null],
        ),
      },
    },
  }

  return {
    ...calculator,
    profiles: nextProfiles,
    session: {
      ...calculator.session,
      activeResonatorId: nrmlRtTeam[0] ?? resonatorId,
    },
  }
}
