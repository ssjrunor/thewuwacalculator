/*
  Author: Runor Ewhro
  description: defines resonator, teammate, target, and profile mutations against canonical scenario state.
*/

import type { AppStore } from './store'
import type { StoreSliceContext } from './storeContracts'
import type { ResonatorId, ResRuntime } from '@/domain/entities/runtime'
import type { PckrFreqUpd } from '@/domain/entities/appState'
import type { ResProf } from '@/domain/entities/profile'
import type { CombatScenarioId, CombatScenario } from '@/domain/entities/combatScenario'
import type { ScenarioWorkspace } from '@/domain/entities/scenarioLibrary'
import { nextScenarioId, selectScenarioInState } from './scenarioStoreHelpers'
import { collectResonatorIds } from '@/application/persistence/resonatorScope'
import { splitScopedTargetOwnerKey } from '@/domain/gameData/targetRouting'
import { makeScenarioTeam, reviseCombatEnvironment, reviseCombatScenario, contextScenarioMember } from '@/domain/entities/combatScenario'
import { addScenario, copyScenarioRecords, replaceScenario, scenarioIdForContextResonator, selectedCombatScenario, summarizeScenario } from '@/domain/entities/scenarioLibrary'
import { cloneRotationNodes } from '@/domain/entities/inventoryStorage'
import { cloneOptInventorySelection } from '@/domain/entities/profile'
import { makeScenarioMemberFromProfile, makeScenarioFromProfiles, makeResProfile, makeSuggest, DEF_RES_ID } from '@/engine/runtime/defaults'
import { mkRtUpdHistL, mkTeamMemRtU } from '@/application/state/history'
import { applyPckrFre, mkProfPckrFr, mkRtPckrFreq, mkTeamMemVie } from '@/engine/runtime/pickerFrequency'
import { applyRuntimeToSimulation, materializeScenarioRuntime, mkTeamMemRtV, getActResId } from '@/engine/runtime/runtimeAdapters'
import { resSdsById } from '@/data/catalog/resonatorSeedService'
import { cloneResProf, cloneRtSttVl } from '@/engine/runtime/runtimeCloning'
import { catWpnAtk } from '@/engine/runtime/weaponState'
import { getSuggsSttF } from '@/application/state/storeHelpers'
import { roverIdForGender } from '@/domain/entities/roverGender'
import { convertScenarioRoverGender } from './roverGenderConversion'

function applyCombatScenario(
  combat: AppStore['combat'],
  scenario: CombatScenario,
): Pick<AppStore, 'combat'> {
  return { combat: replaceScenario(combat, scenario) }
}

function replaceScenarioInState(
  state: AppStore,
  scenario: CombatScenario,
): AppStore {
  return {
    ...state,
    ...applyCombatScenario(state.combat, scenario),
  }
}

function applyUiFreqP(
    state: AppStore,
    updates: PckrFreqUpd[],
): AppStore {
  if (updates.length === 0) {
    return state
  }

  const activeResonatorId = getActResId(selectedCombatScenario(state.combat))
  const contextualUpdates = updates.map((update): PckrFreqUpd => {
    if (update.activeResonatorId !== undefined) {
      return update
    }

    if (update.bucket === 'resonator' || (update.bucket === 'teamResonator' && update.slot === 'active')) {
      return {
        ...update,
        activeResonatorId: null,
      }
    }

    return {
      ...update,
      activeResonatorId,
    }
  })
  const nextFreq = applyPckrFre(state.ui.itemFreq, contextualUpdates)
  if (nextFreq === state.ui.itemFreq) {
    return state
  }

  return {
    ...state,
    ui: {
      ...state.ui,
      itemFreq: nextFreq,
    },
  }
}

interface ResonatorSliceContext extends Pick<StoreSliceContext, 'get' | 'persistedSet'> {
  deferForData: (ids: string[], action: () => void, key?: string) => boolean
  scenarioDataIds: (scenarioId: CombatScenarioId) => string[]
}

