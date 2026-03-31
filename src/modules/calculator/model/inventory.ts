/*
  Author: Runor Ewhro
  Description: inventory-facing calculator helpers for slot fit checks and
               generic sorting so inventory components stay mostly presentational.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { areSameEchoInstance } from '@/domain/entities/inventoryStorage'
import { getEchoCostById } from '@/modules/calculator/model/echoes'

export interface InventorySlotFitState {
  fits: boolean
  selected: boolean
}

// determine whether an echo can replace a slot without breaking the cost cap
export function getInventorySlotFitState(
  currentEchoes: Array<EchoInstance | null>,
  currentTotalCost: number,
  currentSlotCosts: number[],
  nextEcho: EchoInstance,
  slotIndex: number,
): InventorySlotFitState {
  const currentSlotCost = currentSlotCosts[slotIndex] ?? 0
  const nextCost = getEchoCostById(nextEcho.id)
  const fits = currentTotalCost - currentSlotCost + nextCost <= 12

  return {
    fits,
    selected: areSameEchoInstance(currentEchoes[slotIndex], nextEcho),
  }
}

// sort a list by its display name without mutating the original data
export function sortEntriesByName<T extends { id: string }>(
  items: T[],
  getName: (item: T) => string,
) {
  return [...items].sort((left, right) => getName(left).localeCompare(getName(right)))
}
