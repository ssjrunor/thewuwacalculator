/*
  Author: Runor Ewhro
  Description: Provides helpers for building and parsing owner, control,
               and control-path keys used by runtime state controls.
*/

import type { SourceOwnerScope } from '@/domain/gameData/contracts'

// validate and normalize one owner/control key segment
function assertValidKeyPart(value: string, field: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${field} must not be empty`)
  }

  if (trimmed.includes('.')) {
    throw new Error(`${field} must not contain "."`)
  }

  if (trimmed.includes(':')) {
    throw new Error(`${field} must not contain ":"`)
  }

  return trimmed
}

// create a stable owner key
export function makeOwnerKey(scope: SourceOwnerScope, sourceId: string, ownerId: string): string {
  return [
    assertValidKeyPart(scope, 'scope'),
    assertValidKeyPart(sourceId, 'sourceId'),
    assertValidKeyPart(ownerId, 'ownerId'),
  ].join(':')
}

// parse an owner key into its parts
export function parseOwnerKey(ownerKey: string): {
  scope: SourceOwnerScope
  sourceId: string
  ownerId: string
} {
  const [scope, sourceId, ownerId] = ownerKey.split(':')

  if (!scope || !sourceId || !ownerId) {
    throw new Error(`Invalid owner key: ${ownerKey}`)
  }

  return {
    scope: scope as SourceOwnerScope,
    sourceId,
    ownerId,
  }
}

// create a stable control key from an owner key and state id
export function makeControlKey(ownerKey: string, stateId: string): string {
  return `${ownerKey}:${assertValidKeyPart(stateId, 'stateId')}`
}

// parse a control key into owner key and state id
export function parseControlKey(controlKey: string): {
  ownerKey: string
  stateId: string
} {
  const parts = controlKey.split(':')

  if (parts.length < 4) {
    throw new Error(`Invalid control key: ${controlKey}`)
  }

  return {
    ownerKey: parts.slice(0, -1).join(':'),
    stateId: parts.at(-1) ?? '',
  }
}

// map a control key to its runtime controls path
export function makeControlPath(controlKey: string): string {
  return `runtime.state.controls.${controlKey}`
}