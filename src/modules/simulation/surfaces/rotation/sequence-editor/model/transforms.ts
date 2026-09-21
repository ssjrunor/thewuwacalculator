/*
  Author: Runor Ewhro
  Description: Applies immutable insert, move, replace, and removal operations to compact rotation sequences.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  makeBlockNode,
  type BlockNodeOptions,
} from '@/modules/simulation/surfaces/rotation/shared/nodeTools.ts'
import { cloneRotationNodes } from '@/domain/entities/inventoryStorage.ts'

type RotBlckType = 'repeat' | 'uptime'

export function blckRotTms(
  items: RotationNode[],
  type: RotBlckType,
  options: BlockNodeOptions = {},
): RotationNode[] {
  if (items.length === 0) {
    return items
  }

  const block = makeBlockNode(type, options)
  return [{ ...block, items: [...items] }]
}

/**
 * Duplicate every named node, each copy standing directly after the node it
 * was copied from.
 *
 * It takes as many as you name, so one node and a whole selection are the same
 * call. Copies are made in one pass, which is what keeps a loop's two markers
 * a pair: they share an identity, and the pass gives that identity one new
 * name for both of them rather than a name each.
 */
export function dupRotTms(
  items: RotationNode[],
  ids: ReadonlySet<string>,
): RotationNode[] {
  if (ids.size === 0) {
    return items
  }

  const named: RotationNode[] = []
  const collect = (nodes: RotationNode[]) => {
    for (const node of nodes) {
      if (ids.has(node.id)) {
        named.push(node)
        continue
      }
      if (node.type === 'repeat') {
        collect(node.items)
      } else if (node.type === 'uptime') {
        collect(node.setup ?? [])
        collect(node.items)
      }
    }
  }
  collect(items)
  if (named.length === 0) {
    return items
  }

  const copies = new Map(
    cloneRotationNodes(named, { freshIds: true }).map((copy, index) => [named[index].id, copy]),
  )
  const place = (nodes: RotationNode[]): RotationNode[] => nodes.flatMap((node) => {
    const copy = copies.get(node.id)
    if (copy) {
      return [node, copy]
    }
    if (node.type === 'repeat') {
      return [{ ...node, items: place(node.items) }]
    }
    if (node.type === 'uptime') {
      return [{
        ...node,
        ...(node.setup ? { setup: place(node.setup) } : {}),
        items: place(node.items),
      }]
    }
    return [node]
  })

  return place(items)
}
