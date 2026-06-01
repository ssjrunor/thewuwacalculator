/*
  Author: Runor Ewhro
  Description: Owns loop marker normalization, discovery, editing, and summary
               helpers for the calculator rotation editor.
*/

import type { DamageFeature, RotationNode } from '@/domain/gameData/contracts.ts'
import type { NodeTotals, RotNsrtTgt } from './types.ts'
import { nsrtRotNds } from './tree.ts'
import { formatNumber, makeNodeId } from './utils.ts'
import { clrRotWhenLo } from './when.ts'

export type RotLoopNode = Extract<RotationNode, { type: 'loop' }>
export type RotLoopStart = Extract<RotLoopNode, { kind: 'start' }>
export type RotLoopEndNo = Extract<RotLoopNode, { kind: 'end' }>

export interface RotLoopInfo {
  loopId: string
  startNode: RotLoopStart
  endNode?: RotLoopEndNo
  label: string
  color: string
  runs: number
  totals: NodeTotals
  complete: boolean
  mode: 'forward' | 'wrap-end' | 'wrap-start'
}

export interface RotLoopMrkrI extends RotLoopInfo {
  markerKind: 'start' | 'end'
}

export interface RotLoopDrftR {
  id: string
  nodeId?: string
  kind: 'start' | 'end'
  loopId: string
  label?: string
  color?: string
  runs?: number
  enabled?: boolean
  isNew?: boolean
}

export const ROT_LOOP_COLORS = [
  '#f59e0b',
  '#22c55e',
  '#38bdf8',
  '#f472b6',
  '#a78bfa',
  '#f97316',
]

const EMPTY_TOTALS: NodeTotals = { normal: 0, crit: 0, avg: 0 }

interface RotLoopNodeR {
  node: RotLoopNode
  index: number
  siblingKey: string
}

interface RotNodePathE {
  index: number
  siblingKey: string
}

export function isLoopNode(node: RotationNode): node is RotLoopNode {
  return node.type === 'loop'
}

export function normLoopRuns(value: unknown): number {
  // loop counts are user-entered, so every path clamps to a positive integer before reaching simulation or display.
  const numeric = typeof value === 'number' ? value : Number(value)
  return Math.max(1, Math.floor(Number.isFinite(numeric) ? numeric : 1))
}

export function mkLoopStartN(options: Partial<RotLoopStart> = {}): RotLoopStart {
  // start nodes own the loop identity; end nodes only point back to this loop id.
  const loopId = options.loopId ?? makeNodeId('rotation:loop')
  return {
    id: options.id ?? makeNodeId('rotation:loop-start'),
    type: 'loop',
    kind: 'start',
    loopId,
    label: options.label ?? 'Loop',
    color: options.color ?? ROT_LOOP_COLORS[0],
    runs: normLoopRuns(options.runs ?? 1),
    enabled: options.enabled ?? true,
    ...(options.when ? { when: options.when } : {}),
  }
}

export function mkLoopEndNod(start: RotLoopStart, options: Pick<Partial<RotLoopEndNo>, 'id'> = {}): RotLoopEndNo {
  return {
    id: options.id ?? makeNodeId('rotation:loop-end'),
    type: 'loop',
    kind: 'end',
    loopId: start.loopId,
    enabled: start.enabled ?? true,
  }
}

function cllcUsedLoop(labels: Iterable<string | null | undefined>): Set<number> {
  const used = new Set<number>()

  // only default-style labels reserve automatic numbers; custom labels should not affect the next generated `loop n`.
  for (const label of labels) {
    const trimmed = label?.trim()
    if (!trimmed) {
      continue
    }

    if (trimmed === 'Loop') {
      used.add(1)
      continue
    }

    const match = /^Loop\s+(\d+)$/.exec(trimmed)
    if (!match) {
      continue
    }

    const index = Number(match[1])
    if (Number.isInteger(index) && index > 1) {
      used.add(index)
    }
  }

  return used
}

export function mkRotLoopLbl(labels: Iterable<string | null | undefined>): () => string {
  const used = cllcUsedLoop(labels)

  return () => {
    let index = 1
    while (used.has(index)) {
      index += 1
    }
    used.add(index)
    return index === 1 ? 'Loop' : `Loop ${index}`
  }
}

export function mkLoopLblGnr(items: RotationNode[]): () => string {
  return mkRotLoopLbl(
    cllcLoopNds(items).flatMap((node) => (node.kind === 'start' ? [node.label] : [])),
  )
}

function vstRotNds(items: RotationNode[], visitor: (node: RotationNode) => void) {
  for (const item of items) {
    visitor(item)

    if (item.type === 'repeat') {
      vstRotNds(item.items, visitor)
      continue
    }

    if (item.type === 'uptime') {
      vstRotNds(item.setup ?? [], visitor)
      vstRotNds(item.items, visitor)
    }
  }
}

