/*
  Author: Runor Ewhro
  Description: Resolves effect target ids and checks whether a data-driven
               effect applies to a given runtime target.
*/

import type { EffectDef, EffectContext } from '@/domain/gameData/contracts'

// remove duplicates and empty ids
function uniqueIds(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

// resolve all eligible target ids for an effect
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

// resolve the final target id for an effect
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

  const ownerKey = effect.ownerKey
  if (ownerKey) {
    const selTgt = context.selectedTargetsByOwnerKey?.[ownerKey]
    if (typeof selTgt === 'string' && lgblTgtIds.includes(selTgt)) {
      return selTgt
    }
  }

  if (lgblTgtIds.includes(context.activeResonatorId)) {
    return context.activeResonatorId
  }

  return lgblTgtIds[0] ?? null
}

// check whether an effect applies to the current target runtime
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