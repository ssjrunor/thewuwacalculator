/*
  Author: Runor Ewhro
  description: binds equipment effects to editor controls and initial activation state.
*/

import type { RuntimeValue } from './types'
import { rebindControlPath } from './initialState'

export function bindEquipmentConditions(editor: RuntimeValue, combat: RuntimeValue, rulesets: RuntimeValue): void {
  // effect ids remain source data identifiers; each member receives its own rebound editor-control bindings.
  editor.memberEffectControls = {}
  for (const member of combat.members) {
    const rules = rulesets[member.resonatorId]
    const bindings: RuntimeValue = {}
    for (const definition of [rules, member.weapon, member.echoes.main, member.sonata]) {
      for (const [id, specs] of Object.entries(definition.effectControls ?? {}) as [string, [string, unknown][]][]) {
        bindings[id] = specs.map(([path, value]) => [rebindControlPath(path, rules), value])
      }
    }
    // a replay-only enemy status (Lynae's Shifting) has no editor state and the
    // calculator does not read it, so it binds no condition.
    for (const definition of Object.values(rules.enemyStatuses ?? {}) as RuntimeValue[]) {
      bindings[definition.effect] = []
    }
    editor.memberEffectControls[member.resonatorId] = bindings
    member.initialEffectGrants = []
    // only a state visible as the rotation opens can hold an effect from the start; a hidden
    // control (Attentive Heart outside Confession) has no effect in the calculator.
    const offered = new Set((editor.preambleChoices ?? [])
      .filter((choice: RuntimeValue) => String(choice.resonatorId) === String(member.resonatorId) && !choice.hidden)
      .map((choice: RuntimeValue) => choice.state.path))
    for (const [id, specs] of Object.entries(bindings) as [string, [string, unknown][]][]) {
      if (!specs.some(([path]) => Object.hasOwn(member.initialControls,
        path.replace(/^runtime\.state\.controls\./, '')))) continue
      if (specs.some(([path]) => path.startsWith('runtime.state.controls.') && !offered.has(path))) continue
      // initial grants support boolean controls, explicit stack counts, bit masks, and per-stack scale bindings.
      let stacks = 1
      const enabled = specs.every(([path, expected]: [string, RuntimeValue]) => {
        const value = member.initialControls[path.replace(/^runtime\.state\.controls\./, '')]
        if (expected === 'stacks') { stacks = Number(value); return stacks > 0 }
        if (expected?.bitCount) { stacks = (1 << Math.min(expected.bitCount, Number(value))) - 1; return stacks > 0 }
        if (expected?.per) { stacks = Number(value) * expected.per; return stacks > 0 }
        return expected === 'conditionalSourceValue' || value === expected
      })
      if (enabled) member.initialEffectGrants.push({ effect: Number(id), stacks })
    }
  }
}
