/*
  Author: Runor Ewhro
  description: converts paired rover identities in complete scenarios and saved builds.
*/

import type { CombatScenario, CombatScenarioId, DormantScenarioMember, ScenarioTeamMember, TeamMemberId } from '@/domain/entities/combatScenario'
import { contextScenarioMember, makeScenarioTeam } from '@/domain/entities/combatScenario'
import type { SavedArtifactLibrary } from '@/domain/entities/inventoryStorage'
import type { ManualBuffs } from '@/domain/entities/manualBuffs'
import type { HydratedAppState, SimulationState, UiState } from '@/domain/entities/appState'
import type { FormExpr, RotationNode, RotVl, RtChng } from '@/domain/gameData/contracts'
import type { RoverGender } from '@/domain/entities/roverGender'
import { ROVER_PAIRS, roverIdForGender } from '@/domain/entities/roverGender'
import type { ScenarioWorkspace } from '@/domain/entities/scenarioLibrary'
import { summarizeScenario } from '@/domain/entities/scenarioLibrary'
import { makeMemberManualEffect, memberManualEffectId } from '@/engine/runtime/scenarioEnvironment'

/** literal utf-8 size of the serialized data, including its ordinary metadata. */
export function serializedByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function mapSourceKey(value: string, gender: RoverGender): string {
  return value.replace(/(^|[:.@/-])(\d{4})(?=$|[:.@/-])/g, (_, separator: string, id: string) => (
    `${separator}${roverIdForGender(id, gender)}`
  ))
}

function mapChange(change: RtChng, gender: RoverGender): RtChng {
  const mapped = {
    ...change,
    path: mapSourceKey(change.path, gender),
    ...(change.resonatorId ? { resonatorId: roverIdForGender(change.resonatorId, gender) } : {}),
  }
  return mapped.type === 'set' && mapped.path.replace(/^runtime\./, '') === 'rotation.activeResonatorId' && typeof mapped.value === 'string'
    ? { ...mapped, value: roverIdForGender(mapped.value, gender) } : mapped
}

export function convertRotationNodesRoverGender(nodes: RotationNode[], gender: RoverGender): RotationNode[] {
  return gender === 'both' ? nodes : nodes.map((node) => mapNode(node, gender))
}

export function convertManualBuffsRoverGender(buffs: ManualBuffs, gender: RoverGender): ManualBuffs {
  if (gender === 'both') return buffs
  return {
    ...buffs,
    modifiers: buffs.modifiers.map((modifier) => modifier.scope === 'skill' && modifier.skillId
      ? { ...modifier, skillId: mapSourceKey(modifier.skillId, gender) } : modifier),
  }
}

function mapRotationValue(value: RotVl, gender: RoverGender): RotVl {
  if (typeof value === 'number' || value.type === 'const') return value
  if (value.type === 'read' || value.type === 'table') return { ...value, path: mapSourceKey(value.path, gender) }
  if (value.type === 'clamp') return { ...value, value: mapRotationValue(value.value, gender) as FormExpr }
  return { ...value, values: value.values.map((child) => mapRotationValue(child, gender) as FormExpr) }
}

function mapNode(node: RotationNode, gender: RoverGender): RotationNode {
  if (node.type === 'note') return node
  const base = {
    ...node,
    ...('resonatorId' in node && node.resonatorId
      ? { resonatorId: roverIdForGender(node.resonatorId, gender) }
      : {}),
  }
  if (base.type === 'feature') return {
    ...base,
    featureId: mapSourceKey(base.featureId, gender),
    ...(base.changes ? { changes: base.changes.map((change) => mapChange(change, gender)) } : {}),
    ...(base.attached ? { attached: {
      conditions: base.attached.conditions.map((attached) => mapNode(attached, gender) as typeof attached),
      features: base.attached.features.map((attached) => mapNode(attached, gender) as typeof attached),
    } } : {}),
  }
  if (base.type === 'condition') return {
    ...base,
    changes: base.changes.map((change) => mapChange(change, gender)),
  }
  if (base.type === 'repeat' || base.type === 'uptime') return {
    ...base,
    ...(base.type === 'repeat' ? { times: mapRotationValue(base.times, gender) } : {}),
    ...(base.ratio !== undefined ? { ratio: mapRotationValue(base.ratio, gender) } : {}),
    ...(base.setup ? { setup: base.setup.map((child) => mapNode(child, gender)) } : {}),
    items: base.items.map((child) => mapNode(child, gender)),
  }
  if (base.type === 'loop' && base.kind === 'start' && base.passForks) return {
    ...base,
    passForks: Object.fromEntries(Object.entries(base.passForks).map(([pass, nodes]) => [
      pass, nodes.map((child) => mapNode(child, gender)),
    ])),
  }
  return base
}

