/*
  Author: Runor Ewhro
  Description: Defines the rotation pane's small authored subset.
*/

import type {
  RotationSequenceRepeat,
  RotationSequenceNode,
} from '@/domain/gameData/rotationSequence.ts'
export {
  isRotationSequence,
  isRotationSequenceNode,
} from '@/domain/gameData/rotationSequence.ts'
export type {
  RotationSequenceFeature,
  RotationSequenceRepeat,
  RotationSequenceNode,
} from '@/domain/gameData/rotationSequence.ts'
import {
  makeBlockColor,
  makeScopeLabel,
} from '@/modules/simulation/features/rotation/shared/containerMeta.ts'

interface RotationRepeatMeta {
  label: string
  color: string
}

export function collectRotationSubtrees(
  items: readonly RotationSequenceNode[],
  selectedIds: ReadonlySet<string>,
): RotationSequenceNode[] {
  const selected: RotationSequenceNode[] = []

  for (const node of items) {
    if (selectedIds.has(node.id)) {
      selected.push(node)
      continue
    }

    if (node.type === 'repeat') {
      selected.push(...collectRotationSubtrees(node.items, selectedIds))
    }
  }

  return selected
}

export function makeRotationRepeatMeta(
  items: readonly RotationSequenceNode[],
): RotationRepeatMeta {
  const repeats: RotationSequenceRepeat[] = []

  const visit = (nodes: readonly RotationSequenceNode[]) => {
    for (const node of nodes) {
      if (node.type !== 'repeat') {
        continue
      }
      repeats.push(node)
      visit(node.items)
    }
  }

  visit(items)
  return {
    label: makeScopeLabel('repeat', repeats.map((node) => node.label))(),
    color: makeBlockColor(repeats.map((node) => node.color))(),
  }
}