export function cllcLoopNds(items: RotationNode[]): RotLoopNode[] {
  const loops: RotLoopNode[] = []
  vstRotNds(items, (node) => {
    if (isLoopNode(node)) {
      loops.push(node)
    }
  })
  return loops
}

function cllcLoopNode(items: RotationNode[], siblingKey = 'root'): RotLoopNodeR[] {
  const records: RotLoopNodeR[] = []

  // sibling keys distinguish identical indexes in different branches, which matters because loop coverage only applies
  // to nodes in the same sibling list as the start marker.
  items.forEach((node, index) => {
    if (isLoopNode(node)) {
      records.push({ node, index, siblingKey })
    }

    if (node.type === 'repeat') {
      records.push(...cllcLoopNode(node.items, `${node.id}:items`))
      return
    }

    if (node.type === 'uptime') {
      records.push(...cllcLoopNode(node.setup ?? [], `${node.id}:setup`))
      records.push(...cllcLoopNode(node.items, `${node.id}:items`))
    }
  })

  return records
}

function findRotNodeP(
  items: RotationNode[],
  nodeId: string,
  siblingKey = 'root',
  path: RotNodePathE[] = [],
): RotNodePathE[] | null {
  for (const [index, node] of items.entries()) {
    const nextPath = [...path, { index, siblingKey }]
    if (node.id === nodeId) {
      return nextPath
    }

    if (node.type === 'repeat') {
      const found = findRotNodeP(node.items, nodeId, `${node.id}:items`, nextPath)
      if (found) {
        return found
      }
      continue
    }

    if (node.type === 'uptime') {
      const foundInSetup = findRotNodeP(node.setup ?? [], nodeId, `${node.id}:setup`, nextPath)
      if (foundInSetup) {
        return foundInSetup
      }

      const foundInItems = findRotNodeP(node.items, nodeId, `${node.id}:items`, nextPath)
      if (foundInItems) {
        return foundInItems
      }
    }
  }

  return null
}

function loopCvrsSbln(startIndex: number, endIndex: number | null, targetIndex: number): boolean {
  // a loop without an end wraps from the start through the sibling list boundary; an end before the start is also a
  // wrap loop, while a later end is a normal forward range.
  if (targetIndex === startIndex) {
    return false
  }

  if (endIndex == null) {
    return targetIndex > startIndex || targetIndex < startIndex
  }

  if (targetIndex === endIndex) {
    return false
  }

  if (endIndex > startIndex) {
    return targetIndex > startIndex && targetIndex < endIndex
  }

  return targetIndex > startIndex || targetIndex < endIndex
}

export function getRotLpsCvr(
  items: RotationNode[],
  nodeId: string | null | undefined,
  loops: RotLoopInfo[],
): RotLoopInfo[] {
  if (!nodeId || loops.length === 0) {
    return []
  }

  const targetPath = findRotNodeP(items, nodeId)
  if (!targetPath) {
    return []
  }

  const tgtNdxBySbln = new Map(targetPath.map((entry) => [entry.siblingKey, entry.index]))
  const records = cllcLoopNode(items)

  // compare the target against the start marker's sibling list only; ancestors and children are intentionally not
  // treated as covered by that loop marker pair.
  return loops.filter((loop) => {
    const startRecord = records.find((record) => record.node.kind === 'start' && record.node.loopId === loop.loopId)
    if (!startRecord) {
      return false
    }

    const targetIndex = tgtNdxBySbln.get(startRecord.siblingKey)
    if (targetIndex == null) {
      return false
    }

    const endRecord = records.find((record) =>
      record.siblingKey === startRecord.siblingKey &&
      record.node.kind === 'end' &&
      record.node.loopId === loop.loopId,
    )

    return loopCvrsSbln(startRecord.index, endRecord?.index ?? null, targetIndex)
  })
}

