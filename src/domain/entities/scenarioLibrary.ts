/*
  Author: Runor Ewhro
  Description: Defines the unique live scenario workspace. Saved scenario
               snapshots belong to the artifact library, never this workspace.
*/

import type {
  CombatScenario,
  CombatScenarioId,
} from './combatScenario'
import { contextScenarioMember } from './combatScenario'
import type { ResonatorId } from './runtime'

export interface ScenarioWorkspace {
  selectedScenarioId: CombatScenarioId
  order: CombatScenarioId[]
  scenariosById: Record<CombatScenarioId, CombatScenario>
}

export interface ContextResonatorScenario {
  resonatorId: ResonatorId
  scenarioId: CombatScenarioId
}

export function listContextResonatorScenarios(
  workspace: Pick<ScenarioWorkspace, 'order' | 'scenariosById'>,
): ContextResonatorScenario[] {
  return workspace.order.flatMap((scenarioId) => {
    const scenario = workspace.scenariosById[scenarioId]
    return scenario
      ? [{ resonatorId: contextScenarioMember(scenario).resonatorId, scenarioId }]
      : []
  })
}

export function scenarioForContextResonator(
  workspace: Pick<ScenarioWorkspace, 'order' | 'scenariosById'>,
  resonatorId: ResonatorId,
): CombatScenario | null {
  for (const scenarioId of workspace.order) {
    const scenario = workspace.scenariosById[scenarioId]
    if (scenario && contextScenarioMember(scenario).resonatorId === resonatorId) {
      return scenario
    }
  }
  return null
}

export function scenarioIdForContextResonator(
  workspace: Pick<ScenarioWorkspace, 'order' | 'scenariosById'>,
  resonatorId: ResonatorId,
): CombatScenarioId | null {
  return scenarioForContextResonator(workspace, resonatorId)?.id ?? null
}

export function selectedCombatScenario(workspace: ScenarioWorkspace): CombatScenario {
  const selected = workspace.scenariosById[workspace.selectedScenarioId]
  if (selected) return selected

  for (const id of workspace.order) {
    const scenario = workspace.scenariosById[id]
    if (scenario) return scenario
  }

  const fallback = Object.values(workspace.scenariosById)[0]
  if (fallback) return fallback

  throw new Error('A scenario workspace requires at least one scenario')
}

export function replaceScenario(
  workspace: ScenarioWorkspace,
  scenario: CombatScenario,
): ScenarioWorkspace {
  if (!workspace.scenariosById[scenario.id]) {
    throw new Error(`Unknown scenario: ${scenario.id}`)
  }

  const contextResonatorId = contextScenarioMember(scenario).resonatorId
  const collision = scenarioIdForContextResonator(workspace, contextResonatorId)
  if (collision && collision !== scenario.id) {
    throw new Error(`A working scenario already exists for ${contextResonatorId}`)
  }

  return {
    ...workspace,
    scenariosById: {
      ...workspace.scenariosById,
      [scenario.id]: scenario,
    },
  }
}

export function addScenario(
  workspace: ScenarioWorkspace,
  scenario: CombatScenario,
  select = true,
): ScenarioWorkspace {
  if (workspace.scenariosById[scenario.id]) {
    throw new Error(`Scenario already exists: ${scenario.id}`)
  }
  const contextResonatorId = contextScenarioMember(scenario).resonatorId
  if (scenarioIdForContextResonator(workspace, contextResonatorId)) {
    throw new Error(`A working scenario already exists for ${contextResonatorId}`)
  }

  return {
    selectedScenarioId: select ? scenario.id : workspace.selectedScenarioId,
    order: [...workspace.order, scenario.id],
    scenariosById: {
      ...workspace.scenariosById,
      [scenario.id]: scenario,
    },
  }
}

export function selectScenario(
  workspace: ScenarioWorkspace,
  scenarioId: CombatScenarioId,
): ScenarioWorkspace {
  if (!workspace.scenariosById[scenarioId]) {
    throw new Error(`Unknown scenario: ${scenarioId}`)
  }
  return scenarioId === workspace.selectedScenarioId
    ? workspace
    : { ...workspace, selectedScenarioId: scenarioId }
}

export function removeScenario(
  workspace: ScenarioWorkspace,
  scenarioId: CombatScenarioId,
): ScenarioWorkspace {
  if (!workspace.scenariosById[scenarioId]) return workspace
  if (workspace.order.length <= 1) {
    throw new Error('A scenario workspace requires at least one scenario')
  }

  const order = workspace.order.filter((id) => id !== scenarioId)
  const scenariosById = { ...workspace.scenariosById }
  delete scenariosById[scenarioId]
  return {
    selectedScenarioId: workspace.selectedScenarioId === scenarioId
      ? order[0]
      : workspace.selectedScenarioId,
    order,
    scenariosById,
  }
}
