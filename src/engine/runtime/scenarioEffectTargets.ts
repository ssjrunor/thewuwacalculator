/*
  Author: Runor Ewhro
  description: captures Active Other recipients at the scenario editing boundary.
*/
import { reviseCombatScenario, type CombatScenario } from '@/domain/entities/combatScenario'
import type { EffectContext } from '@/domain/gameData/contracts'
import { listEffectsFor } from '@/data/catalog/gameDataService'
import { activeOtherTargetGroups } from '@/engine/effects/activeOtherTargets'
import { evalCond } from '@/engine/effects/evaluator'
import { resFfctTgtId } from '@/engine/effects/targetScope'
import { makeTeamComp } from '@/engine/gameData/teamComposition'
import { listRtSrcRef } from '@/engine/services/runtimeSourceService'
import { projectScenarioRuntimes } from './scenarioRuntime'

// pin newly activated Active Other effects to scenario members while preserving explicit persisted targets.
export function captureScenarioOtherTargets(scenario: CombatScenario, previous?: CombatScenario): CombatScenario {
  const projection = projectScenarioRuntimes(scenario)
  // compare the old and new source controls to capture recipients only when an activation condition changes from false to true.
  const before = previous ? projectScenarioRuntimes(previous) : undefined
  const active = projection.runtimesByMemberId[scenario.initialOnFieldMemberId]
  if (!active) return scenario
  let routes = scenario.environment.routing.bySourceMemberId
  for (const member of scenario.team.members) {
    const runtime = projection.runtimesByMemberId[member.id]
    const previousRuntime = before?.runtimesByMemberId[member.id]
    if (previousRuntime?.state.controls === runtime.state.controls) continue
    const sources = [...listRtSrcRef(runtime), ...(runtime.build.weapon.id ? [{ type: 'weapon' as const, id: runtime.build.weapon.id }] : []),
      ...[...new Set(runtime.build.echoes.flatMap(echo => echo ? [echo.set] : []))]
        .map(set => ({ type: 'echoSet' as const, id: String(set) }))]
    const groups = activeOtherTargetGroups(sources.flatMap(source => listEffectsFor(source.type, source.id)))
    const context: EffectContext = { source: { type: 'resonator', id: runtime.id }, sourceRuntime: runtime,
      targetRuntime: active, activeRuntime: active, activeResonatorId: active.id, targetRuntimeId: active.id,
      teamMemberIds: scenario.team.members.map(member => member.resonatorId),
      team: makeTeamComp(scenario.team.members.map(member => member.resonatorId)), echoSetCounts: {},
      selectedTargetsByOwnerKey: projection.selectedTargets }
    for (const group of groups) {
      // an explicit persisted recipient remains authoritative across later activations and on-field changes.
      if (routes[member.id]?.[group.ownerKey] != null) continue
      const scope = { sourceRuntime: runtime, targetRuntime: active, activeRuntime: active, context }
      if (!evalCond(group.condition, scope)) continue
      if (previousRuntime && evalCond(group.condition, { ...scope, sourceRuntime: previousRuntime })) continue
      const targetId = resFfctTgtId({ id: group.ownerKey, label: group.ownerKey, source: context.source,
        trigger: 'runtime', ownerKey: group.ownerKey, targetScope: 'activeOther', operations: [] }, context)
      // effect evaluation uses resonator ids; persist the selected recipient as the scenario member id.
      const target = scenario.team.members.find(member => member.resonatorId === targetId)
      if (target) routes = { ...routes, [member.id]: { ...routes[member.id], [group.ownerKey]: target.id } }
    }
  }
  // preserve scenario identity when no recipient changed; a captured route produces one normal scenario revision.
  return routes === scenario.environment.routing.bySourceMemberId ? scenario : reviseCombatScenario(scenario, {
    environment: { ...scenario.environment, routing: { bySourceMemberId: routes } },
  })
}
