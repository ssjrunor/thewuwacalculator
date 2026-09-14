/*
  Author: Runor Ewhro
  Description: Implements rotation tree data-flow and calculation invariants.
*/

import type { RotationNode } from './contracts.ts'
import { rmLoopMrkr } from './rotationLoops.ts'

/** Which child list of a container node a position refers to. */
export type RotationBranch = 'root' | 'items' | 'setup'

export interface RotationInsertTarget {
  parentId: string | null
  branch: RotationBranch
  index?: number
}

export interface RotationDropTarget extends RotationInsertTarget {
  index: number
  key: string
}

export interface RotationNodeLocation {
  parentId: string | null
  branch: RotationBranch
  index: number
  node: RotationNode
}

export function updateRotNode(
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
        items: updateRotNode(item.items, nodeId, updater),
      }
    }

    if (item.type === 'uptime') {
      return {
        ...item,
        setup: item.setup ? updateRotNode(item.setup, nodeId, updater) : item.setup,
        items: updateRotNode(item.items, nodeId, updater),
      }
    }

    return item
  })
}

function updRotLoopMr(
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

export function mapRotGroups(
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

export function removeRotNode(items: RotationNode[], nodeId: string): RotationNode[] {
  const removedNode = findRotNode(items, nodeId)
  // A start owns the pair. Removing an end only removes that marker, leaving
  // the start as a no-end loop and otherwise following ordinary recursion.
  if (removedNode?.type === 'loop' && removedNode.kind === 'start') {
    return rmRotLoopMrk(items, removedNode.loopId)
  }

  const nextItems = items
    .filter((item) => item.id !== nodeId)
    .map((item) => {
      if (item.type === 'repeat') {
        return {
          ...item,
          items: removeRotNode(item.items, nodeId),
        }
      }

      if (item.type === 'uptime') {
        return {
          ...item,
          setup: item.setup ? removeRotNode(item.setup, nodeId) : item.setup,
          items: removeRotNode(item.items, nodeId),
        }
      }

      return item
    })

  return nextItems
}

function rmRotLoopMrk(items: RotationNode[], loopId: string): RotationNode[] {
  return rmLoopOnly(items, loopId)
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

export function collectRotIds(items: RotationNode[]): string[] {
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

function canNsrtNodeI(
  node: RotationNode | null | undefined,
  branch: RotationBranch,
): boolean {
  if (!node) {
    return false
  }

  if (branch === 'setup') {
    // Setup executes preconditions only; display notes are inert and may sit beside them.
    return node.type === 'condition' || node.type === 'note'
  }

  return true
}

export function insertRotNode(
  items: RotationNode[],
  target: RotationInsertTarget,
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
        items: insertRotNode(item.items, target, node),
      }
    }

    if (item.type === 'uptime') {
      return {
        ...item,
        setup: item.setup ? insertRotNode(item.setup, target, node) : item.setup,
        items: insertRotNode(item.items, target, node),
      }
    }

    return item
  })
}

export function insertRotNodes(
  items: RotationNode[],
  target: RotationInsertTarget,
  nodes: RotationNode[],
): RotationNode[] {
  // insert each node with a moving offset so multi-node paste preserves order at the requested insertion point.
  return nodes.reduce((nextItems, node, offset) => insertRotNode(
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

function nodeCntnId(node: RotationNode, targetId: string): boolean {
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

function findNodeLctn(
  items: RotationNode[],
  nodeId: string,
  parentId: string | null = null,
  branch: RotationBranch = 'root',
): RotationNodeLocation | null {
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

function dtchRotNode(
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

function nsrtNodeAtTg(items: RotationNode[], target: RotationDropTarget, node: RotationNode): RotationNode[] {
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

export function moveRotNode(items: RotationNode[], draggedId: string, target: RotationDropTarget): RotationNode[] {
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

/** Every node in the tree by id, containers and their children alike. */
export function indexRotNodes(items: RotationNode[]): Map<string, RotationNode> {
  const nodesById = new Map<string, RotationNode>()

  const visit = (node: RotationNode) => {
    nodesById.set(node.id, node)

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
  return nodesById
}

/*
  removing a loop marker removes the loop, so the paired marker goes with it.
  a selection that took only one of the two would otherwise leave a marker
  standing alone and the rotation reading as an unclosed loop.
*/
export function removeRotNodes(items: RotationNode[], nodeIds: ReadonlySet<string>): RotationNode[] {
  const rmvdLoopIds = new Set<string>()
  for (const node of indexRotNodes(items).values()) {
    if (nodeIds.has(node.id) && node.type === 'loop' && node.kind === 'start') {
      rmvdLoopIds.add(node.loopId)
    }
  }

  const nextItems = items
    .filter((item) => !nodeIds.has(item.id))
    .map((item) => {
      if (item.type === 'repeat') {
        return {
          ...item,
          items: removeRotNodes(item.items, nodeIds),
        }
      }

      if (item.type === 'uptime') {
        return {
          ...item,
          setup: item.setup ? removeRotNodes(item.setup, nodeIds) : item.setup,
          items: removeRotNodes(item.items, nodeIds),
        }
      }

      return item
    })

  return rmLoopMrkr(nextItems, rmvdLoopIds)
}
