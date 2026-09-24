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
import type { RotationNode } from '@/domain/gameData/contracts'

export interface ScenarioSummary {
  resonatorId: ResonatorId
  level: number
  sequence: number
  rotationNodes: number
}

function countProgramNodes(items: readonly RotationNode[]): number {
  let total = 0
  for (const node of items) {
    total += 1
    if (node.type === 'repeat' || node.type === 'uptime') {
      total += countProgramNodes(node.setup ?? [])
      total += countProgramNodes(node.items)
    }
  }
  return total
}

export function summarizeScenario(scenario: CombatScenario): ScenarioSummary {
  const member = contextScenarioMember(scenario)
  return {
    resonatorId: member.resonatorId,
    level: member.progression.level ?? 1,
    sequence: member.progression.sequence ?? 0,
    rotationNodes: countProgramNodes(scenario.program.program),
  }
}

export function copyScenarioRecords(
  records: ScenarioWorkspace['scenariosById'],
  replacement?: CombatScenario,
): ScenarioWorkspace['scenariosById'] {
  const descriptors = Object.getOwnPropertyDescriptors(records)
  if (replacement) {
    // Loaded records can be getter-only. Replace the descriptor in the new
    // map without assigning through that getter or hydrating unrelated records.
    descriptors[replacement.id] = {
      value: replacement,
      enumerable: true,
      configurable: true,
      writable: true,
    }
  }
  return Object.defineProperties({}, descriptors)
}

export interface ScenarioWorkspace {
  selectedScenarioId: CombatScenarioId
  order: CombatScenarioId[]
  scenariosById: Record<CombatScenarioId, CombatScenario>
  summaryById?: Record<CombatScenarioId, ScenarioSummary>
}

export interface ContextResonatorScenario {
  resonatorId: ResonatorId
  scenarioId: CombatScenarioId
}

export function listContextResonatorScenarios(
  workspace: Pick<ScenarioWorkspace, 'order' | 'scenariosById' | 'summaryById'>,
): ContextResonatorScenario[] {
  return workspace.order.flatMap((scenarioId) => {
    const summary = workspace.summaryById?.[scenarioId]
    if (summary) return [{ resonatorId: summary.resonatorId, scenarioId }]
    const scenario = workspace.scenariosById[scenarioId]
    return scenario
      ? [{ resonatorId: contextScenarioMember(scenario).resonatorId, scenarioId }]
      : []
  })
}

export function scenarioForContextResonator(
  workspace: Pick<ScenarioWorkspace, 'order' | 'scenariosById' | 'summaryById'>,
  resonatorId: ResonatorId,
): CombatScenario | null {
  const id = scenarioIdForContextResonator(workspace, resonatorId)
  return id ? workspace.scenariosById[id] ?? null : null
}

export function scenarioIdForContextResonator(
  workspace: Pick<ScenarioWorkspace, 'order' | 'scenariosById' | 'summaryById'>,
  resonatorId: ResonatorId,
): CombatScenarioId | null {
  for (const scenarioId of workspace.order) {
    const summary = workspace.summaryById?.[scenarioId]
    if (summary?.resonatorId === resonatorId) return scenarioId
    if (!summary) {
      const scenario = workspace.scenariosById[scenarioId]
      if (scenario && contextScenarioMember(scenario).resonatorId === resonatorId) return scenarioId
    }
  }
  return null
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

  const nextSummary = summarizeScenario(scenario)
  const previousSummary = workspace.summaryById?.[scenario.id]
  const summaryById = !workspace.summaryById
    ? undefined
    : previousSummary
      && previousSummary.resonatorId === nextSummary.resonatorId
      && previousSummary.level === nextSummary.level
      && previousSummary.sequence === nextSummary.sequence
      && previousSummary.rotationNodes === nextSummary.rotationNodes
      ? workspace.summaryById
      : { ...workspace.summaryById, [scenario.id]: nextSummary }

  return {
    ...workspace,
    ...(summaryById ? { summaryById } : {}),
    scenariosById: copyScenarioRecords(workspace.scenariosById, scenario),
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
    ...(workspace.summaryById ? {
      summaryById: { ...workspace.summaryById, [scenario.id]: summarizeScenario(scenario) },
    } : {}),
    scenariosById: copyScenarioRecords(workspace.scenariosById, scenario),
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
  const scenariosById = copyScenarioRecords(workspace.scenariosById)
  delete scenariosById[scenarioId]
  const summaryById = workspace.summaryById ? { ...workspace.summaryById } : undefined
  if (summaryById) delete summaryById[scenarioId]
  return {
    selectedScenarioId: workspace.selectedScenarioId === scenarioId
      ? order[0]
      : workspace.selectedScenarioId,
    order,
    scenariosById,
    ...(summaryById ? { summaryById } : {}),
  }
}
