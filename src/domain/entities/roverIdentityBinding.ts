/*
  Author: Runor Ewhro
  description: binds shared Rover mechanics to the selected forms without changing packet identities.
*/

import { roverPairFor } from './roverGender'

export type ResonatorIdResolver = (id: string) => string

/** maps whole resonator namespaces in paths and source-qualified feature keys, leaving skill-number prefixes alone. */
export function mapResonatorNamespaces(value: string, resolve: ResonatorIdResolver): string {
  return value.replace(/(^|[:.@/-])(\d{4})(?=$|[:.@/-])/g,
    (_, separator: string, id: string) => `${separator}${resolve(id)}`)
}

export function mapResonatorIdentityValue<T extends string | number>(value: T, resolve: ResonatorIdResolver): T {
  return (typeof value === 'number' ? Number(resolve(String(value))) : resolve(value)) as T
}

/** one form per element; different Rover elements can pick their forms independently. */
export function roverIdentityResolver(ids: readonly (string | number)[]): ResonatorIdResolver {
  const forms = new Map<string, string>()
  for (const value of ids) {
    const id = String(value), pair = roverPairFor(id)
    if (!pair) continue
    const previous = forms.get(pair.male)
    if (previous && previous !== id) throw new Error(`Both Rover forms occupy the same identity: ${previous}/${id}`)
    forms.set(pair.male, id)
    forms.set(pair.female, id)
  }
  return id => forms.get(id) ?? id
}

const opaqueFields = new Set(['id', 'name', 'label', 'sourceResonatorId', 'action', 'actionId', 'actions',
  'memberId', 'sourceMemberId', 'targetMemberId', 'text', 'description', 'message', 'url',
  'sourceActionId', 'eventId', 'sourceEventId', 'effect', 'effectId', 'expiresWith', 'requiresOwnerEffects', 'exclusiveGroup', 'cooldownGroup'])
const opaqueKeys = new Set(['actions', 'effects', 'effectControls', 'nodeFeatures'])
const identityFields = new Set(['source', 'owner', 'ownerId', 'resonatorId', 'resonatorIds', 'ownerOnly', 'ownerExcept', 'targetOwner'])
const identityPath = (path: unknown): boolean => typeof path === 'string' &&
  (['event.actor', 'event.owner', 'event.sourceOwner', 'ownerId', 'team.activeResonatorId'].includes(path) || path.endsWith('.resonator.id'))

/** rebinds semantic owner fields in rule data; numeric actions and effects, labels and opaque ids are unchanged. */
export function bindResonatorReferences<T>(source: T, resolve: ResonatorIdResolver): T {
  const visit = (value: unknown, field = ''): unknown => {
    if (typeof value === 'string') {
      if (opaqueFields.has(field)) return value
      if (/^\d+$/.test(value)) return identityFields.has(field) ? resolve(value) : value
      return mapResonatorNamespaces(value, resolve)
    }
    if (typeof value === 'number') return identityFields.has(field) ? Number(resolve(String(value))) : value
    if (Array.isArray(value)) return value.map(item => visit(item, field))
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      const comparesIdentity = identityPath(record.path ?? (record.left as { path?: unknown } | undefined)?.path)
      return Object.fromEntries(Object.entries(record).map(([key, item]) => [
        opaqueKeys.has(field) || /^\d+$/.test(key) ? key : mapResonatorNamespaces(key, resolve),
        (key === 'value' && comparesIdentity || key === 'id' && record.type === 'resonator') &&
          (typeof item === 'number' || typeof item === 'string')
          ? mapResonatorIdentityValue(item, resolve) : visit(item, key),
      ]))
    }
    return value
  }
  return visit(source) as T
}
