/*
  Author: Runor Ewhro
  Description: shared helpers for reading and summarizing rotation node trees.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { getSkillTabLabel } from '@/modules/calculator/model/skillTabs.ts'

export interface RotSttsPtns {
  previewLimit?: number
  getFeatKind?: (node: RotationNode) => string | null | undefined
}

export interface RotPrvwGrp {
  kind: string
  count: number
  label: string
}

export interface FlttPrvwNode {
  node: RotationNode
  inSetup: boolean
  depth: number
}

export interface RotXtrcStts {
  totalNodes: number
  topLvlNds: number
  setupNodes: number
  repeatNodes: number
  uptimeNodes: number
  condNds: number
  featureNodes: number
  deepestDepth: number
  preview: RotPrvwGrp[]
}

export function getPtnlNodeS(node: RotationNode, key: string): string | null {
  const value = (node as unknown as Record<string, unknown>)[key]
  return typeof value === 'string' && value ? value : null
}

export function getRotNodeTm(node: RotationNode): RotationNode[] {
  if ('items' in node && Array.isArray(node.items)) return node.items
  return []
}

export function getRotNodeSt(node: RotationNode): RotationNode[] {
  if ('setup' in node && Array.isArray(node.setup)) return node.setup
  return []
}

export function getRotNodeLb(node: RotationNode): string {
  return (
    getPtnlNodeS(node, 'label') ||
    getPtnlNodeS(node, 'name') ||
    getPtnlNodeS(node, 'title') ||
    getPtnlNodeS(node, 'skillName') ||
    getPtnlNodeS(node, 'action') ||
    (node.type === 'condition' ? 'Condition' : null) ||
    (node.type === 'feature' ? 'Feature' : null) ||
    (node.type === 'repeat' ? 'Repeat' : null) ||
    node.type
  )
}

function getPrvwKind(node: RotationNode, options: RotSttsPtns): string {
  if (node.type === 'feature') return options.getFeatKind?.(node) ?? 'feature'
  if (node.type === 'condition') {
    const label = getRotNodeLb(node).toLowerCase()
    if (label.includes('uptime')) return 'uptime'
    return 'condition'
  }
  if (node.type === 'repeat') return 'repeat'
  return node.type
}

function fmtNknwKind(kind: string): string {
  return `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}`
}

function getPrvwGrpLb(kind: string, count: number): string {
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
      return `${count} ${fmtNknwKind(kind)}${plural}`
  }
}

export function flttRotNds(
  nodes: RotationNode[],
  depth = 1,
  inSetup = false,
): FlttPrvwNode[] {
  const result: FlttPrvwNode[] = []

  for (const node of nodes) {
    result.push({ node, inSetup, depth })

    const setup = getRotNodeSt(node)
    const children = getRotNodeTm(node)

    if (setup.length > 0) {
      result.push(...flttRotNds(setup, depth + 1, true))
    }

    if (children.length > 0) {
      result.push(...flttRotNds(children, depth + 1, inSetup))
    }
  }

  return result
}

export function mkGrpdRotPrv(
  nodes: RotationNode[],
  options: RotSttsPtns = {},
): RotPrvwGrp[] {
  const flattened = flttRotNds(nodes)
  const groups: RotPrvwGrp[] = []
  const limit = options.previewLimit ?? 10

  for (const { node } of flattened) {
    const kind = getPrvwKind(node, options)
    const last = groups[groups.length - 1]

    if (last && last.kind === kind) {
      last.count += 1
      last.label = getPrvwGrpLb(last.kind, last.count)
    } else {
      groups.push({
        kind,
        count: 1,
        label: getPrvwGrpLb(kind, 1),
      })
    }
  }

  return groups.slice(0, limit)
}

export function xtrcRotStts(
  items: RotationNode[],
  options: RotSttsPtns = {},
): RotXtrcStts {
  let totalNodes = 0
  let setupNodes = 0
  let repeatNodes = 0
  let uptimeNodes = 0
  let condNds = 0
  let featureNodes = 0
  let deepestDepth = 0

  const visit = (nodes: RotationNode[], depth: number, inSetup = false) => {
    deepestDepth = Math.max(deepestDepth, depth)

    for (const node of nodes) {
      totalNodes += 1
      if (inSetup) setupNodes += 1
      if (node.type === 'repeat') repeatNodes += 1
      if (node.type === 'uptime') uptimeNodes += 1
      if (node.type === 'condition') condNds += 1
      if (node.type === 'feature') featureNodes += 1

      const setup = getRotNodeSt(node)
      const children = getRotNodeTm(node)

      if (setup.length > 0) visit(setup, depth + 1, true)
      if (children.length > 0) visit(children, depth + 1, inSetup)
    }
  }

  visit(items, 1)

  return {
    totalNodes,
    topLvlNds: items.length,
    setupNodes,
    repeatNodes,
    uptimeNodes,
    condNds: condNds,
    featureNodes,
    deepestDepth,
    preview: mkGrpdRotPrv(items, options),
  }
}
