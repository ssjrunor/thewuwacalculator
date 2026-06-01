/*
  Author: Runor Ewhro
  Description: Provides helpers for building and parsing owner, control,
               and control-path keys used by runtime state controls.
*/

import type { SrcOwnScp } from '@/domain/gameData/contracts'

// validate and normalize one owner/control key segment
function ssrtVldKeyPa(value: string, field: string): string {
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
export function makeOwnerKey(scope: SrcOwnScp, sourceId: string, ownerId: string): string {
  return [
    ssrtVldKeyPa(scope, 'scope'),
    ssrtVldKeyPa(sourceId, 'sourceId'),
    ssrtVldKeyPa(ownerId, 'ownerId'),
  ].join(':')
}

// parse an owner key into its parts
export function prsOwnKey(ownerKey: string): {
  scope: SrcOwnScp
  sourceId: string
  ownerId: string
} {
  const [scope, sourceId, ownerId] = ownerKey.split(':')

  if (!scope || !sourceId || !ownerId) {
    throw new Error(`Invalid owner key: ${ownerKey}`)
  }

  return {
    scope: scope as SrcOwnScp,
    sourceId,
    ownerId,
  }
}

// create a stable control key from an owner key and state id
export function mkCntrKey(ownerKey: string, stateId: string): string {
  return `${ownerKey}:${ssrtVldKeyPa(stateId, 'stateId')}`
}

// parse a control key into owner key and state id
export function prsCntrKey(controlKey: string): {
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
export function mkCntrPath(controlKey: string): string {
  return `runtime.state.controls.${controlKey}`
}