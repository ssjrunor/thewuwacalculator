/*
  Author: Runor Ewhro
  description: defines canonical scenario mutations for members, routing,
               targets, combat state, and environment effects.
*/

import type { AppStore } from './store'
import type { StoreSliceContext } from './storeContracts'
import { nextScenarioId, replaceScenarioInWorkspace, selectScenarioInState } from './scenarioStoreHelpers'
import {
  contextScenarioMember, instantiateCombatScenario, makeScenarioTeam,
  reviseCombatEnvironment, reviseCombatScenario, scenarioMemberIndex,
  type CombatScenario, type CombatScenarioId,
} from '@/domain/entities/combatScenario'
import {
  addScenario, replaceScenario, scenarioIdForContextResonator, selectScenario,
} from '@/domain/entities/scenarioLibrary'
import {
  insertScenarioTeamMember, removeScenarioTeamMember, replaceScenarioTeamMember,
} from '@/engine/runtime/scenarioMembers'
import { convertMemberRoverGender, convertScenarioRoverGender } from './roverGenderConversion'
import { roverIdForGender } from '@/domain/entities/roverGender'
import { captureScenarioOtherTargets } from '@/engine/runtime/scenarioEffectTargets'

interface ScenarioSliceContext extends Pick<StoreSliceContext, 'get' | 'persistedSet'> {
  deferForData: (ids: string[], action: () => void, key?: string) => boolean
  scenarioDataIds: (scenarioId: CombatScenarioId) => string[]
}

export type ScenarioActionNames = 'applyScenarioSnapshot' | 'commitScenarioConfig' | 'selectContextResonator' | 'updateScenarioMember' | 'replaceScenarioMember' | 'swapScenarioMembers' | 'insertScenarioMember' | 'removeScenarioMember' | 'moveScenarioMember' | 'setScenarioRouting' | 'setScenarioTarget' | 'setScenarioCombatState' | 'setScenarioInitialOnField' | 'setScenarioContextMember' | 'upsertEnvironmentManualEffect' | 'removeEnvironmentManualEffect' | 'setEnvironmentTargetModifiers'

