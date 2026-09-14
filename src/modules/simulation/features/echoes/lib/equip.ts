/*
  Author: Runor Ewhro
  Description: Owns equip behavior and state transitions for the lib module.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { sameEchoUid, cloneEchoFor } from '@/domain/entities/inventoryStorage.ts'
import { getEchoCostB } from '@/modules/simulation/features/echoes/lib/echoes.ts'

export interface EchoLdtSlotF {
  fits: boolean
  selected: boolean
}

export function mkEchoSlotCs(currentEchoes: Array<EchoInstance | null>): number[] {
  return currentEchoes.map((echo) => (echo ? getEchoCostB(echo.id) : 0))
}

export function slotFit(
  currentEchoes: Array<EchoInstance | null>,
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
    selected: sameEchoUid(currentEchoes[slotIndex], nextEcho),
  }
}

export function qpEchoAtSlot(
  currentEchoes: Array<EchoInstance | null>,
  nextEcho: EchoInstance,
  slotIndex: number,
): Array<EchoInstance | null> {
  const nextEchoes = [...currentEchoes]
  nextEchoes[slotIndex] = cloneEchoFor(nextEcho, slotIndex)
  return nextEchoes
}