function preferredMember(
  scenario: CombatScenario,
  left: ScenarioTeamMember,
  right: ScenarioTeamMember,
  gender: RoverGender,
): ScenarioTeamMember {
  const leftSize = activeMemberDataSize(scenario, left)
  const rightSize = activeMemberDataSize(scenario, right)
  if (leftSize !== rightSize) return leftSize > rightSize ? left : right
  return roverIdForGender(left.resonatorId, gender) === left.resonatorId ? left : right
}

function memberDataSize(member: ScenarioTeamMember, manualEffect?: DormantScenarioMember['manualEffect']): number {
  return serializedByteSize({ member, manualEffect: manualEffect ?? null })
}

function activeMemberDataSize(scenario: CombatScenario, member: ScenarioTeamMember): number {
  const effect = scenario.environment.manualEffects.find((candidate) => candidate.id === memberManualEffectId(member.id))
  return memberDataSize(member, effect ? {
    enabled: effect.enabled,
    label: effect.label,
    buffs: effect.buffs,
  } : undefined)
}

export function convertMemberRoverGender(member: ScenarioTeamMember, gender: RoverGender): ScenarioTeamMember {
  if (gender === 'both') return member
  return {
    ...member,
    resonatorId: roverIdForGender(member.resonatorId, gender),
    local: {
      ...member.local,
      controls: Object.fromEntries(Object.entries(member.local.controls).map(([key, value]) => [
        mapSourceKey(key, gender), value,
      ])),
    },
  }
}

