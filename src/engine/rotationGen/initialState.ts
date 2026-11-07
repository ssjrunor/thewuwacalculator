/*
  Author: Runor Ewhro
  description: maps scenario controls and resonator identities into interpreter state.
*/

import type { ScenarioTeamMember } from '../../domain/entities/combatScenario'
import type { RuntimeRecord } from './types'

export type InitialStateValue = boolean | number | string
export interface InitialStateBinding {
  controlKey: string
  path: string
  values?: Record<string, InitialStateValue>
}

/** keep opaque action/packet ids stable; remap only qualified resonator namespaces. */
export function rebindRuleIdentity(source: RuntimeRecord, requested: string): RuntimeRecord {
  const from = String(source.resonatorId)
  const mapString = (value: string) => value.replace(/(^|[:.@/-])(\d{4})(?=$|[:.@/-])/g,
    (match, prefix: string, id: string) => id === from ? `${prefix}${requested}` : match)
  // numeric replacement is limited to identity fields; unrelated action, packet, and effect numbers stay stable.
  const ownerFields = new Set(['source', 'owner', 'ownerId', 'resonatorId', 'ownerOnly', 'ownerExcept', 'targetOwner'])
  const visit = (value: unknown, field = ''): unknown => {
    if (typeof value === 'string') return mapString(value)
    if (typeof value === 'number' && value === Number(from) && ownerFields.has(field)) return Number(requested)
    if (Array.isArray(value)) return value.map(item => visit(item, field))
    if (value && typeof value === 'object') {
      const record = value as RuntimeRecord
      const identityCondition = ['event.actor', 'ownerId', 'team.activeResonatorId'].includes(record.path ?? record.left?.path)
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [mapString(key),
        key === 'value' && identityCondition && item === Number(from) ? Number(requested) : visit(item, key)]))
    }
    return value
  }
  // retain the source form for later control-path rebinding after the requested form replaces the rule identity.
  const result = visit(source) as RuntimeRecord
  result.resonatorId = Number(requested)
  result.sourceResonatorId = Number(from)
  return result
}

export function initialCharacterState(rules: RuntimeRecord, member: ScenarioTeamMember): Record<string, InitialStateValue> {
  const result: Record<string, InitialStateValue> = {}
  // only declared initial bindings read scenario controls; unsupported authored values reject interpretation.
  for (const binding of (rules.initialStateBindings ?? []) as InitialStateBinding[]) {
    const value = member.local.controls[binding.controlKey]
    if (value === undefined) continue
    const mapped = binding.values ? binding.values[String(value)] : value
    if (mapped === undefined) throw new Error(`Unsupported initial value ${String(value)} for ${binding.controlKey}`)
    result[binding.path] = mapped
  }
  return result
}

export function rebindControlPath(path: string, rules: RuntimeRecord): string {
  const from = String(rules.sourceResonatorId ?? rules.resonatorId)
  return path.replace(/(^|[:.@/-])(\d{4})(?=$|[:.@/-])/g,
    (match, prefix: string, id: string) => id === from ? `${prefix}${rules.resonatorId}` : match)
}
