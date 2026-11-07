/*
  Author: Runor Ewhro
  description: resolves effect target ids and checks whether a data-driven
               effect applies to a given runtime target.
*/

import type { EffectDef, EffectContext } from '@/domain/gameData/contracts'
import { getScopedTargetSelection } from '@/domain/gameData/targetRouting.ts'
import { effectTargetOwnerKey } from './activeOtherTargets'

function uniqueIds(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function resLgblTgtId(
    effect: EffectDef,
    context: EffectContext,
): string[] {
  const targetScope = effect.targetScope ?? 'self'
  const sourceId = context.sourceRuntime.id
  const members = uniqueIds(context.teamMemberIds)

  if (targetScope === 'active') {
    return members
  }

  if (targetScope === 'activeOther') {
    return members.filter((memberId) => memberId !== sourceId)
  }

  return []
}

export function resFfctTgtId(
    effect: EffectDef,
    context: EffectContext,
): string | null {
  const targetScope = effect.targetScope ?? 'self'
  if (targetScope !== 'active' && targetScope !== 'activeOther') {
    return null
  }

  const lgblTgtIds = resLgblTgtId(effect, context)
  if (lgblTgtIds.length === 0) {
    return null
  }

  const ownerKey = effectTargetOwnerKey(effect)
  if (ownerKey) {
    // a persisted route that points outside the eligible set should disable this
    // effect for the source, not silently fall back to the active resonator.
    const selection = getScopedTargetSelection(
      context.selectedTargetsByOwnerKey,
      context.sourceRuntime.id,
      ownerKey,
    )
    const selTgt = selection?.value

    if (typeof selTgt === 'string') {
      return lgblTgtIds.includes(selTgt) ? selTgt : null
    }

    if (selection && selTgt !== null) {
      return null
    }
  }

  if (lgblTgtIds.includes(context.activeResonatorId)) {
    return context.activeResonatorId
  }

  return lgblTgtIds[0] ?? null
}

export function ffctTrgtRt(
    effect: EffectDef,
    context: EffectContext,
): boolean {
  const targetScope = effect.targetScope ?? 'self'
  const sourceId = context.sourceRuntime.id
  const targetId = context.targetRuntimeId

  if (targetScope === 'self') {
    return sourceId === targetId
  }

  if (targetScope === 'active' || targetScope === 'activeOther') {
    return targetId === resFfctTgtId(effect, context)
  }

  if (targetScope === 'teamWide') {
    return true
  }

  if (targetScope === 'otherTeammates') {
    return sourceId !== targetId
  }

  return false
}
