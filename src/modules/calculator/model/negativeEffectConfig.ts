/*
  Author: Runor Ewhro
  Description: Normalizes the editable negative-effect config draft used by
               rotation feature nodes and serializes touched values back into
               the sparse node payload shape.
*/

import type { RotationNode } from '@/domain/gameData/contracts'

export interface NegEffectDraft {
  instanceInput: string
  stableInput: string
  instanceTouched: boolean
  stableTouched: boolean
}

function normInteger(value: number | null | undefined, minimum: number, fallback: number): number {
  // authored node values can be missing or non-finite during editing, so clamp
  // everything through one helper before it reaches the draft inputs.
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(minimum, Math.floor(value))
}

function parseIntInput(rawValue: string, minimum: number): number | null {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return null
  }

  const value = Number(trimmed)
  if (!Number.isFinite(value)) {
    return null
  }

  return Math.max(minimum, Math.floor(value))
}

export function makeNegDraft(
  initialNode: Extract<RotationNode, { type: 'feature' }> | null,
): NegEffectDraft {
  return {
    instanceInput: String(normInteger(initialNode?.negativeEffectInstances, 1, 1)),
    stableInput: String(normInteger(initialNode?.negativeEffectStableWidth, 1, 1)),
    instanceTouched: false,
    stableTouched: false,
  }
}

export function saveNegDraft(
  draft: NegEffectDraft,
): {
  negEfxNstn?: number
  negEfxStblo2?: number
} {
  const config: {
    negEfxNstn?: number
    negEfxStblo2?: number
  } = {}

  if (draft.instanceTouched) {
    const instanceCount = parseIntInput(draft.instanceInput, 1)
    if (instanceCount != null) {
      // values of 1 are the implicit runtime default, so omit them to keep the
      // stored node payload sparse and semantically meaningful.
      config.negEfxNstn = instanceCount > 1 ? instanceCount : undefined
    }
  }

  if (draft.stableTouched) {
    const stableCount = parseIntInput(draft.stableInput, 1)
    if (stableCount != null) {
      config.negEfxStblo2 = stableCount > 1 ? stableCount : undefined
    }
  }

  return config
}