export type ResonatorActionNames = 'bumpPickFr' | 'setEnemy' | 'setActRes' | 'actRes' | 'swRes' | 'delResProf' | 'delResProfs' | 'resetRes' | 'loadResProf' | 'upsertRes' | 'ensResRt' | 'ensTeamRt' | 'updScenarioResRt' | 'updResRt' | 'updTeamView' | 'updActRt' | 'persistRotationProgram' | 'updResSuggs' | 'updActSuggs' | 'updWpnSuggs' | 'updResConds' | 'updResOptInv' | 'updActConds' | 'setResTgt'

export function createResonatorActions({ get, persistedSet, deferForData, scenarioDataIds }: ResonatorSliceContext): Pick<AppStore, ResonatorActionNames> {
  const bumpPckrFreq = (updates: PckrFreqUpd[]) => {
    if (updates.length === 0) {
      return
    }

    persistedSet(['ui.layout'], (state) => applyUiFreqP(state, updates), {
      recHist: false,
    })
  }

  const psrtResPrflI = (
    profiles: ResProf[],
    historyLabel = profiles.length === 1 ? 'Loaded Resonator Profile' : 'Pasted Resonator Profiles',
  ) => {
    if (profiles.length === 0) {
      return
    }
    const ids = collectResonatorIds(profiles)
    const gender = get().ui.preferences.roverGender
    if (deferForData([...new Set(ids.flatMap((id) => [id, roverIdForGender(id, gender)]))], () => psrtResPrflI(profiles, historyLabel))) return

    persistedSet(['combat.workspace', 'simulation.suggestions', 'ui.layout'], (state) => {
      let workspace: ScenarioWorkspace = state.combat
      let nextSuggsByR = state.simulation.suggestionsByResonatorId

      for (const imported of profiles) {
        const profile = cloneResProf(imported)
        const targetResonatorId = roverIdForGender(profile.resonatorId, state.ui.preferences.roverGender)
        const existingId = scenarioIdForContextResonator(workspace, targetResonatorId)
        const scenarioId = existingId ?? nextScenarioId(workspace)
        const existingScenario = existingId ? workspace.scenariosById[existingId] : null
        const scenario: CombatScenario = convertScenarioRoverGender({
          ...makeScenarioFromProfiles(
            { [profile.resonatorId]: profile },
            {
              activeResonatorId: profile.resonatorId,
              enemyProfile: existingScenario?.target ?? selectedCombatScenario(state.combat).target,
            },
            (existingScenario?.revision ?? 0) + 1,
            profile.resonatorId,
          ),
          id: scenarioId,
        }, state.ui.preferences.roverGender)

        if (existingScenario) {
          workspace = replaceScenario(workspace, scenario)
        } else {
          workspace = addScenario(workspace, scenario, false)
        }

        if (!nextSuggsByR[targetResonatorId]) {
          if (nextSuggsByR === state.simulation.suggestionsByResonatorId) {
            nextSuggsByR = { ...state.simulation.suggestionsByResonatorId }
          }

          nextSuggsByR[targetResonatorId] = makeSuggest()
        }
      }

      const nextState = {
        ...state,
        combat: workspace,
        simulation: {
          ...state.simulation,
          suggestionsByResonatorId: nextSuggsByR,
        },
      }
      return applyUiFreqP(nextState, mkProfPckrFr(profiles))
    }, { historyLabel })
  }

  const dltResPrflIm = (
    resonatorIds: ResonatorId[],
    prfrNextResI: ResonatorId | null = null,
    historyLabel?: string,
  ) => {
    if (resonatorIds.length === 0) {
      return
    }

    persistedSet([
      'combat.workspace',
      'simulation.suggestions',
    ], (state) => {
      const nextSuggsByR = { ...state.simulation.suggestionsByResonatorId }
      const removedResonatorIds = new Set(resonatorIds)
      const removedScenarioIds = state.combat.order.filter((scenarioId) => {
        const contextId = state.combat.summaryById?.[scenarioId]?.resonatorId
          ?? contextScenarioMember(state.combat.scenariosById[scenarioId]).resonatorId
        return Boolean(contextId && removedResonatorIds.has(contextId))
      })
      if (removedScenarioIds.length === 0) return state

      const removedScenarioSet = new Set(removedScenarioIds)
      let order = state.combat.order.filter((scenarioId) => !removedScenarioSet.has(scenarioId))
      const scenariosById = copyScenarioRecords(state.combat.scenariosById)
      const summaryById = state.combat.summaryById
        ? { ...state.combat.summaryById }
        : undefined
      for (const scenarioId of removedScenarioIds) delete scenariosById[scenarioId]
      for (const scenarioId of removedScenarioIds) {
        if (summaryById) delete summaryById[scenarioId]
      }

      if (order.length === 0) {
        const fallbackSeed = resSdsById[DEF_RES_ID]
        if (!fallbackSeed) return state
        const fallbackProfile = makeResProfile(fallbackSeed, {
          maxed: state.ui.preferences.maxResOnInit,
        })
        const fallbackId = nextScenarioId(state.combat)
        const fallbackScenario: CombatScenario = {
          ...makeScenarioFromProfiles(
            { [fallbackSeed.id]: fallbackProfile },
            {
              activeResonatorId: fallbackSeed.id,
              enemyProfile: selectedCombatScenario(state.combat).target,
            },
            0,
            fallbackSeed.id,
          ),
          id: fallbackId,
        }
        scenariosById[fallbackId] = fallbackScenario
        if (summaryById) summaryById[fallbackId] = summarizeScenario(fallbackScenario)
        order = [fallbackId]
        nextSuggsByR[fallbackSeed.id] ??= makeSuggest()
      }

      const preferredScenarioId = prfrNextResI
        ? order.find((scenarioId) => (
            (summaryById?.[scenarioId]?.resonatorId
              ?? contextScenarioMember(scenariosById[scenarioId]).resonatorId) === prfrNextResI
          ))
        : null
      const selectedScenarioId = !removedScenarioSet.has(state.combat.selectedScenarioId)
        ? state.combat.selectedScenarioId
        : preferredScenarioId ?? order[0]
      const combat: ScenarioWorkspace = {
        selectedScenarioId,
        order,
        scenariosById,
        ...(summaryById ? { summaryById } : {}),
      }
      const remainingPrimaryIds = new Set(order.map((scenarioId) => (
        summaryById?.[scenarioId]?.resonatorId
          ?? contextScenarioMember(scenariosById[scenarioId]).resonatorId
      )))
      for (const resonatorId of removedResonatorIds) {
        if (!remainingPrimaryIds.has(resonatorId)) delete nextSuggsByR[resonatorId]
      }

      return {
        ...state,
        combat,
        simulation: {
          ...state.simulation,
          suggestionsByResonatorId: nextSuggsByR,
        },
      }
    }, {
      historyLabel: historyLabel
        ?? (resonatorIds.length === 1 ? 'Deleted Resonator Profile' : `Deleted ${resonatorIds.length} Resonator Profiles`),
    })
  }

  return {
  bumpPickFr: (updates) => {
    bumpPckrFreq(Array.isArray(updates) ? updates : [updates])
  },

  setEnemy: (enemyProfile) => {
    persistedSet(['combat.workspace', 'ui.layout'], (state) => {
      const scenario = selectedCombatScenario(state.combat)
      const nextState = replaceScenarioInState(state, reviseCombatScenario(scenario, {
        target: enemyProfile,
      }))

      return enemyProfile.id && enemyProfile.id !== scenario.target.id
        ? applyUiFreqP(nextState, [{
          bucket: 'enemy',
          ids: [enemyProfile.id],
        }])
        : nextState
    }, { historyLabel: 'Updated Enemy Profile' })
  },

  setActRes: (resonatorId) => {
    resonatorId = roverIdForGender(resonatorId, get().ui.preferences.roverGender)
    const id = scenarioIdForContextResonator(get().combat, resonatorId)
    if (id && deferForData(scenarioDataIds(id), () => get().setActRes(resonatorId), 'selection')) return
    if (getActResId(selectedCombatScenario(get().combat)) === resonatorId) {
      return
    }

    persistedSet(['combat.workspace', 'ui.layout'], (state) => {
      const scenarioId = scenarioIdForContextResonator(state.combat, resonatorId)
      if (!scenarioId) return state
      return applyUiFreqP(selectScenarioInState(state, scenarioId), [
      {
        bucket: 'resonator',
        ids: [resonatorId],
      },
      {
        bucket: 'teamResonator',
        slot: 'active',
        ids: [resonatorId],
      },
      ])
    }, { historyLabel: 'Changed Active Resonator' })
  },

  actRes: (seed) => {
    seed = resSdsById[roverIdForGender(seed.id, get().ui.preferences.roverGender)] ?? seed
    const existingId = scenarioIdForContextResonator(get().combat, seed.id)
    if (deferForData(existingId ? scenarioDataIds(existingId) : [seed.id], () => get().actRes(seed), 'selection')) return
    persistedSet(['combat.workspace', 'simulation.suggestions', 'ui.layout'], (state) => {
      const existingScenarioId = scenarioIdForContextResonator(state.combat, seed.id)
      if (existingScenarioId === state.combat.selectedScenarioId) {
        return state
      }
      let nextState: AppStore
      if (existingScenarioId) {
        nextState = selectScenarioInState(state, existingScenarioId)
      } else {
        const profile = makeResProfile(seed, { maxed: state.ui.preferences.maxResOnInit })
        const scenarioId = nextScenarioId(state.combat)
        const scenario: CombatScenario = {
          ...makeScenarioFromProfiles(
            { [seed.id]: profile },
            {
              activeResonatorId: seed.id,
              enemyProfile: selectedCombatScenario(state.combat).target,
            },
            0,
            seed.id,
          ),
          id: scenarioId,
        }
        const combat = addScenario(state.combat, scenario)
        nextState = {
          ...state,
          combat,
        }
      }

      nextState = {
        ...nextState,
        simulation: {
          ...nextState.simulation,
          suggestionsByResonatorId: nextState.simulation.suggestionsByResonatorId[seed.id]
            ? nextState.simulation.suggestionsByResonatorId
            : {
              ...nextState.simulation.suggestionsByResonatorId,
              [seed.id]: makeSuggest(),
            },
        },
      }

      return applyUiFreqP(nextState, [
        {
          bucket: 'resonator',
          ids: [seed.id],
        },
        {
          bucket: 'teamResonator',
          slot: 'active',
          ids: [seed.id],
        },
      ])
    }, {
      historyLabel: scenarioIdForContextResonator(get().combat, seed.id)
        ? 'Changed Active Resonator'
        : 'Added Resonator Profile',
    })
  },

  swRes: (resonatorId) => {
    resonatorId = roverIdForGender(resonatorId, get().ui.preferences.roverGender)
    const seed = resSdsById[resonatorId]
    if (!seed) return
    get().actRes(seed)
  },

  delResProf: (resonatorId, prfrNextResI = null) => {
    dltResPrflIm([resonatorId], prfrNextResI, 'Deleted Resonator Profile')
  },

  delResProfs: (resonatorIds, prfrNextResI = null) => {
    dltResPrflIm(resonatorIds, prfrNextResI)
  },

  resetRes: (resonatorId) => {
    if (deferForData([resonatorId], () => get().resetRes(resonatorId), `reset:${resonatorId}`)) return
    const seed = resSdsById[resonatorId]
    if (!seed) return

    persistedSet(['combat.workspace'], (state) => {
      const profile = makeResProfile(seed, { maxed: state.ui.preferences.maxResOnInit })
      const scenario = selectedCombatScenario(state.combat)
      const memberIndex = scenario.team.members.findIndex(
        (member) => member.resonatorId === resonatorId,
      )
      const members = [...scenario.team.members]
      if (memberIndex >= 0) {
        members[memberIndex] = makeScenarioMemberFromProfile(profile)
      }

      return memberIndex >= 0
        ? replaceScenarioInState(state, reviseCombatScenario(scenario, { team: makeScenarioTeam(members) }))
        : state
    }, { historyLabel: 'Reset Resonator' })
  },

  loadResProf: (profile) => {
    psrtResPrflI([profile], 'Loaded Resonator Profile')
  },

  upsertRes: (profiles, historyLabel) => {
    psrtResPrflI(profiles, historyLabel)
  },

  ensResRt: (seed) => {
    seed = resSdsById[roverIdForGender(seed.id, get().ui.preferences.roverGender)] ?? seed
    if (get().simulation.suggestionsByResonatorId[seed.id]) return

    persistedSet(['simulation.suggestions'], (state) => ({
      ...state,
      simulation: {
        ...state.simulation,
        suggestionsByResonatorId: state.simulation.suggestionsByResonatorId[seed.id]
            ? state.simulation.suggestionsByResonatorId
            : {
              ...state.simulation.suggestionsByResonatorId,
              [seed.id]: makeSuggest(),
            },
      },
    }), { historyLabel: 'Added Resonator Profile' })
  },

  ensTeamRt: (seed) => {
    void seed
    // slot assignment now creates teammate runtimes; retain this no-op contract
    // until callers no longer depend on the former eager-initialization api.
  },

  updScenarioResRt: (scenarioId, resonatorId, updater) => {
    if (deferForData(scenarioDataIds(scenarioId), () => get().updScenarioResRt(scenarioId, resonatorId, updater))) return
    const scenario = get().combat.scenariosById[scenarioId]
    if (!scenario) return

    const target = materializeScenarioRuntime(scenario, resonatorId)
    if (!target) return

    const next = updater(target)
    if (next === target) return

    const pickerUpdates = mkRtPckrFreq(target, next)
    persistedSet(
      pickerUpdates.length > 0 ? ['combat.workspace', 'ui.layout'] : ['combat.workspace'],
      (state) => {
      const currentScenario = state.combat.scenariosById[scenarioId]
      if (!currentScenario) return state
      const update = applyRuntimeToSimulation(currentScenario, resonatorId, next, target)
      return applyUiFreqP(replaceScenarioInState(
        state,
        update.scenario,
      ), pickerUpdates)
      }, {
        historyLabel: () => mkRtUpdHistL(target, next),
      },
    )
  },

  updResRt: (resonatorId, updater) => {
    get().updScenarioResRt(get().combat.selectedScenarioId, resonatorId, updater)
  },

  updTeamView: (resonatorId, updater) => {
    const target = mkTeamMemRtV(selectedCombatScenario(get().combat), resonatorId)
    if (!target) return

    const next = updater(target)
    if (next === target) return

    const actRt = materializeScenarioRuntime(selectedCombatScenario(get().combat), resonatorId)
    if (!actRt) {
      return
    }

    const brdgRt: ResRuntime = {
      ...actRt,
      base: {
        ...actRt.base,
        sequence: next.base.sequence,
      },
      build: {
        ...actRt.build,
        weapon: catWpnAtk({
          ...actRt.build.weapon,
          id: next.build.weapon.id,
          rank: next.build.weapon.rank,
        }),
        echoes: next.build.echoes,
      },
      state: cloneRtSttVl(next.state),
    }

    persistedSet(['combat.workspace', 'ui.layout'], (state) => {
      const update = applyRuntimeToSimulation(selectedCombatScenario(state.combat), resonatorId, brdgRt)
      return applyUiFreqP(replaceScenarioInState(
        state,
        update.scenario,
      ), mkTeamMemVie(resonatorId, target, next))
    }, {
      historyLabel: mkTeamMemRtU(target, next),
    })
  },

  updActRt: (updater) => {
    const actResId = getActResId(selectedCombatScenario(get().combat))
    if (!actResId) return
    get().updResRt(actResId, updater)
  },

  persistRotationProgram: (items, ranAt = Date.now()) => {
    const actResId = getActResId(selectedCombatScenario(get().combat))
    const target = actResId
      ? materializeScenarioRuntime(selectedCombatScenario(get().combat), actResId)
      : null
    if (!actResId || !target) return

    const nextItems = cloneRotationNodes(items)
    const nextRanAt = Number.isFinite(ranAt) ? ranAt : Date.now()
    if (
      target.rotation.lastRanAt === nextRanAt
      && JSON.stringify(target.rotation.program) === JSON.stringify(nextItems)
    ) {
      return
    }

    const nextRuntime: ResRuntime = {
      ...target,
      rotation: {
        ...target.rotation,
        program: nextItems,
        lastRanAt: nextRanAt,
      },
    }
    persistedSet(['combat.workspace'], (state) => {
      const update = applyRuntimeToSimulation(
        selectedCombatScenario(state.combat),
        actResId,
        nextRuntime,
      )
      return update.scenario === selectedCombatScenario(state.combat)
        ? state
        : replaceScenarioInState(
          state,
          update.scenario,
        )
    }, { historyLabel: 'Ran Rotation' })
  },

  updResSuggs: (resonatorId, updater) => {
    persistedSet(['simulation.suggestions'], (state) => ({
      ...state,
      simulation: {
        ...state.simulation,
        suggestionsByResonatorId: {
          ...state.simulation.suggestionsByResonatorId,
          [resonatorId]: updater(getSuggsSttF(state, resonatorId)),
        },
      },
    }), { historyLabel: 'Updated Suggestions' })
  },

  updActSuggs: (updater) => {
    const actResId = getActResId(selectedCombatScenario(get().combat))
    if (!actResId) return
    get().updResSuggs(actResId, updater)
  },

  updWpnSuggs: (updater) => {
    persistedSet(['simulation.suggestions'], (state) => ({
      ...state,
      simulation: {
        ...state.simulation,
        weaponSuggests: updater(state.simulation.weaponSuggests),
      },
    }), { historyLabel: 'Updated Weapon Suggestions' })
  },

  updResConds: (resonatorId, updater) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = selectedCombatScenario(state.combat)
      const memberIndex = scenario.team.members.findIndex(
        (member) => member.resonatorId === resonatorId,
      )
      const source = memberIndex >= 0
        ? scenario.team.members[memberIndex].local.setConditionals
        : null
      if (!source) return state
      const nextConditions = updater(source)
      const members = [...scenario.team.members]
      if (memberIndex >= 0) {
        members[memberIndex] = {
          ...members[memberIndex],
          local: { ...members[memberIndex].local, setConditionals: nextConditions },
        }
      }

      return replaceScenarioInState(state, reviseCombatScenario(scenario, {
        team: makeScenarioTeam(members),
      }))
    }, { historyLabel: 'Updated Set Conditionals' })
  },

  updResOptInv: (resonatorId, updater) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = selectedCombatScenario(state.combat)
      const memberIndex = scenario.team.members.findIndex(
        (member) => member.resonatorId === resonatorId,
      )
      const source = memberIndex >= 0
        ? scenario.team.members[memberIndex].local.optimizerInventory
        : null
      if (!source) return state
      const nextInventory = cloneOptInventorySelection(updater(source))
      const members = [...scenario.team.members]
      if (memberIndex >= 0) {
        members[memberIndex] = {
          ...members[memberIndex],
          local: { ...members[memberIndex].local, optimizerInventory: nextInventory },
        }
      }

      return replaceScenarioInState(state, reviseCombatScenario(scenario, {
        team: makeScenarioTeam(members),
      }))
    }, { historyLabel: 'Updated Optimizer Inventory' })
  },

  updActConds: (updater) => {
    const actResId = getActResId(selectedCombatScenario(get().combat))
    if (!actResId) return
    get().updResConds(actResId, updater)
  },

  setResTgt: (resonatorId, ownerKey, tgtResId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = selectedCombatScenario(state.combat)
      const sourceMember = scenario.team.members.find(
        (member) => member.resonatorId === resonatorId,
      )
      const targetMember = tgtResId
        ? scenario.team.members.find((member) => member.resonatorId === tgtResId) ?? null
        : null
      if (!sourceMember || (tgtResId && !targetMember)) return state
      const routeId = splitScopedTargetOwnerKey(ownerKey).ownerKey

      const bySourceMemberId = {
        ...scenario.environment.routing.bySourceMemberId,
        [sourceMember.id]: {
          ...scenario.environment.routing.bySourceMemberId[sourceMember.id],
          [routeId]: targetMember?.id ?? null,
        },
      }

      return replaceScenarioInState(state, reviseCombatEnvironment(scenario, {
        routing: { bySourceMemberId },
      }))
    }, { historyLabel: 'Updated Target Selection' })
  },

  }
}
