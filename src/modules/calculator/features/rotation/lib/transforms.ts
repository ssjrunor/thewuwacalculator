/*
  Author: Runor Ewhro
  Description: Provides small structural transforms for rotation-node lists
               when ui actions need immutable edits.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  mkLoopEndNod,
  mkLoopStartN,
  type RotLoopStart,
} from './loops.ts'
import { mkBlckNode } from './utils.ts'

export type RotBlckType = 'repeat' | 'uptime'

export function lpfyRotTms(
  items: RotationNode[],
  options: Partial<RotLoopStart> = {},
): RotationNode[] {
  if (items.length === 0) {
    return items
  }

  const start = mkLoopStartN(options)
  return [start, ...items, mkLoopEndNod(start)]
}

export function blckRotTms(items: RotationNode[], type: RotBlckType): RotationNode[] {
  if (items.length === 0) {
    return items
  }

  const block = mkBlckNode(type)
  return [{ ...block, items: [...items] }]
}
