/*
  Author: Runor Ewhro
  Description: applies a supplied rotation program onto a runtime
               snapshot while preserving the rest of the runtime shape.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'

interface ApplyRotationProgramOptions {
  ignoreLoops?: boolean
}

function dropLoopRules(node: RotationNode): RotationNode {
  if (node.type !== 'feature' || !node.attached) {
    return node
  }

  return {
    ...node,
    attached: {
      conditions: node.attached.conditions.map(
        (condition) => dropLoopRules(condition) as Extract<RotationNode, { type: 'condition' }>,
      ),
      features: node.attached.features.map(
        (feature) => dropLoopRules(feature) as Extract<RotationNode, { type: 'feature' }>,
      ),
    },
  }
}

export function stripRotLoops(items: RotationNode[]): RotationNode[] {
  return items.flatMap((node): RotationNode[] => {
    if (node.type === 'loop') {
      return []
    }

    const baseNode = dropLoopRules(node)

    if (baseNode.type === 'repeat') {
      return [{
        ...baseNode,
        items: stripRotLoops(baseNode.items),
      }]
    }

    if (baseNode.type === 'uptime') {
      return [{
        ...baseNode,
        setup: baseNode.setup ? stripRotLoops(baseNode.setup) : undefined,
        items: stripRotLoops(baseNode.items),
      }]
    }

    return [baseNode]
  })
}

export function applyRotationProgram(
    runtime: ResRuntime,
    rotTms?: RotationNode[] | null,
    options: ApplyRotationProgramOptions = {},
): ResRuntime {
  const items = structuredClone(rotTms ?? runtime.rotation.sequence)

  return {
    ...runtime,
    rotation: {
      ...runtime.rotation,
      // prefer the provided rotation items when present
      // otherwise clone the runtime's existing rotation list
      // structuredClone avoids sharing mutable references with the source runtime
      sequence: options.ignoreLoops
          ? stripRotLoops(items)
          : items,
    },
  }
}
