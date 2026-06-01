/*
  Author: Runor Ewhro
  Description: applies a supplied personal rotation item list onto a runtime
               snapshot while preserving the rest of the runtime shape.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'

interface ApplyPersRotOptions {
  ignoreLoops?: boolean
}

function dropLoopRules(node: RotationNode): RotationNode {
  if (!('when' in node) || !node.when?.loops?.length) {
    return node
  }

  const when = { ...node.when }
  delete when.loops

  return {
    ...node,
    when: Object.keys(when).length > 0 ? when : undefined,
  } as RotationNode
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

export function applyPersRot(
    runtime: ResRuntime,
    rotTms?: RotationNode[] | null,
    options: ApplyPersRotOptions = {},
): ResRuntime {
  const personalItems = structuredClone(rotTms ?? runtime.rotation.personalItems)

  return {
    ...runtime,
    rotation: {
      ...runtime.rotation,

      // force the runtime into personal rotation view
      view: 'personal',

      // prefer the provided rotation items when present
      // otherwise clone the runtime's existing personal rotation list
      // structuredClone avoids sharing mutable references with the source runtime
      personalItems: options.ignoreLoops
          ? stripRotLoops(personalItems)
          : personalItems,
    },
  }
}
