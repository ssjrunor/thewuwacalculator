import type { RotationNode } from '@/domain/gameData/contracts'

export interface NegativeEffectConfigDraft {
  instancesInput: string
  stableWidthInput: string
  instancesTouched: boolean
  stableWidthTouched: boolean
}

function normalizeInteger(value: number | null | undefined, minimum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(minimum, Math.floor(value))
}

function parseIntegerInput(rawValue: string, minimum: number): number | null {
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

export function createNegativeEffectConfigDraft(
  initialNode: Extract<RotationNode, { type: 'feature' }> | null,
): NegativeEffectConfigDraft {
  return {
    instancesInput: String(normalizeInteger(initialNode?.negativeEffectInstances, 1, 1)),
    stableWidthInput: String(normalizeInteger(initialNode?.negativeEffectStableWidth, 1, 1)),
    instancesTouched: false,
    stableWidthTouched: false,
  }
}

export function serializeNegativeEffectConfigDraft(
  draft: NegativeEffectConfigDraft,
): {
  negativeEffectInstances?: number
  negativeEffectStableWidth?: number
} {
  const config: {
    negativeEffectInstances?: number
    negativeEffectStableWidth?: number
  } = {}

  if (draft.instancesTouched) {
    const normalizedInstances = parseIntegerInput(draft.instancesInput, 1)
    if (normalizedInstances != null) {
      config.negativeEffectInstances = normalizedInstances > 1 ? normalizedInstances : undefined
    }
  }

  if (draft.stableWidthTouched) {
    const normalizedStableWidth = parseIntegerInput(draft.stableWidthInput, 1)
    if (normalizedStableWidth != null) {
      config.negativeEffectStableWidth = normalizedStableWidth > 1 ? normalizedStableWidth : undefined
    }
  }

  return config
}
