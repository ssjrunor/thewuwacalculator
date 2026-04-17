/*
  author: runor ewhro
  description: shared helpers for reading and summarizing rotation node trees.
*/

import type { RotationNode } from '@/domain/gameData/contracts'
import { getSkillTabLabel } from '@/modules/calculator/model/skillTabs'

export interface RotationStatsOptions {
  previewLimit?: number
  getFeatureKind?: (node: RotationNode) => string | null | undefined
}

export interface RotationPreviewGroup {
  kind: string
  count: number
  label: string
}

export interface FlattenedPreviewNode {
  node: RotationNode
  inSetup: boolean
  depth: number
}

export interface RotationExtractedStats {
  totalNodes: number
  topLevelNodes: number
  setupNodes: number
  repeatNodes: number
  uptimeNodes: number
  conditionNodes: number
  featureNodes: number
  deepestDepth: number
  preview: RotationPreviewGroup[]
}

export function getOptionalNodeString(node: RotationNode, key: string): string | null {
  const value = (node as unknown as Record<string, unknown>)[key]
  return typeof value === 'string' && value ? value : null
}

export function getRotationNodeItems(node: RotationNode): RotationNode[] {
  if ('items' in node && Array.isArray(node.items)) return node.items
  return []
}

export function getRotationNodeSetup(node: RotationNode): RotationNode[] {
  if ('setup' in node && Array.isArray(node.setup)) return node.setup
  return []
}

export function getRotationNodeLabel(node: RotationNode): string {
  return (
    getOptionalNodeString(node, 'label') ||
    getOptionalNodeString(node, 'name') ||
    getOptionalNodeString(node, 'title') ||
    getOptionalNodeString(node, 'skillName') ||
    getOptionalNodeString(node, 'action') ||
    (node.type === 'condition' ? 'Condition' : null) ||
    (node.type === 'feature' ? 'Feature' : null) ||
    (node.type === 'repeat' ? 'Repeat' : null) ||
    node.type
  )
}

function getPreviewKind(node: RotationNode, options: RotationStatsOptions): string {
  if (node.type === 'feature') return options.getFeatureKind?.(node) ?? 'feature'
  if (node.type === 'condition') {
    const label = getRotationNodeLabel(node).toLowerCase()
    if (label.includes('uptime')) return 'uptime'
    return 'condition'
  }
  if (node.type === 'repeat') return 'repeat'
  return node.type
}

function formatUnknownKind(kind: string): string {
  return `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}`
}

function getPreviewGroupLabel(kind: string, count: number): string {
  const plural = count === 1 ? '' : 's'
  const tabLabel = getSkillTabLabel(kind)
  if (tabLabel !== kind) {
    return `${count} ${tabLabel}${plural}`
  }

  switch (kind) {
    case 'feature':
      return `${count} Feature${plural}`
    case 'uptime':
      return `${count} Uptime${plural}`
    case 'condition':
      return `${count} Condition${plural}`
    case 'repeat':
      return `${count} Repeat${plural}`
    default:
      return `${count} ${formatUnknownKind(kind)}${plural}`
  }
}

export function flattenRotationNodes(
  nodes: RotationNode[],
  depth = 1,
  inSetup = false,
): FlattenedPreviewNode[] {
  const result: FlattenedPreviewNode[] = []

  for (const node of nodes) {
    result.push({ node, inSetup, depth })

    const setup = getRotationNodeSetup(node)
    const children = getRotationNodeItems(node)

    if (setup.length > 0) {
      result.push(...flattenRotationNodes(setup, depth + 1, true))
    }

    if (children.length > 0) {
      result.push(...flattenRotationNodes(children, depth + 1, inSetup))
    }
  }

  return result
}

export function buildGroupedRotationPreview(
  nodes: RotationNode[],
  options: RotationStatsOptions = {},
): RotationPreviewGroup[] {
  const flattened = flattenRotationNodes(nodes)
  const groups: RotationPreviewGroup[] = []
  const limit = options.previewLimit ?? 10

  for (const { node } of flattened) {
    const kind = getPreviewKind(node, options)
    const last = groups[groups.length - 1]

    if (last && last.kind === kind) {
      last.count += 1
      last.label = getPreviewGroupLabel(last.kind, last.count)
    } else {
      groups.push({
        kind,
        count: 1,
        label: getPreviewGroupLabel(kind, 1),
      })
    }
  }

  return groups.slice(0, limit)
}

export function extractRotationStats(
  items: RotationNode[],
  options: RotationStatsOptions = {},
): RotationExtractedStats {
  let totalNodes = 0
  let setupNodes = 0
  let repeatNodes = 0
  let uptimeNodes = 0
  let conditionNodes = 0
  let featureNodes = 0
  let deepestDepth = 0

  const visit = (nodes: RotationNode[], depth: number, inSetup = false) => {
    deepestDepth = Math.max(deepestDepth, depth)

    for (const node of nodes) {
      totalNodes += 1
      if (inSetup) setupNodes += 1
      if (node.type === 'repeat') repeatNodes += 1
      if (node.type === 'uptime') uptimeNodes += 1
      if (node.type === 'condition') conditionNodes += 1
      if (node.type === 'feature') featureNodes += 1

      const setup = getRotationNodeSetup(node)
      const children = getRotationNodeItems(node)

      if (setup.length > 0) visit(setup, depth + 1, true)
      if (children.length > 0) visit(children, depth + 1, inSetup)
    }
  }

  visit(items, 1)

  return {
    totalNodes,
    topLevelNodes: items.length,
    setupNodes,
    repeatNodes,
    uptimeNodes,
    conditionNodes,
    featureNodes,
    deepestDepth,
    preview: buildGroupedRotationPreview(items, options),
  }
}
