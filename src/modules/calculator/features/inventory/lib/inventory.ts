/*
  Author: Runor Ewhro
  Description: inventory-facing calculator helpers for slot fit checks and
               generic sorting so inventory features stay mostly presentational.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import {
  slotFit,
  type EchoLdtSlotF,
} from '@/modules/calculator/features/echoes/lib/equip.ts'

export type InvSlotFitSt = EchoLdtSlotF

// determine whether an echo can replace a slot without breaking the cost cap
export function getInvSlotFi(
  curChs: Array<EchoInstance | null>,
  curTtlCost: number,
  curSlotCsts: number[],
  nextEcho: EchoInstance,
  slotIndex: number,
): InvSlotFitSt {
  return slotFit(curChs, curTtlCost, curSlotCsts, nextEcho, slotIndex)
}

// sort a list by its display name without mutating the original data
export function sortEntsByNa<T extends { id: string }>(
  items: T[],
  getName: (item: T) => string,
) {
  return [...items].sort((left, right) => getName(left).localeCompare(getName(right)))
}
