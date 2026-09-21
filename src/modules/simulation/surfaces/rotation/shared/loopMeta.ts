/*
  Author: Runor Ewhro
  Description: Names, colours, and totals for the loops the rotation editor
               draws. The markers themselves live in
               `@/domain/gameData/rotationLoops.ts`.
*/

import type { DamageFeature, RotationNode } from '@/domain/gameData/contracts.ts'
import {
  normLoopRuns,
  type RotLoopEnd,
  type RotLoopNode,
  type RotLoopStart,
} from '@/domain/gameData/rotationLoops.ts'
import {
  makePaletteColor,
  ROT_LOOP_COLORS,
  scopeLabelAt,
} from './containerMeta.ts'
import type { NodeTotals } from './authoringTypes.ts'
import { isDamageRotationEntry } from '@/engine/pipeline/rotationTotals.ts'

export { makeBlockColor, ROT_LOOP_COLORS } from './containerMeta.ts'

interface RotLoopInfo {
  loopId: string
  startNode: RotLoopStart
  endNode?: RotLoopEnd
  label: string
  color: string
  runs: number
  totals: NodeTotals
  complete: boolean
  mode: 'forward' | 'wrap-end' | 'wrap-start'
}

interface LoopMarkerInfo extends RotLoopInfo {
  markerKind: 'start' | 'end'
}

const EMPTY_TOTALS: NodeTotals = { normal: 0, crit: 0, avg: 0 }

interface LoopNodeRecord {
  node: RotLoopNode
  index: number
  order: number
  siblingKey: string
}

function isLoopNode(node: RotationNode): node is RotLoopNode {
  return node.type === 'loop'
}

/** what the nth loop is called, counting from one. the first is just Loop */
function rotLoopLblAt(index: number): string {
  return scopeLabelAt('loop', index)
}

/**
 * The colour a new loop is given, the way its label is given: the next one
 * nothing else is using, so a loop reads apart from the loops around it.
 *
 * Colours are handed out in palette order, which is the cycle a rotation built
 * loop by loop ends up with. A colour freed by a deleted loop is offered again
 * before the palette starts over, so a new loop never takes the colour of one
 * standing beside it while a spare is going unused.
 */
export function makeLoopColor(colors: Iterable<string | null | undefined>): () => string {
  return makePaletteColor(ROT_LOOP_COLORS, colors)
}

function collectLoopNodes(
  items: RotationNode[],
  siblingKey = 'root',
  order = { value: 0 },
): LoopNodeRecord[] {
  const records: LoopNodeRecord[] = []

  // Sibling positions retain local wrap direction, while traversal order lets
  // a start and end remain paired when either marker crosses a block boundary.
  items.forEach((node, index) => {
    if (isLoopNode(node)) {
      records.push({ node, index, order: order.value, siblingKey })
    }
    order.value += 1

    if (node.type === 'repeat') {
      records.push(...collectLoopNodes(node.items, `${node.id}:items`, order))
      return
    }

    if (node.type === 'uptime') {
      records.push(...collectLoopNodes(node.setup ?? [], `${node.id}:setup`, order))
      records.push(...collectLoopNodes(node.items, `${node.id}:items`, order))
    }
  })

  return records
}

function indexLoopTotals(entries: DamageFeature[]): Map<string, NodeTotals> {
  const totalsByLoopId = new Map<string, NodeTotals>()
  for (const entry of entries) {
    if (!isDamageRotationEntry(entry)) continue
    for (const [loopId, run] of Object.entries(entry.loopRuns ?? {})) {
      if (run == null) continue
      let totals = totalsByLoopId.get(loopId)
      if (!totals) {
        totals = { ...EMPTY_TOTALS }
        totalsByLoopId.set(loopId, totals)
      }
      totals.normal += entry.normal
      totals.crit += entry.crit
      totals.avg += entry.avg
    }
  }
  return totalsByLoopId
}

function vrgLoopTtls(totals: NodeTotals, runs: number): NodeTotals {
  if (runs <= 1) {
    return totals
  }

  return {
    normal: totals.normal / runs,
    crit: totals.crit / runs,
    avg: totals.avg / runs,
  }
}

export function makeLoopInfo(
  items: RotationNode[],
  entries: DamageFeature[],
): {
  loops: RotLoopInfo[]
  markerInfoByNode: Record<string, LoopMarkerInfo>
} {
  const loopRecords = collectLoopNodes(items)
  const starts = loopRecords.filter((record): record is LoopNodeRecord & { node: RotLoopStart } =>
    record.node.kind === 'start',
  )
  const totalsByLoopId = indexLoopTotals(entries)
  const usedEndIds = new Set<string>()
  const loops = starts.map((startRecord, index): RotLoopInfo => {
    const start = startRecord.node
    // Pair by loop identity across the authored tree. Duplicate ends are
    // ignored so one malformed marker cannot make later loops ambiguous.
    const endRecord = loopRecords.find((record): record is LoopNodeRecord & { node: RotLoopEnd } =>
      !usedEndIds.has(record.node.id) &&
      record.node.kind === 'end' &&
      record.node.loopId === start.loopId,
    )
    const end = endRecord?.node
    if (end) {
      usedEndIds.add(end.id)
    }
    const mode = endRecord
      ? (
        endRecord.siblingKey === startRecord.siblingKey
          ? (endRecord.index > startRecord.index ? 'forward' : 'wrap-end')
          : (endRecord.order > startRecord.order ? 'forward' : 'wrap-end')
      )
      : 'wrap-start'

    const color = start.color ?? ROT_LOOP_COLORS[index % ROT_LOOP_COLORS.length]
    const runs = normLoopRuns(start.runs ?? 1)
    return {
      loopId: start.loopId,
      startNode: start,
      endNode: end,
      // an unnamed loop is called what the pane would have called it, so the
      // name holds if it is ever written down
      label: start.label ?? rotLoopLblAt(index + 1),
      color,
      runs,
      totals: vrgLoopTtls(totalsByLoopId.get(start.loopId) ?? { ...EMPTY_TOTALS }, runs),
      complete: Boolean(end),
      mode,
    }
  })

  const markerInfoByNode: Record<string, LoopMarkerInfo> = {}
  for (const loop of loops) {
    markerInfoByNode[loop.startNode.id] = { ...loop, markerKind: 'start' }
    if (loop.endNode) {
      markerInfoByNode[loop.endNode.id] = { ...loop, markerKind: 'end' }
    }
  }

  return { loops, markerInfoByNode: markerInfoByNode }
}