function sumLoopTtls(entries: DamageFeature[], loopId: string): NodeTotals {
  // simulated entries tag the loop runs they contributed to, so totals can be reconstructed after simulation without
  // re-walking the rotation tree.
  return entries.reduce(
    (total, entry) => {
      if (entry.loopRuns?.[loopId] == null) {
        return total
      }

      total.normal += entry.normal
      total.crit += entry.crit
      total.avg += entry.avg
      return total
    },
    { ...EMPTY_TOTALS },
  )
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

export function mkRotLoopInf(
  items: RotationNode[],
  entries: DamageFeature[],
): {
  loops: RotLoopInfo[]
  mrkrInfoByns: Record<string, RotLoopMrkrI>
} {
  const loopRecords = cllcLoopNode(items)
  const starts = loopRecords.filter((record): record is RotLoopNodeR & { node: RotLoopStart } =>
    record.node.kind === 'start',
  )
  const usedEndIds = new Set<string>()
  const loops = starts.map((startRecord, index): RotLoopInfo => {
    const start = startRecord.node
    // pair each start with the first unused end in the same sibling list; duplicate ends are ignored so one bad marker
    // cannot make later loops ambiguous.
    const endRecord = loopRecords.find((record): record is RotLoopNodeR & { node: RotLoopEndNo } =>
      !usedEndIds.has(record.node.id) &&
      record.siblingKey === startRecord.siblingKey &&
      record.node.kind === 'end' &&
      record.node.loopId === start.loopId,
    )
    const end = endRecord?.node
    if (end) {
      usedEndIds.add(end.id)
    }
    const mode = endRecord
      ? (endRecord.index > startRecord.index ? 'forward' : 'wrap-end')
      : 'wrap-start'

    const color = start.color ?? ROT_LOOP_COLORS[index % ROT_LOOP_COLORS.length]
    const runs = normLoopRuns(start.runs ?? 1)
    return {
      loopId: start.loopId,
      startNode: start,
      endNode: end,
      label: start.label ?? `Loop ${index + 1}`,
      color,
      runs,
      totals: vrgLoopTtls(sumLoopTtls(entries, start.loopId), runs),
      complete: Boolean(end),
      mode,
    }
  })

  const mrkrInfoByNo: Record<string, RotLoopMrkrI> = {}
  for (const loop of loops) {
    mrkrInfoByNo[loop.startNode.id] = { ...loop, markerKind: 'start' }
    if (loop.endNode) {
      mrkrInfoByNo[loop.endNode.id] = { ...loop, markerKind: 'end' }
    }
  }

  return { loops, mrkrInfoByns: mrkrInfoByNo }
}

export function mkLoopDrftRo(items: RotationNode[]): RotLoopDrftR[] {
  return cllcLoopNds(items).map((node, index) => ({
    id: node.id,
    nodeId: node.id,
    kind: node.kind,
    loopId: node.loopId,
    ...(node.kind === 'start'
      ? {
        label: node.label ?? '',
        color: node.color ?? ROT_LOOP_COLORS[index % ROT_LOOP_COLORS.length],
        runs: normLoopRuns(node.runs ?? 1),
        enabled: node.enabled ?? true,
      }
      : {
        enabled: node.enabled ?? true,
      }),
  }))
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

  const nextItems = updLoopNds(items, (node) => {
    if (!loopIds.has(node.loopId)) {
      return node
    }

    return null
  })

  return clrRotWhenLo(nextItems, loopIds)
}

export function applyLoopDrf(
  items: RotationNode[],
  target: RotNsrtTgt,
  rows: RotLoopDrftR[],
): RotationNode[] {
  const xstnNodeIds = new Set(cllcLoopNds(items).map((node) => node.id))
  const xstnLoopIds = new Set(cllcLoopNds(items).map((node) => node.loopId))

  const usedEndLoopI = new Set<string>()
  const nrmlRows = rows.flatMap((row): RotLoopNode[] => {
    const nodeId = row.nodeId ?? row.id
    if (row.kind === 'end') {
      // end rows are only valid when their referenced start row still exists and no other end already claimed it.
      const start = rows.find((candidate) => candidate.kind === 'start' && candidate.loopId === row.loopId)
      if (!start || usedEndLoopI.has(start.loopId)) {
        return []
      }
      usedEndLoopI.add(start.loopId)

      return [{
        id: nodeId,
        type: 'loop',
        kind: 'end',
        loopId: start.loopId,
        enabled: start.enabled ?? true,
      }]
    }

    const color = row.color ?? ROT_LOOP_COLORS[0]
    return [{
      id: nodeId,
      type: 'loop',
      kind: 'start',
      loopId: row.loopId,
      label: row.label || 'Loop',
      color,
      runs: normLoopRuns(row.runs),
      enabled: row.enabled ?? true,
    }]
  })

  const nrmlById = new Map(nrmlRows.map((node) => [node.id, node]))
  const updated = updLoopNds(items, (node) => {
    const replacement = nrmlById.get(node.id)
    if (!replacement) {
      return null
    }

    nrmlById.delete(node.id)
    if (replacement.kind === 'end') {
      return replacement
    }

    // preserve existing `when` rules and enabled state on surviving start markers while still accepting edited desc,
    // color, and run count from the modal draft.
    return {
      ...replacement,
      enabled: node.kind === 'start' ? node.enabled ?? replacement.enabled : replacement.enabled,
      ...(node.kind === 'start' && node.when ? { when: node.when } : {}),
    }
  })
  const newNodes = nrmlRows
    .filter((node) => !xstnNodeIds.has(node.id))
  const nextLoopIds = new Set(nrmlRows.map((node) => node.loopId))
  const rmvdLoopIds = new Set([...xstnLoopIds].filter((loopId) => !nextLoopIds.has(loopId)))
  const nextItems = newNodes.length ? nsrtRotNds(updated, target, newNodes) : updated

  return clrRotWhenLo(nextItems, rmvdLoopIds)
}

export function fmtLoopTtls(totals: NodeTotals): string {
  return `N ${formatNumber(totals.normal)} / C ${formatNumber(totals.crit)} / A ${formatNumber(totals.avg)}`
}
