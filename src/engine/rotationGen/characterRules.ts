/*
  Author: Runor Ewhro
  description: loads and validates character rules for each requested resonator form.
*/

import type { CharacterRuleLibrary, RuntimeRecord } from './types'
import { codes } from './codes.ts'
import { validateCharacterRules } from './validateCharacterRules.ts'
import { resonatorForms } from '../../domain/rotationActions/identities.ts'
import { rebindRuleIdentity } from './initialState'

export function createCharacterRuleLibrary(
  index: RuntimeRecord,
  readCharacter: (id: string) => Promise<unknown>,
): CharacterRuleLibrary {
  // a rover's rules are filed under one of its two forms.
  const ruleId = (id: string | number) => resonatorForms(id).find(form => index.rulesets[form]) ?? String(id)
  return {
    has(id) { return Boolean(index.rulesets[ruleId(id)]) },
    // coverage reports unresolved rules and hit bindings before the interpreter attempts to create a program.
    async coverage(id) {
      const canonical = ruleId(id), summary = index.rulesets[canonical]
      if (!summary) return null
      const rules = await readCharacter(canonical) as RuntimeRecord
      return { name: summary.name, actions: Object.keys(rules.actions).length,
        gaps: [...rules.translationGaps ?? [], ...rules.rules.flatMap((rule: RuntimeRecord) =>
          rule.operations.filter((operation: RuntimeRecord) => operation.op === 'translationGap').map((operation: RuntimeRecord) =>
            ({ rule: rule.id, when: rule.when, actions: rule.actions, conditions: rule.conditions, message: operation.message })))],
        unboundActions: (Object.entries(rules.actions) as [string, RuntimeRecord][]).filter(([id, action]) =>
          !action.equippedEchoReplacement && action.events.some((event: RuntimeRecord) => event.damage) && !rules.nodeFeatures[id])
          .map(([id, action]) => ({ id, name: action.name })),
      }
    },
    // load every requested member independently, then rebind shared Rover rules to that member's actual form.
    async load(ids, mode) {
      if (!['live', 'beta'].includes(mode)) throw new Error(`Invalid mode ${mode}`)
      return Object.fromEntries(await Promise.all(ids.map(async requested => {
        const id = ruleId(requested)
        if (!this.has(id)) throw new Error(`Missing character translation ${requested}`)
        const ruleset = validateCharacterRules(await readCharacter(id) as RuntimeRecord)
        return [String(requested), { ...rebindRuleIdentity(ruleset, String(requested)), mode, codes }]
      })))
    },
  }
}

export { codes }
