/*
  Author: Runor Ewhro
  Description: Cleans and normalizes when-rule data when loop edits would
               otherwise leave behind stale loop filters.
*/

import type { RotationNode, RotWhenRule } from '@/domain/gameData/contracts.ts'

function clrWhenLoopR(when: RotWhenRule | undefined, loopIds: ReadonlySet<string>): RotWhenRule | undefined {
  if (!when?.loops?.length) {
    return when
  }

  const loops = when.loops.filter((rule) => !loopIds.has(rule.loopId))
  if (loops.length === when.loops.length) {
    return when
  }

  if (!when.condition && loops.length === 0) {
    return undefined
  }

  if (loops.length === 0) {
    const { loops: rmvdsy, ...whenWthtLps } = when
    void rmvdsy
    return whenWthtLps
  }

  return { ...when, loops }
}

function withPrndWhen(node: RotationNode, loopIds: ReadonlySet<string>): RotationNode {
  if (!('when' in node)) {
    return node
  }

  const nextWhen = clrWhenLoopR(node.when, loopIds)
  if (nextWhen === node.when) {
    return node
  }

  if (!nextWhen) {
    const { when: _removedWhen, ...nodeWthtWhen } = node
    void _removedWhen
    return nodeWthtWhen as RotationNode
  }

  return { ...node, when: nextWhen }
}

export function clrRotWhenLo(items: RotationNode[], loopIds: ReadonlySet<string>): RotationNode[] {
  if (loopIds.size === 0) {
    return items
  }

  return items.map((item) => {
    const nextItem = withPrndWhen(item, loopIds)

    if (nextItem.type === 'repeat') {
      return {
        ...nextItem,
        items: clrRotWhenLo(nextItem.items, loopIds),
      }
    }

    if (nextItem.type === 'uptime') {
      return {
        ...nextItem,
        setup: nextItem.setup ? clrRotWhenLo(nextItem.setup, loopIds) : nextItem.setup,
        items: clrRotWhenLo(nextItem.items, loopIds),
      }
    }

    return nextItem
  })
}
