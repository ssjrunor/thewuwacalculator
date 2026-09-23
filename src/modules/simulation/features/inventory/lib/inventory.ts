/*
  Author: Runor Ewhro
  Description: inventory-facing Simulation helpers for slot fit checks and
               generic sorting so inventory features stay mostly presentational.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import {
  slotFit,
  type EchoLdtSlotF,
} from '@/modules/simulation/features/echoes/lib/equip.ts'

export type InvSlotFitSt = EchoLdtSlotF

export interface InventoryPage<T, G extends { entries: T[] }> {
  groups: Array<G & { totalEntries: number }>
  page: number
  pageCount: number
  total: number
  start: number
  end: number
}

/**
 * Page grouped inventory rows without flattening away their visual bands.
 * Only the current page reaches React, which bounds card DOM, decoded images,
 * refs, and event handlers even when a library contains hundreds of entries.
 */
export function paginateInventoryGroups<T, G extends { entries: T[] }>(
  groups: G[],
  requestedPage: number,
  pageSize: number,
): InventoryPage<T, G> {
  const total = groups.reduce((count, group) => count + group.entries.length, 0)
  const safePageSize = Math.max(1, Math.floor(pageSize))
  const pageCount = Math.max(1, Math.ceil(total / safePageSize))
  const page = Math.max(0, Math.min(Math.floor(requestedPage), pageCount - 1))
  const start = page * safePageSize
  const end = Math.min(total, start + safePageSize)
  let offset = 0
  const visibleGroups: Array<G & { totalEntries: number }> = []

  for (const group of groups) {
    const groupStart = offset
    const groupEnd = groupStart + group.entries.length
    offset = groupEnd
    if (groupEnd <= start || groupStart >= end) continue

    const localStart = Math.max(0, start - groupStart)
    const localEnd = Math.min(group.entries.length, end - groupStart)
    visibleGroups.push({
      ...group,
      entries: group.entries.slice(localStart, localEnd),
      totalEntries: group.entries.length,
    })
  }

  return {
    groups: visibleGroups,
    page,
    pageCount,
    total,
    start,
    end,
  }
}

// determine whether an echo can replace a slot without breaking the cost cap
export function getInvSlotFi(
  currentEchoes: Array<EchoInstance | null>,
  curTtlCost: number,
  curSlotCsts: number[],
  nextEcho: EchoInstance,
  slotIndex: number,
): InvSlotFitSt {
  return slotFit(currentEchoes, curTtlCost, curSlotCsts, nextEcho, slotIndex)
}

// sort a list by its display name without mutating the original data
export function sortEntsByNa<T extends { id: string }>(
  items: T[],
  getName: (item: T) => string,
) {
  return [...items].sort((left, right) => getName(left).localeCompare(getName(right)))
}
