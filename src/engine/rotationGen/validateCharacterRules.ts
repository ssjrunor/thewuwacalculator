/*
  Author: Runor Ewhro
  description: validates rule structure and rejects unresolved comparisons.
*/

import type { RuntimeRecord } from './types'
/** structural validation only. Action and transition coverage is checked when consumed. */
export function validateCharacterRules(rules: RuntimeRecord): RuntimeRecord {
  if (rules.schemaVersion !== 2 || !Number.isInteger(rules.resonatorId) ||
    !rules.actions || !Array.isArray(rules.rules) || !rules.effects || !rules.state || !rules.nodeFeatures) {
    throw new Error(`Invalid character translation ${rules.resonatorId}`)
  }
  // an operator requires a path or an explicit left operand; unresolved comparisons cannot run as valid rules.
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const entry = value as RuntimeRecord
    if (entry.operator && !entry.path && entry.left === undefined) {
      throw new Error(`Unresolved comparison in character translation ${rules.resonatorId}`)
    }
    for (const child of Object.values(entry)) visit(child)
  }
  visit(rules.rules)
  return rules
}
