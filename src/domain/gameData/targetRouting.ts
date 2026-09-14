/*
  Author: Runor Ewhro
  Description: Encodes target-selection owner keys with a source runtime id so
               multiple teammates can route the same effect owner independently.
*/

const ROUTE_SOURCE_SEP = '@'

export interface ScopedTargetOwnerKey {
  sourceRuntimeId: string | null
  ownerKey: string
}

export function scopedTargetOwnerKey(sourceRuntimeId: string, ownerKey: string): string {
  return `${sourceRuntimeId}${ROUTE_SOURCE_SEP}${ownerKey}`
}

export function unscopedTargetOwnerKey(routeKey: string): string {
  return splitScopedTargetOwnerKey(routeKey).ownerKey
}

export function splitScopedTargetOwnerKey(routeKey: string): ScopedTargetOwnerKey {
  const sepIndex = routeKey.indexOf(ROUTE_SOURCE_SEP)
  if (sepIndex === -1) {
    return {
      sourceRuntimeId: null,
      ownerKey: routeKey,
    }
  }

  return {
    sourceRuntimeId: routeKey.slice(0, sepIndex) || null,
    ownerKey: routeKey.slice(sepIndex + ROUTE_SOURCE_SEP.length),
  }
}

export function getScopedTargetSelection(
  selectedTargets: Record<string, string | null> | null | undefined,
  sourceRuntimeId: string,
  ownerKey: string,
): { key: string; value: string | null } | null {
  if (!selectedTargets) {
    return null
  }

  const scopedKey = scopedTargetOwnerKey(sourceRuntimeId, ownerKey)
  if (Object.prototype.hasOwnProperty.call(selectedTargets, scopedKey)) {
    return { key: scopedKey, value: selectedTargets[scopedKey] ?? null }
  }

  // Legacy saves stored active-target routing by ownerKey only, so scoped
  // lookups must fall back before treating a missing scoped key as unset.
  if (Object.prototype.hasOwnProperty.call(selectedTargets, ownerKey)) {
    return { key: ownerKey, value: selectedTargets[ownerKey] ?? null }
  }

  return null
}