export function convertScenarioRoverGender(scenario: CombatScenario, gender: RoverGender): CombatScenario {
  if (gender === 'both') return scenario
  const sourceIds = ROVER_PAIRS.map((pair) => gender === 'male' ? pair.female : pair.male)
  if (!sourceIds.some((id) => JSON.stringify(scenario).includes(id))) return scenario
  const winnerByResonatorId = new Map<string, ScenarioTeamMember>()
  const replacedMemberIds = new Map<TeamMemberId, TeamMemberId>()
  for (const member of scenario.team.members) {
    const targetId = roverIdForGender(member.resonatorId, gender)
    const previous = winnerByResonatorId.get(targetId)
    if (!previous) {
      winnerByResonatorId.set(targetId, member)
      continue
    }
    const winner = preferredMember(scenario, previous, member, gender)
    const loser = winner === previous ? member : previous
    winnerByResonatorId.set(targetId, winner)
    replacedMemberIds.set(loser.id, winner.id)
  }
  const dormantSourceByActiveId = new Map<TeamMemberId, DormantScenarioMember>()
  for (const [id, entry] of Object.entries(scenario.dormantMembersByResonatorId ?? {})) {
    const active = winnerByResonatorId.get(roverIdForGender(id, gender))
    if (active && memberDataSize(entry.member, entry.manualEffect) > activeMemberDataSize(scenario, active)) {
      const previous = dormantSourceByActiveId.get(active.id)
      if (!previous || memberDataSize(entry.member, entry.manualEffect) > memberDataSize(previous.member, previous.manualEffect)) {
        dormantSourceByActiveId.set(active.id, entry)
      }
    }
  }
  const mapMemberId = (id: TeamMemberId): TeamMemberId => replacedMemberIds.get(id) ?? id
  const removedManualEffectIds = new Set([...replacedMemberIds.keys()].map(memberManualEffectId))
  const members = scenario.team.members
    .filter((member) => winnerByResonatorId.get(roverIdForGender(member.resonatorId, gender)) === member)
    .map((member) => {
      const source = dormantSourceByActiveId.get(member.id)?.member ?? member
      return convertMemberRoverGender({
        ...source,
        id: member.id,
      }, gender)
    })
  const activeIds = new Set(members.map((member) => member.id))
  const activeResonatorIds = new Set(members.map((member) => member.resonatorId))
  const restoredEffects = new Map([...dormantSourceByActiveId].flatMap(([memberId, entry]) => {
    if (!entry.manualEffect) return []
    const existing = scenario.environment.manualEffects.find((effect) => effect.id === memberManualEffectId(memberId))
    return [[memberManualEffectId(memberId), {
      ...(existing ?? makeMemberManualEffect(memberId, entry.manualEffect.buffs)),
      ...entry.manualEffect,
    }] as const]
  }))
  const routingEntries = Object.entries(scenario.environment.routing.bySourceMemberId)
    .sort(([left], [right]) => Number(activeIds.has(left as TeamMemberId)) - Number(activeIds.has(right as TeamMemberId)))
  const bySourceMemberId = Object.fromEntries(routingEntries.map(([sourceId, routes]) => [
    mapMemberId(sourceId as TeamMemberId),
    Object.fromEntries(Object.entries(routes).map(([ownerKey, targetId]) => [
      mapSourceKey(ownerKey, gender), targetId ? mapMemberId(targetId) : null,
    ])),
  ])) as CombatScenario['environment']['routing']['bySourceMemberId']
  const dormant = scenario.dormantMembersByResonatorId
    ? Object.fromEntries(Object.entries(scenario.dormantMembersByResonatorId)
      .filter(([id]) => !activeResonatorIds.has(roverIdForGender(id, gender)))
      .sort(([left, leftEntry], [right, rightEntry]) => (
        memberDataSize(leftEntry.member, leftEntry.manualEffect) - memberDataSize(rightEntry.member, rightEntry.manualEffect)
        || Number(roverIdForGender(left, gender) === left)
          - Number(roverIdForGender(right, gender) === right)
      ))
      .map(([id, entry]) => [
        roverIdForGender(id, gender),
        {
          ...entry,
          member: convertMemberRoverGender(entry.member, gender),
          ...(entry.manualEffect ? { manualEffect: {
            ...entry.manualEffect,
            buffs: convertManualBuffsRoverGender(entry.manualEffect.buffs, gender),
          } } : {}),
        },
      ]))
    : undefined
  const converted: CombatScenario = {
    ...scenario,
    team: makeScenarioTeam(members),
    ...(dormant ? { dormantMembersByResonatorId: dormant } : {}),
    contextMemberId: mapMemberId(scenario.contextMemberId),
    initialOnFieldMemberId: mapMemberId(scenario.initialOnFieldMemberId),
    environment: {
      ...scenario.environment,
      routing: { bySourceMemberId },
      manualEffects: [
        ...scenario.environment.manualEffects
          .filter((effect) => !removedManualEffectIds.has(effect.id))
          .map((effect) => ({
        ...(restoredEffects.get(effect.id) ?? effect),
        ...(effect.selector.kind === 'members' ? { selector: {
          ...effect.selector,
          memberIds: [...new Set(effect.selector.memberIds.map(mapMemberId))],
        } } : {}),
        ...(effect.excludedMemberIds ? { excludedMemberIds: [...new Set(effect.excludedMemberIds.map(mapMemberId))] } : {}),
        })),
        ...[...restoredEffects].filter(([id]) => !scenario.environment.manualEffects.some((effect) => effect.id === id))
          .map(([, effect]) => effect),
      ].map((effect) => ({ ...effect, buffs: convertManualBuffsRoverGender(effect.buffs, gender) })),
    },
    program: {
      ...scenario.program,
      sequence: convertRotationNodesRoverGender(scenario.program.sequence, gender),
      program: convertRotationNodesRoverGender(scenario.program.program, gender),
    },
  }
  return JSON.stringify(converted) === JSON.stringify(scenario)
    ? scenario : { ...converted, revision: scenario.revision + 1 }
}

