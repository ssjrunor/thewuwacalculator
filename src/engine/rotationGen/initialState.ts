/*
  Author: Runor Ewhro
  description: maps scenario controls and resonator identities into interpreter state.
*/

import type { ScenarioTeamMember } from '../../domain/entities/combatScenario'
import type { RuntimeRecord } from './types'
import { bindResonatorReferences, mapResonatorNamespaces, roverIdentityResolver } from '../../domain/entities/roverIdentityBinding'
import { canonicalResonatorId } from '../../domain/rotationActions/identities'

export type InitialStateValue = boolean | number | string
export interface InitialStateBinding {
  controlKey: string
  path: string
  values?: Record<string, InitialStateValue>
}

/** keep opaque action/packet ids stable; remap only qualified resonator namespaces. */
export function rebindRuleIdentity(source: RuntimeRecord, requested: string, teamIds: readonly string[] = [requested]): RuntimeRecord {
  const from = String(source.resonatorId)
  // library callers may request both forms independently: the current member selects its own form, and other elements
  // use their team-wide binding
  const resolveTeam = roverIdentityResolver([...teamIds.filter(id =>
    canonicalResonatorId(id) !== canonicalResonatorId(requested)), requested])
  const result = bindResonatorReferences(source, id => id === from ? requested : resolveTeam(id))
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
  return mapResonatorNamespaces(path, roverIdentityResolver([rules.resonatorId]))
}
