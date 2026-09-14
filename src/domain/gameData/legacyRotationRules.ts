/*
  Author: Runor Ewhro
  Description: Implements the legacyRotationRules logic for the gameData module.
*/

import type {
  RotationNode,
  RtChng,
} from '@/domain/gameData/contracts.ts'

/** Persisted pre-fork run rule. It is accepted only by compatibility migration. */
export interface LegacyRotWhenRunOverride {
  runs: Record<string, number>
  multiplier?: number
  times?: number
  ratio?: number
  changes?: RtChng[]
}

/** Persisted pre-fork run rule. Current RotationNode does not expose this. */
export interface LegacyRotWhenRule {
  loops?: Array<{ loopId: string; runs: number[] }>
  overrides?: LegacyRotWhenRunOverride[]
}

type LegacyWhenNode = RotationNode & { when?: LegacyRotWhenRule }

export function readLegacyRotWhen(node: RotationNode): LegacyRotWhenRule | undefined {
  return (node as LegacyWhenNode).when
}

function writeLegacyRotWhen(
  node: RotationNode,
  when: LegacyRotWhenRule | undefined,
): RotationNode {
  const { when: _previous, ...current } = node as LegacyWhenNode
  void _previous
  return (when ? { ...current, when } : current) as unknown as RotationNode
}

function scopeLegacyWhenToLoops(
  when: LegacyRotWhenRule | undefined,
  activeLoopIds: ReadonlySet<string>,
): LegacyRotWhenRule | undefined {
  if (!when) {
    return undefined
  }

  const loops = (when.loops ?? []).filter((rule) => activeLoopIds.has(rule.loopId))
  const overrides = (when.overrides ?? []).filter((override) => {
    const loopIds = Object.keys(override.runs)
    return loopIds.length > 0 && loopIds.every((loopId) => activeLoopIds.has(loopId))
  })

  if (loops.length === 0 && overrides.length === 0) {
    return undefined
  }

  return {
    ...(loops.length > 0 ? { loops } : {}),
    ...(overrides.length > 0 ? { overrides } : {}),
  }
}

interface FlatLoopNode {
  node: RotationNode
  order: number
  siblingKey: string
  siblingIndex: number
  indexBySibling: ReadonlyMap<string, number>
}

interface LoopRange {
  loopId: string
  start: FlatLoopNode
  end: FlatLoopNode | null
}

function flattenLoopNodes(
  items: RotationNode[],
  siblingKey = 'root',
  inheritedIndexes: ReadonlyMap<string, number> = new Map(),
  order = { value: 0 },
): FlatLoopNode[] {
  const records: FlatLoopNode[] = []

  items.forEach((node, siblingIndex) => {
    const indexBySibling = new Map(inheritedIndexes)
    indexBySibling.set(siblingKey, siblingIndex)
    records.push({
      node,
      order: order.value,
      siblingKey,
      siblingIndex,
      indexBySibling,
    })
    order.value += 1

    if (node.type === 'repeat') {
      records.push(...flattenLoopNodes(
        node.items,
        `${node.id}:items`,
        indexBySibling,
        order,
      ))
    } else if (node.type === 'uptime') {
      records.push(...flattenLoopNodes(
        node.setup ?? [],
        `${node.id}:setup`,
        indexBySibling,
        order,
      ))
      records.push(...flattenLoopNodes(
        node.items,
        `${node.id}:items`,
        indexBySibling,
        order,
      ))
    }
  })

  return records
}

function collectLoopRanges(records: FlatLoopNode[]): LoopRange[] {
  const usedEndIds = new Set<string>()
  return records.flatMap((start): LoopRange[] => {
    if (start.node.type !== 'loop' || start.node.kind !== 'start') {
      return []
    }
    const startNode = start.node

    const end = records.find((candidate) =>
      !usedEndIds.has(candidate.node.id)
      && candidate.node.type === 'loop'
      && candidate.node.kind === 'end'
      && candidate.node.loopId === startNode.loopId)
      ?? null
    if (end) {
      usedEndIds.add(end.node.id)
    }
    return [{
      loopId: startNode.loopId,
      start,
      end,
    }]
  })
}

