/*
  Author: Runor Ewhro
  Description: Feature attachment bag (conditions + child features) and
               normalization from the legacy feature.changes write list.
*/

import type {
  FeatureAttachments,
  RotationNode,
  RtChng,
} from '@/domain/gameData/contracts.ts'

export type RotConditionNode = Extract<RotationNode, { type: 'condition' }>
export type RotFeatureNode = Extract<RotationNode, { type: 'feature' }>
export type { FeatureAttachments }

export function isRotConditionNode(node: RotationNode): node is RotConditionNode {
  return node.type === 'condition'
}

export function isRotFeatureNode(node: RotationNode): node is RotFeatureNode {
  return node.type === 'feature'
}

/** Stable ids for conditions lifted from legacy `changes` arrays. */
export function legacyAttachedConditionId(parentId: string, index: number): string {
  return `${parentId}:attached:cond:${index}`
}

function changeToCondition(
  change: RtChng,
  parent: RotFeatureNode,
  index: number,
): RotConditionNode {
  return {
    id: legacyAttachedConditionId(parent.id, index),
    type: 'condition',
    resonatorId: change.resonatorId ?? parent.resonatorId,
    enabled: true,
    changes: [change],
  }
}

/**
 * Flatten every state write attached to a feature, whether stored as legacy
 * `changes` or as `attached.conditions`.
 */
export function attachedConditionChanges(
  node: RotFeatureNode,
  options: { enabledOnly?: boolean } = {},
): RtChng[] {
  const fromNodes = (node.attached?.conditions ?? []).flatMap((condition) =>
    condition.type === 'condition' && (!options.enabledOnly || condition.enabled !== false)
      ? condition.changes
      : [])
  return [...(node.changes ?? []), ...fromNodes]
}

/**
 * Fold legacy `changes` into `attached.conditions` and drop nested attach on
 * child features. Idempotent.
 */
export function normalizeFeatureAttachments(node: RotFeatureNode): RotFeatureNode {
  const existingConditions = (node.attached?.conditions ?? []).filter(isRotConditionNode)
  const existingFeatures = (node.attached?.features ?? [])
    .filter(isRotFeatureNode)
    .map(stripFeatureAttachments)

  const legacy = node.changes ?? []
  const lifted = legacy.map((change, index) => changeToCondition(change, node, index))

  const conditions = [...existingConditions, ...lifted]
  const features = existingFeatures

  const { changes: _removed, attached: _oldAttached, ...rest } = node
  void _removed
  void _oldAttached

  if (conditions.length === 0 && features.length === 0) {
    return rest as RotFeatureNode
  }

  return {
    ...(rest as RotFeatureNode),
    attached: { conditions, features },
  }
}

/** Child features may not carry attachments of their own. */
export function stripFeatureAttachments(node: RotFeatureNode): RotFeatureNode {
  if (!node.attached && !node.changes) {
    return node
  }
  const { attached: _a, changes: _c, ...rest } = node
  void _a
  void _c
  return rest as RotFeatureNode
}

/**
 * Replace a feature's attached conditions from a flat write list (UI editors).
 * Keeps any attached features already on the node.
 */
export function featureWithAttachedConditions(
  node: RotFeatureNode,
  changes: RtChng[],
): RotFeatureNode {
  const features = (node.attached?.features ?? [])
    .filter(isRotFeatureNode)
    .map(stripFeatureAttachments)
  const { changes: _legacy, attached: _old, ...rest } = node
  void _legacy
  void _old

  const conditions = changes.map((change, index) => changeToCondition(change, node, index))

  if (conditions.length === 0 && features.length === 0) {
    return rest as RotFeatureNode
  }

  return {
    ...(rest as RotFeatureNode),
    attached: { conditions, features },
  }
}
