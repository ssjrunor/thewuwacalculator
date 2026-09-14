/*
  Author: Runor Ewhro
  Description: Implements rotation loops data-flow and calculation invariants.
*/

import type { RotationNode } from './contracts.ts'
import { makeNodeId } from './rotationNodeId.ts'

export type RotLoopNode = Extract<RotationNode, { type: 'loop' }>
export type RotLoopStart = Extract<RotLoopNode, { kind: 'start' }>
export type RotLoopEnd = Extract<RotLoopNode, { kind: 'end' }>

export interface RotWrapLoopPlan {
  start: RotLoopStart
  startIndex: number
  endIndex: number | null
}

export function isLoopNode(node: RotationNode): node is RotLoopNode {
  return node.type === 'loop'
}

export function normLoopRuns(value: unknown): number {
  // loop counts are user-entered, so every path clamps to a positive integer before reaching simulation or display.
  const numeric = typeof value === 'number' ? value : Number(value)
  return Math.max(1, Math.floor(Number.isFinite(numeric) ? numeric : 1))
}

export function makeLoopStart(options: Partial<RotLoopStart> = {}): RotLoopStart {
  // start nodes own the loop identity; end nodes only point back to this loop id.
  const loopId = options.loopId ?? makeNodeId('rotation:loop')
  return {
    id: options.id ?? makeNodeId('rotation:loop-start'),
    type: 'loop',
    kind: 'start',
    loopId,
    label: options.label ?? 'Loop',
    ...(options.color ? { color: options.color } : {}),
    runs: normLoopRuns(options.runs ?? 1),
    enabled: options.enabled ?? true,
  }
}

export function makeLoopEnd(start: RotLoopStart, options: Pick<Partial<RotLoopEnd>, 'id'> = {}): RotLoopEnd {
  return {
    id: options.id ?? makeNodeId('rotation:loop-end'),
    type: 'loop',
    kind: 'end',
    loopId: start.loopId,
    enabled: start.enabled ?? true,
  }
}

export function findRotWrapLoop(items: RotationNode[]): RotWrapLoopPlan | null {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item || !isLoopNode(item) || item.kind !== 'start') {
      continue
    }

    const isEnd = (candidate: RotationNode) =>
      isLoopNode(candidate) && candidate.kind === 'end' && candidate.loopId === item.loopId

    /*
      a loop closes at the first end that follows it. only when nothing follows
      it is a marker standing before it its own, and it runs back around.

      looking forward first matters for a rotation written with the same loop
      identity twice, which a saved rotation can hold: taking the first end in
      the list would pair a later loop with an earlier loop's marker and read
      the whole thing as closing before it opens.
    */
    if (items.some((candidate, at) => at > index && isEnd(candidate))) {
      continue
    }

    const endIndex = items.findIndex(isEnd)
    return { start: item, startIndex: index, endIndex: endIndex < 0 ? null : endIndex }
  }

  return null
}

function updLoopNds(
  items: RotationNode[],
  updater: (node: RotLoopNode) => RotLoopNode | null,
): RotationNode[] {
  return items.flatMap((item): RotationNode[] => {
    if (isLoopNode(item)) {
      const next = updater(item)
      return next ? [next] : []
    }

    if (item.type === 'repeat') {
      return [{ ...item, items: updLoopNds(item.items, updater) }]
    }

    if (item.type === 'uptime') {
      return [{
        ...item,
        setup: item.setup ? updLoopNds(item.setup, updater) : item.setup,
        items: updLoopNds(item.items, updater),
      }]
    }

    return [item]
  })
}

export function rmLoopMrkr(items: RotationNode[], loopIds: ReadonlySet<string>): RotationNode[] {
  if (loopIds.size === 0) {
    return items
  }

  return updLoopNds(items, (node) => (loopIds.has(node.loopId) ? null : node))
}
