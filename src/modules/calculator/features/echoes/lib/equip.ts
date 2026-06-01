/*
  Author: Runor Ewhro
  Description: Shares echo loadout fit checks and slot replacement helpers so
               every surface follows the same equip protocol.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { areSameEchoN, cloneEchoFor } from '@/domain/entities/inventoryStorage.ts'
import { getEchoCostB } from '@/modules/calculator/features/echoes/lib/echoes.ts'

export interface EchoLdtSlotF {
  fits: boolean
  selected: boolean
}

export function mkEchoSlotCs(curChs: Array<EchoInstance | null>): number[] {
  return curChs.map((echo) => (echo ? getEchoCostB(echo.id) : 0))
}

export function slotFit(
  curChs: Array<EchoInstance | null>,
  curTtlCost: number,
  curSlotCsts: number[],
  nextEcho: EchoInstance,
  slotIndex: number,
): EchoLdtSlotF {
  const curSlotCost = curSlotCsts[slotIndex] ?? 0
  const nextCost = getEchoCostB(nextEcho.id)
  const fits = curTtlCost - curSlotCost + nextCost <= 12

  return {
    fits,
    selected: areSameEchoN(curChs[slotIndex], nextEcho),
  }
}

export function qpEchoAtSlot(
  curChs: Array<EchoInstance | null>,
  nextEcho: EchoInstance,
  slotIndex: number,
): Array<EchoInstance | null> {
  const nextEchoes = [...curChs]
  nextEchoes[slotIndex] = cloneEchoFor(nextEcho, slotIndex)
  return nextEchoes
}