export function createScenarioActions({ get, persistedSet, deferForData, scenarioDataIds }: ScenarioSliceContext): Pick<AppStore, ScenarioActionNames> {
  return {
  applyScenarioSnapshot: (source) => {
    const normalizedSource = convertScenarioRoverGender(source, get().ui.preferences.roverGender)
    const contextResonatorId = contextScenarioMember(normalizedSource).resonatorId
    const current = get()
    const existingId = scenarioIdForContextResonator(current.combat, contextResonatorId)
    const id = existingId ?? nextScenarioId(current.combat)
    persistedSet(['combat.workspace'], (state) => {
      const latestId = scenarioIdForContextResonator(state.combat, contextResonatorId)
      const targetId = latestId ?? id
      const scenario = instantiateCombatScenario(normalizedSource, targetId)
      const combat = latestId
        ? replaceScenario(state.combat, scenario)
        : addScenario(state.combat, scenario)
      return {
        ...state,
        combat: selectScenario(combat, targetId),
      }
    }, { historyLabel: existingId ? 'Loaded Scenario' : 'Added Context Scenario' })
    return id
  },

  commitScenarioConfig: (scenarioId, updater, historyLabel = 'Updated Configuration') => {
    persistedSet(['combat.workspace'], (state) => {
      const current = state.combat.scenariosById[scenarioId]
      if (!current) return state

      const next = updater(current)
      if (next === current) return state

      return replaceScenarioInWorkspace(state, scenarioId, {
        ...next,
        id: scenarioId,
        revision: current.revision + 1,
      })
    }, { historyLabel })
  },

  selectContextResonator: (resonatorId) => {
    resonatorId = roverIdForGender(resonatorId, get().ui.preferences.roverGender)
    const id = scenarioIdForContextResonator(get().combat, resonatorId)
    if (id && deferForData(scenarioDataIds(id), () => get().selectContextResonator(resonatorId), 'selection')) return
    persistedSet(['combat.workspace'], (state) => {
      const scenarioId = scenarioIdForContextResonator(state.combat, resonatorId)
      if (!scenarioId || scenarioId === state.combat.selectedScenarioId) return state
      return selectScenarioInState(state, scenarioId)
    }, { historyLabel: 'Changed Context Resonator' })
  },

  updateScenarioMember: (scenarioId, memberId, updater) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const index = scenarioMemberIndex(scenario, memberId)
      if (index < 0) return state
      const previous = scenario.team.members[index]
      const next = updater(structuredClone(previous))
      if (next === previous || next.id !== previous.id) return state
      const members = [...scenario.team.members]
      members[index] = next
      let team: CombatScenario['team']
      try {
        team = makeScenarioTeam(members)
      } catch {
        return state
      }
      return replaceScenarioInWorkspace(state, scenarioId, captureScenarioOtherTargets(reviseCombatScenario(scenario, { team }), scenario))
    }, { historyLabel: 'Updated Team Member' })
  },

  replaceScenarioMember: (scenarioId, memberId, member) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const normalizedMember = convertMemberRoverGender(member, state.ui.preferences.roverGender)
      const next = replaceScenarioTeamMember(scenario, memberId, normalizedMember)
      return next === scenario ? state : replaceScenarioInWorkspace(state, scenarioId, next)
    }, { historyLabel: 'Updated Team Member' })
  },

  swapScenarioMembers: (scenarioId, leftMemberId, rightMemberId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const left = scenarioMemberIndex(scenario, leftMemberId)
      const right = scenarioMemberIndex(scenario, rightMemberId)
      if (left < 0 || right < 0 || left === right) return state
      const members = [...scenario.team.members]
      ;[members[left], members[right]] = [members[right], members[left]]
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatScenario(scenario, {
        team: makeScenarioTeam(members),
      }))
    }, { historyLabel: 'Swapped Team Members' })
  },

  insertScenarioMember: (scenarioId, index, member) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const normalizedMember = convertMemberRoverGender(member, state.ui.preferences.roverGender)
      const next = insertScenarioTeamMember(scenario, index, normalizedMember)
      return next === scenario ? state : replaceScenarioInWorkspace(state, scenarioId, next)
    }, { historyLabel: 'Added Team Member' })
  },

  removeScenarioMember: (scenarioId, memberId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const next = removeScenarioTeamMember(scenario, memberId)
      return next === scenario ? state : replaceScenarioInWorkspace(state, scenarioId, next)
    }, { historyLabel: 'Removed Team Member' })
  },

  moveScenarioMember: (scenarioId, memberId, index) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const from = scenarioMemberIndex(scenario, memberId)
      if (from < 0) return state
      const to = Math.max(0, Math.min(index, scenario.team.members.length - 1))
      if (from === to) return state
      const members = [...scenario.team.members]
      const [member] = members.splice(from, 1)
      members.splice(to, 0, member)
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatScenario(scenario, {
        team: makeScenarioTeam(members),
      }))
    }, { historyLabel: 'Reordered Team' })
  },

  setScenarioRouting: (scenarioId, sourceMemberId, routeId, targetMemberId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const ids = new Set(scenario.team.members.map((member) => member.id))
      if (!ids.has(sourceMemberId) || (targetMemberId !== null && !ids.has(targetMemberId))) {
        return state
      }
      const current = scenario.environment.routing.bySourceMemberId[sourceMemberId]?.[routeId] ?? null
      if (current === targetMemberId) return state
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatEnvironment(scenario, {
        routing: {
          bySourceMemberId: {
            ...scenario.environment.routing.bySourceMemberId,
            [sourceMemberId]: {
              ...scenario.environment.routing.bySourceMemberId[sourceMemberId],
              [routeId]: targetMemberId,
              },
            },
          },
      }))
    }, { historyLabel: 'Updated Target Selection' })
  },

  setScenarioTarget: (scenarioId, target) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      return scenario ? replaceScenarioInWorkspace(
      state, scenarioId,
      reviseCombatScenario(scenario, {
        target: structuredClone(target),
      }),
      ) : state
    }, { historyLabel: 'Updated Combat Target' })
  },

  setScenarioCombatState: (scenarioId, combatState) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      return scenario ? replaceScenarioInWorkspace(
      state, scenarioId,
      reviseCombatEnvironment(scenario, {
        combatState: structuredClone(combatState),
      }),
      ) : state
    }, { historyLabel: 'Updated Combat State' })
  },

  setScenarioInitialOnField: (scenarioId, memberId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      if (!scenario.team.members.some((member) => member.id === memberId)
        || scenario.initialOnFieldMemberId === memberId) return state
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatScenario(captureScenarioOtherTargets(scenario), {
        initialOnFieldMemberId: memberId,
      }))
    }, { historyLabel: 'Changed Initial On-field Member' })
  },

  setScenarioContextMember: (scenarioId, memberId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      if (scenario.contextMemberId === memberId
        || !scenario.team.members.some((member) => member.id === memberId)) return state
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatScenario(scenario, {
        contextMemberId: memberId,
      }))
    }, { historyLabel: 'Changed Scenario Context Member' })
  },

  upsertEnvironmentManualEffect: (scenarioId, effect) => {
    if (!effect.id.trim()) return
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      if (effect.selector.kind === 'members') {
        const members = new Set(scenario.team.members.map((member) => member.id))
        if (effect.selector.memberIds.length === 0
          || effect.selector.memberIds.some((id) => !members.has(id))) return state
      }
      const manualEffects = [...scenario.environment.manualEffects]
      const index = manualEffects.findIndex((candidate) => candidate.id === effect.id)
      const nextEffect = structuredClone(effect)
      if (index >= 0) manualEffects[index] = nextEffect
      else manualEffects.push(nextEffect)
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatEnvironment(scenario, {
        manualEffects,
      }))
    }, { historyLabel: 'Updated Environment Effect' })
  },

  removeEnvironmentManualEffect: (scenarioId, effectId) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      if (!scenario) return state
      const manualEffects = scenario.environment.manualEffects.filter(
        (effect) => effect.id !== effectId,
      )
      if (manualEffects.length === scenario.environment.manualEffects.length) return state
      return replaceScenarioInWorkspace(state, scenarioId, reviseCombatEnvironment(scenario, {
        manualEffects,
      }))
    }, { historyLabel: 'Removed Environment Effect' })
  },

  setEnvironmentTargetModifiers: (scenarioId, modifiers) => {
    persistedSet(['combat.workspace'], (state) => {
      const scenario = state.combat.scenariosById[scenarioId]
      return scenario ? replaceScenarioInWorkspace(
      state, scenarioId,
      reviseCombatEnvironment(scenario, {
        targetModifiers: structuredClone(modifiers),
      }),
      ) : state
    }, { historyLabel: 'Updated Target Modifiers' })
  },

  }
}
