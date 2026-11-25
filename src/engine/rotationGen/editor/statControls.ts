/*
  Author: Runor Ewhro
  description: fills editor controls bound to a build stat (StatControlBinding)
               on their stat-snapshot conditions, with the stat's value at each
               bound cast read from a run of the generated program.
*/

import type { CombatScenario } from '../../../domain/entities/combatScenario'
import type { RotationNode } from '../../../domain/gameData/contracts'
import { prepareCombatScenario } from '../../pipeline/combatScenario'
import { executeRotationProgram, prepareRotationProgram } from '../../rotation/execute'

export interface StatControlBinding {
  resonatorId: string
  actionName: string
  controlKey: string
  stat: 'critRate'
  min?: number
  max?: number
}

/** fills existing editor inputs from app stats at the exact cast marker. bindings read a stat that does not depend on
 * the control being filled, and run before section packing, preserving each cast's literal snapshot and timing. */
export function materializeStatControls(scenario: CombatScenario, items: RotationNode[], bindings: StatControlBinding[],
  authorable: ReadonlySet<string>): RotationNode[] {
  if (!bindings.length) return items
  const matched = new Map<string, StatControlBinding>()
  for (const binding of bindings) {
    const path = `runtime.state.controls.${binding.controlKey}`
    if (!authorable.has(`${binding.resonatorId}|${path}`)) throw new Error(`Stat snapshot control absent from editor: ${binding.controlKey}`)
    for (const item of items) if (item.type === 'condition' && item.id.endsWith(':stat-snapshot') &&
      item.resonatorId === binding.resonatorId && item.changes.some(change => change.path === path)) matched.set(item.id, binding)
  }
  if (!matched.size) return items
  const input = { ...scenario, program: { ...scenario.program, program: items } }
  const prepared = prepareCombatScenario(input)
  const environment = prepared.workspace.rotNvrn
  if (!environment) throw new Error('Cannot resolve source-stat snapshots')
  const values = new Map<string, number>()
  executeRotationProgram(environment, prepareRotationProgram(items), { captureEntries: false,
    onConditionUse(node, readSourceStats) {
      const binding = matched.get(node.id)
      if (!binding) return
      const snapshot = readSourceStats(binding.resonatorId)?.[binding.stat]
      if (typeof snapshot !== 'number' || !Number.isFinite(snapshot)) throw new Error(`Missing source stat at ${node.id}`)
      values.set(node.id, Math.min(binding.max ?? Infinity, Math.max(binding.min ?? -Infinity, snapshot)))
    },
  })
  return items.map(item => {
    if (item.type !== 'condition' || !matched.has(item.id)) return item
    const value = values.get(item.id)
    if (value === undefined) throw new Error(`Unreached source-stat snapshot: ${item.id}`)
    const binding = matched.get(item.id)!
    return { ...item, changes: item.changes.map(change => change.type === 'set' &&
      change.path === `runtime.state.controls.${binding.controlKey}` ? { ...change, value } : change) }
  })
}