function loopCoversNode(range: LoopRange, candidate: FlatLoopNode): boolean {
  if (
    candidate.node.id === range.start.node.id
    || candidate.node.id === range.end?.node.id
  ) {
    return false
  }

  if (!range.end || range.end.siblingKey === range.start.siblingKey) {
    const candidateIndex = candidate.indexBySibling.get(range.start.siblingKey)
    if (candidateIndex == null) {
      return false
    }
    if (!range.end) {
      return candidateIndex !== range.start.siblingIndex
    }
    if (range.end.siblingIndex > range.start.siblingIndex) {
      return (
        candidateIndex > range.start.siblingIndex
        && candidateIndex < range.end.siblingIndex
      )
    }
    return (
      candidateIndex > range.start.siblingIndex
      || candidateIndex < range.end.siblingIndex
    )
  }

  if (range.end.order > range.start.order) {
    return candidate.order > range.start.order && candidate.order < range.end.order
  }
  return candidate.order > range.start.order || candidate.order < range.end.order
}

function withScopedWhen(node: RotationNode, activeLoopIds: ReadonlySet<string>): RotationNode {
  const previous = readLegacyRotWhen(node)
  if (!previous) {
    return node
  }

  return writeLegacyRotWhen(node, scopeLegacyWhenToLoops(previous, activeLoopIds))
}

export function scopeLegacyRotationRulesToLoops(
  items: RotationNode[],
  inheritedLoopIds: ReadonlySet<string> = new Set(),
): RotationNode[] {
  const loopScopeByNodeId = collectLegacyLoopScopeByNode(items, inheritedLoopIds)

  const scopeNodes = (
    nodes: RotationNode[],
    inherited: ReadonlySet<string>,
  ): RotationNode[] => nodes.map((node) => {
    const activeLoopIds = loopScopeByNodeId.get(node.id) ?? inherited
    const scopedNode = withScopedWhen(node, activeLoopIds)

    if (scopedNode.type === 'feature' && scopedNode.attached) {
      return {
        ...scopedNode,
        attached: {
          conditions: scopeNodes(
            scopedNode.attached.conditions,
            activeLoopIds,
          ) as Extract<RotationNode, { type: 'condition' }>[],
          features: scopeNodes(
            scopedNode.attached.features,
            activeLoopIds,
          ) as Extract<RotationNode, { type: 'feature' }>[],
        },
      }
    }

    if (scopedNode.type === 'repeat') {
      return {
        ...scopedNode,
        items: scopeNodes(scopedNode.items, activeLoopIds),
      }
    }
    if (scopedNode.type === 'uptime') {
      return {
        ...scopedNode,
        setup: scopedNode.setup
          ? scopeNodes(scopedNode.setup, activeLoopIds)
          : scopedNode.setup,
        items: scopeNodes(scopedNode.items, activeLoopIds),
      }
    }
    return scopedNode
  })

  return scopeNodes(items, inheritedLoopIds)
}

function collectLegacyLoopScopeByNode(
  items: RotationNode[],
  inheritedLoopIds: ReadonlySet<string> = new Set(),
): Map<string, ReadonlySet<string>> {
  const records = flattenLoopNodes(items)
  const ranges = collectLoopRanges(records)
  const loopScopeByNodeId = new Map<string, ReadonlySet<string>>()

  for (const record of records) {
    const activeLoopIds = new Set(inheritedLoopIds)
    for (const range of ranges) {
      if (loopCoversNode(range, record)) {
        activeLoopIds.add(range.loopId)
      }
    }
    loopScopeByNodeId.set(record.node.id, activeLoopIds)
  }

  /*
    Attachments execute at their parent's cursor rather than owning a place in
    the flat marker stream. Give them that exact structural scope so loop
    legacy rules receive the same structural scope as their parent before the
    one-time migration materializes them.
  */
  const indexAttachments = (
    node: RotationNode,
    inherited: ReadonlySet<string>,
  ) => {
    if (node.type !== 'feature') {
      return
    }

    for (const child of [
      ...(node.attached?.conditions ?? []),
      ...(node.attached?.features ?? []),
    ]) {
      const activeLoopIds = loopScopeByNodeId.get(child.id) ?? new Set(inherited)
      if (!loopScopeByNodeId.has(child.id)) {
        loopScopeByNodeId.set(child.id, activeLoopIds)
      }
      indexAttachments(child, activeLoopIds)
    }
  }

  for (const record of records) {
    indexAttachments(record.node, loopScopeByNodeId.get(record.node.id) ?? inheritedLoopIds)
  }

  return loopScopeByNodeId
}
/* Input-only support for rotations authored before exact loop pass forks. */
