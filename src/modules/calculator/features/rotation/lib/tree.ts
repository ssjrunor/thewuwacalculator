/*
  Author: Runor Ewhro
  Description: Owns immutable tree editing helpers for nested rotation nodes,
               including lookup, insertion, movement, and loop-safe updates.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type {
  RotBrnc,
  RotDropTgt,
  RotNsrtTgt,
  RotNodeLctn,
} from './types.ts'
import { clrRotWhenLo } from './when.ts'

export function updRotNode(
  items: RotationNode[],
  nodeId: string,
  updater: (node: RotationNode) => RotationNode,
): RotationNode[] {
  const targetNode = findRotNode(items, nodeId)
  if (targetNode?.type === 'loop') {
    // loop enabled state is shared by start and end markers, so updating either marker propagates the same toggle to
    // the paired marker.
    const pdtdTgt = updater(targetNode)
    if (pdtdTgt.type !== 'loop') {
      return items
    }

    const nextEnabled = pdtdTgt.enabled ?? true
    return updRotLoopMr(items, targetNode.loopId, (node) => (
      node.id === nodeId
        ? { ...pdtdTgt, enabled: nextEnabled }
        : { ...node, enabled: nextEnabled }
    ))
  }

  return items.map((item) => {
    if (item.id === nodeId) {
      return updater(item)
    }

    if (item.type === 'repeat') {
      return {
        ...item,
        items: updRotNode(item.items, nodeId, updater),
      }
    }

    if (item.type === 'uptime') {
      return {
        ...item,
        setup: item.setup ? updRotNode(item.setup, nodeId, updater) : item.setup,
        items: updRotNode(item.items, nodeId, updater),
      }
    }

    return item
  })
}

export function updRotLoopMr(
  items: RotationNode[],
  loopId: string,
  updater: (node: Extract<RotationNode, { type: 'loop' }>) => Extract<RotationNode, { type: 'loop' }>,
): RotationNode[] {
  return items.map((item) => {
    if (item.type === 'loop' && item.loopId === loopId) {
      return updater(item)
    }

    if (item.type === 'repeat') {
      return {
        ...item,
        items: updRotLoopMr(item.items, loopId, updater),
      }
    }

    if (item.type === 'uptime') {
      return {
        ...item,
        setup: item.setup ? updRotLoopMr(item.setup, loopId, updater) : item.setup,
        items: updRotLoopMr(item.items, loopId, updater),
      }
    }

    return item
  })
}

export function trnsGrps(
  items: RotationNode[],
  nodeIds: ReadonlySet<string>,
  transform: (nodes: RotationNode[]) => RotationNode[],
): RotationNode[] {
  if (nodeIds.size === 0) {
    return items
  }

  const trnsSblnList = (siblings: RotationNode[]): RotationNode[] => {
    const next: RotationNode[] = []

    // selected nodes are transformed only when they are contiguous siblings; nested or separated selections become
    // separate transform groups to preserve tree order.
    for (let index = 0; index < siblings.length;) {
      const node = siblings[index]
      if (nodeIds.has(node.id)) {
        const group: RotationNode[] = []
        while (index < siblings.length && nodeIds.has(siblings[index].id)) {
          group.push(siblings[index])
          index += 1
        }
        next.push(...transform(group))
        continue
      }

      if (node.type === 'repeat') {
        next.push({
          ...node,
          items: trnsSblnList(node.items),
        })
        index += 1
        continue
      }

      if (node.type === 'uptime') {
        next.push({
          ...node,
          setup: node.setup ? trnsSblnList(node.setup) : node.setup,
          items: trnsSblnList(node.items),
        })
        index += 1
        continue
      }

      next.push(node)
      index += 1
    }

    return next
  }

  return trnsSblnList(items)
}

export function rmRotNode(items: RotationNode[], nodeId: string): RotationNode[] {
  const removedNode = findRotNode(items, nodeId)
  if (removedNode?.type === 'loop') {
    // deleting a loop start removes the whole loop pair, while deleting an end keeps the start as a wrap-start loop.
    if (removedNode.kind === 'start') {
      return rmRotLoopMrk(items, removedNode.loopId)
    }

    return items
      .filter((item) => item.id !== nodeId)
      .map((item) => {
        if (item.type === 'repeat') {
          return {
            ...item,
            items: rmRotNode(item.items, nodeId),
          }
        }

        if (item.type === 'uptime') {
          return {
            ...item,
            setup: item.setup ? rmRotNode(item.setup, nodeId) : item.setup,
            items: rmRotNode(item.items, nodeId),
          }
        }

        return item
      })
  }

  const nextItems = items
    .filter((item) => item.id !== nodeId)
    .map((item) => {
      if (item.type === 'repeat') {
        return {
          ...item,
          items: rmRotNode(item.items, nodeId),
        }
      }

      if (item.type === 'uptime') {
        return {
          ...item,
          setup: item.setup ? rmRotNode(item.setup, nodeId) : item.setup,
          items: rmRotNode(item.items, nodeId),
        }
      }

      return item
    })

  return nextItems
}

export function rmRotLoopMrk(items: RotationNode[], loopId: string): RotationNode[] {
  // removing loop markers must also clear any `when` rules that referenced the removed loop id.
  return clrRotWhenLo(rmLoopOnly(items, loopId), new Set([loopId]))
}

function rmLoopOnly(items: RotationNode[], loopId: string): RotationNode[] {
  return items.flatMap((item): RotationNode[] => {
    if (item.type === 'loop' && item.loopId === loopId) {
      return []
    }

    if (item.type === 'repeat') {
      return [{ ...item, items: rmLoopOnly(item.items, loopId) }]
    }

    if (item.type === 'uptime') {
      return [{
        ...item,
        setup: item.setup ? rmLoopOnly(item.setup, loopId) : item.setup,
        items: rmLoopOnly(item.items, loopId),
      }]
    }

    return [item]
  })
}

export function cllcAllRotNo(items: RotationNode[]): string[] {
  const ids: string[] = []

  const visit = (node: RotationNode) => {
    ids.push(node.id)

    if (node.type === 'repeat') {
      node.items.forEach(visit)
      return
    }

    if (node.type === 'uptime') {
      ;(node.setup ?? []).forEach(visit)
      node.items.forEach(visit)
    }
  }

  items.forEach(visit)
  return ids
}

export function addIdToSel(previous: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(previous)
  next.add(id)
  return next
}

export function tglIdInSel(previous: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(previous)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

export function fltrSelIds(previous: ReadonlySet<string>, allowedIds: ReadonlySet<string>): Set<string> {
  const next = new Set<string>()

  for (const id of previous) {
    if (allowedIds.has(id)) {
      next.add(id)
    }
  }

  return next
}

export function areSelSetsQl(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false
    }
  }

  return true
}

export function canNsrtNodeI(
  node: RotationNode | null | undefined,
  branch: RotBrnc,
): boolean {
  if (!node) {
    return false
  }

  if (branch === 'setup') {
    // uptime setup branches represent preconditions and cannot contain damage features or nested blocks.
    return node.type === 'condition'
  }

  return true
}

export function nsrtRotNode(
  items: RotationNode[],
  target: RotNsrtTgt,
  node: RotationNode,
): RotationNode[] {
  if (!canNsrtNodeI(node, target.branch)) {
    return items
  }

  if (!target.parentId || target.branch === 'root') {
    const nextItems = [...items]
    nextItems.splice(target.index ?? nextItems.length, 0, node)
    return nextItems
  }

  return items.map((item) => {
    if (item.id === target.parentId) {
      if (target.branch === 'items' && (item.type === 'repeat' || item.type === 'uptime')) {
        const nextItems = [...item.items]
        nextItems.splice(target.index ?? nextItems.length, 0, node)
        return {
          ...item,
          items: nextItems,
        }
      }

      if (target.branch === 'setup' && item.type === 'uptime') {
        const nextSetup = [...(item.setup ?? [])]
        nextSetup.splice(target.index ?? nextSetup.length, 0, node)
        return {
          ...item,
          setup: nextSetup,
        }
      }
    }

    if (item.type === 'repeat') {
      return {
        ...item,
        items: nsrtRotNode(item.items, target, node),
      }
    }

    if (item.type === 'uptime') {
      return {
        ...item,
        setup: item.setup ? nsrtRotNode(item.setup, target, node) : item.setup,
        items: nsrtRotNode(item.items, target, node),
      }
    }

    return item
  })
}

export function nsrtRotNds(
  items: RotationNode[],
  target: RotNsrtTgt,
  nodes: RotationNode[],
): RotationNode[] {
  // insert each node with a moving offset so multi-node paste preserves order at the requested insertion point.
  return nodes.reduce((nextItems, node, offset) => nsrtRotNode(
    nextItems,
    {
      ...target,
      index: target.index === undefined ? undefined : target.index + offset,
    },
    node,
  ), items)
}

export function findRotNode(items: RotationNode[], nodeId: string): RotationNode | null {
  for (const item of items) {
    if (item.id === nodeId) {
      return item
    }

    if (item.type === 'repeat') {
      const found = findRotNode(item.items, nodeId)
      if (found) {
        return found
      }
    }

    if (item.type === 'uptime') {
      const foundInSetup = item.setup ? findRotNode(item.setup, nodeId) : null
      if (foundInSetup) {
        return foundInSetup
      }

      const foundInItems = findRotNode(item.items, nodeId)
      if (foundInItems) {
        return foundInItems
      }
    }
  }

  return null
}

export function nodeCntnId(node: RotationNode, targetId: string): boolean {
  if (node.id === targetId) {
    return true
  }

  if (node.type === 'repeat') {
    return node.items.some((item) => nodeCntnId(item, targetId))
  }

  if (node.type === 'uptime') {
    return [...(node.setup ?? []), ...node.items].some((item) => nodeCntnId(item, targetId))
  }

  return false
}

export function findNodeLctn(
  items: RotationNode[],
  nodeId: string,
  parentId: string | null = null,
  branch: RotBrnc = 'root',
): RotNodeLctn | null {
  for (const [index, item] of items.entries()) {
    if (item.id === nodeId) {
      return { parentId, branch, index, node: item }
    }

    if (item.type === 'repeat') {
      const found = findNodeLctn(item.items, nodeId, item.id, 'items')
      if (found) {
        return found
      }
    }

    if (item.type === 'uptime') {
      const foundInSetup = item.setup ? findNodeLctn(item.setup, nodeId, item.id, 'setup') : null
      if (foundInSetup) {
        return foundInSetup
      }

      const foundInItems = findNodeLctn(item.items, nodeId, item.id, 'items')
      if (foundInItems) {
        return foundInItems
      }
    }
  }

  return null
}

export function dtchRotNode(
  items: RotationNode[],
  nodeId: string,
): { node: RotationNode | null; items: RotationNode[] } {
  let detachedNode: RotationNode | null = null

  // detach returns both the removed node and the rebuilt tree so drag/drop can move a node without mutating the source
  // list in place.
  const nextItems = items
    .filter((item) => {
      if (item.id === nodeId) {
        detachedNode = item
        return false
      }

      return true
    })
    .map((item) => {
      if (item.type === 'repeat') {
        const detached = dtchRotNode(item.items, nodeId)
        if (detached.node) {
          detachedNode = detached.node
          return {
            ...item,
            items: detached.items,
          }
        }
      }

      if (item.type === 'uptime') {
        const dtchFromStp = item.setup ? dtchRotNode(item.setup, nodeId) : null
        if (dtchFromStp?.node) {
          detachedNode = dtchFromStp.node
          return {
            ...item,
            setup: dtchFromStp.items,
          }
        }

        const dtchFromTms = dtchRotNode(item.items, nodeId)
        if (dtchFromTms.node) {
          detachedNode = dtchFromTms.node
          return {
            ...item,
            items: dtchFromTms.items,
          }
        }
      }

      return item
    })

  return {
    node: detachedNode,
    items: nextItems,
  }
}

export function nsrtNodeAtTg(items: RotationNode[], target: RotDropTgt, node: RotationNode): RotationNode[] {
  if (!canNsrtNodeI(node, target.branch)) {
    return items
  }

  // drop targets always carry an explicit index, unlike insert targets from buttons that may append by omitting one.
  if (!target.parentId || target.branch === 'root') {
    const nextItems = [...items]
    nextItems.splice(target.index, 0, node)
    return nextItems
  }

  return items.map((item) => {
    if (item.id === target.parentId) {
      if (target.branch === 'items' && (item.type === 'repeat' || item.type === 'uptime')) {
        const nextItems = [...item.items]
        nextItems.splice(target.index, 0, node)
        return {
          ...item,
          items: nextItems,
        }
      }

      if (target.branch === 'setup' && item.type === 'uptime') {
        const nextSetup = [...(item.setup ?? [])]
        nextSetup.splice(target.index, 0, node)
        return {
          ...item,
          setup: nextSetup,
        }
      }
    }

    if (item.type === 'repeat') {
      return {
        ...item,
        items: nsrtNodeAtTg(item.items, target, node),
      }
    }

    if (item.type === 'uptime') {
      return {
        ...item,
        setup: item.setup ? nsrtNodeAtTg(item.setup, target, node) : item.setup,
        items: nsrtNodeAtTg(item.items, target, node),
      }
    }

    return item
  })
}

export function getBrncLngt(items: RotationNode[], parentId: string | null, branch: RotBrnc): number {
  if (!parentId || branch === 'root') {
    return items.length
  }

  const parent = findRotNode(items, parentId)
  if (!parent) {
    return items.length
  }

  if (branch === 'setup' && parent.type === 'uptime') {
    return parent.setup?.length ?? 0
  }

  if (branch === 'items' && (parent.type === 'repeat' || parent.type === 'uptime')) {
    return parent.items.length
  }

  return 0
}

export function moveRotNode(items: RotationNode[], draggedId: string, target: RotDropTgt): RotationNode[] {
  const source = findNodeLctn(items, draggedId)
  if (!source) {
    return items
  }

  if (!canNsrtNodeI(source.node, target.branch)) {
    return items
  }

  if (source.parentId === target.parentId && source.branch === target.branch && source.index === target.index) {
    return items
  }

  if (target.parentId) {
    const draggedNode = source.node
    if (nodeCntnId(draggedNode, target.parentId)) {
      return items
    }
  }

  const detached = dtchRotNode(items, draggedId)
  if (!detached.node) {
    return items
  }

  let nextIndex = target.index
  if (source.parentId === target.parentId && source.branch === target.branch && source.index < target.index) {
    nextIndex -= 1
  }

  return nsrtNodeAtTg(detached.items, {
    ...target,
    index: Math.max(0, nextIndex),
  }, detached.node)
}