export function convertWorkspaceRoverGender(workspace: ScenarioWorkspace, gender: RoverGender): ScenarioWorkspace {
  if (gender === 'both') return workspace
  const winners = new Map<string, CombatScenarioId>()
  const aliases = new Map<CombatScenarioId, CombatScenarioId>()
  for (const id of workspace.order) {
    const scenario = workspace.scenariosById[id]
    const contextId = roverIdForGender(contextScenarioMember(scenario).resonatorId, gender)
    const previousId = winners.get(contextId)
    if (!previousId) {
      winners.set(contextId, id)
      continue
    }
    const previous = workspace.scenariosById[previousId]
    const previousBytes = serializedByteSize(previous)
    const currentBytes = serializedByteSize(scenario)
    const currentWins = currentBytes > previousBytes
      || (currentBytes === previousBytes && contextScenarioMember(scenario).resonatorId === contextId)
    if (currentWins) {
      aliases.set(previousId, id)
      winners.set(contextId, id)
    } else aliases.set(id, previousId)
  }
  const order = workspace.order.filter((id) => [...winners.values()].includes(id))
  const scenariosById = Object.fromEntries(order.map((id) => [
    id, convertScenarioRoverGender(workspace.scenariosById[id], gender),
  ])) as ScenarioWorkspace['scenariosById']
  const selectedScenarioId = aliases.get(workspace.selectedScenarioId) ?? workspace.selectedScenarioId
  return {
    selectedScenarioId,
    order,
    scenariosById,
    ...(workspace.summaryById ? { summaryById: Object.fromEntries(order.map((id) => [
      id, summarizeScenario(scenariosById[id]),
    ])) } : {}),
  }
}

export function convertLibraryRoverGender(library: SavedArtifactLibrary, gender: RoverGender): SavedArtifactLibrary {
  if (gender === 'both') return library
  return {
    ...library,
    builds: library.builds.map((entry) => ({
      ...entry,
      resonatorId: roverIdForGender(entry.resonatorId, gender),
    })),
    rotations: library.rotations.map((entry) => ({
      ...entry,
      scenario: convertScenarioRoverGender(entry.scenario, gender),
    })),
    scenarios: library.scenarios.map((entry) => ({
      ...entry,
      scenario: convertScenarioRoverGender(entry.scenario, gender),
    })),
  }
}

export function convertSimulationRoverGender(simulation: SimulationState, gender: RoverGender): SimulationState {
  if (gender === 'both') return simulation
  const suggestionsByResonatorId: SimulationState['suggestionsByResonatorId'] = {}
  for (const [id, suggestion] of Object.entries(simulation.suggestionsByResonatorId)) {
    const targetId = roverIdForGender(id, gender)
    const previous = suggestionsByResonatorId[targetId]
    if (!previous || serializedByteSize(suggestion) > serializedByteSize(previous)
      || (serializedByteSize(suggestion) === serializedByteSize(previous) && id === targetId)) {
      suggestionsByResonatorId[targetId] = suggestion
    }
  }
  return {
    ...simulation,
    optimizerSettingsResonatorId: simulation.optimizerSettingsResonatorId
      ? roverIdForGender(simulation.optimizerSettingsResonatorId, gender) : null,
    suggestionsByResonatorId,
  }
}

export function convertUiRoverGender(ui: UiState, gender: RoverGender): UiState {
  if (gender === 'both') return ui
  const cards = Object.entries(ui.preferences.showcaseCards)
    .sort(([left], [right]) => Number(roverIdForGender(left, gender) === left) - Number(roverIdForGender(right, gender) === right))
  return {
    ...ui,
    preferences: {
      ...ui.preferences,
      showcaseCards: Object.fromEntries(cards.map(([id, card]) => [roverIdForGender(id, gender), card])),
    },
  }
}

/** convert imported domains using the snapshot's Rover gender preference. */
export function convertStateRoverGender<T extends HydratedAppState>(state: T): T {
  const gender = state.ui.preferences.roverGender
  if (gender === 'both') return state
  return {
    ...state,
    ui: convertUiRoverGender(state.ui, gender),
    combat: convertWorkspaceRoverGender(state.combat, gender),
    library: convertLibraryRoverGender(state.library, gender),
    simulation: convertSimulationRoverGender(state.simulation, gender),
  }
}
