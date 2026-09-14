/*
  Author: Runor Ewhro
  Description: Defines the feature-and-repeat rotation sequence supported by
               the compact rotation workflow.
*/

import type { RotationNode } from './contracts.ts'

type RotFeatureNode = Extract<RotationNode, { type: 'feature' }>
type RotRepeatNode = Extract<RotationNode, { type: 'repeat' }>

export type RotationSequenceFeature = Omit<
  RotFeatureNode,
  | 'attached'
  | 'changes'
  | 'condition'
  | 'editorSection'
  | 'negativeEffectInstances'
  | 'negativeEffectStacks'
  | 'negativeEffectStableWidth'
  | 'note'
>

export type RotationSequenceRepeat = Omit<
  RotRepeatNode,
  'condition' | 'editorSection' | 'items' | 'note' | 'resonatorId' | 'times'
> & {
  times: number
  items: RotationSequenceNode[]
}

export type RotationSequenceNode = RotationSequenceFeature | RotationSequenceRepeat

function hasAdvancedFeatureConfiguration(node: RotFeatureNode): boolean {
  return Boolean(
    node.editorSection
    || node.note
    || (node.attached?.conditions.length ?? 0) > 0
    || (node.attached?.features.length ?? 0) > 0
    || (node.changes?.length ?? 0) > 0
    || node.negativeEffectInstances != null
    || node.negativeEffectStacks != null
    || node.negativeEffectStableWidth != null
  )
}

export function isRotationSequenceNode(
  node: RotationNode,
  resonatorId?: string,
): node is RotationSequenceNode {
  if (node.type === 'feature') {
    return !hasAdvancedFeatureConfiguration(node)
      && (!resonatorId || !node.resonatorId || node.resonatorId === resonatorId)
  }

  if (node.type !== 'repeat') {
    return false
  }

  return !node.editorSection
    && !node.note
    && !node.resonatorId
    && typeof node.times === 'number'
    && Number.isInteger(node.times)
    && node.times >= 1
    && node.items.every((child) => isRotationSequenceNode(child, resonatorId))
}

export function isRotationSequence(
  items: readonly RotationNode[],
  resonatorId?: string,
): items is RotationSequenceNode[] {
  return items.every((node) => isRotationSequenceNode(node, resonatorId))
}
