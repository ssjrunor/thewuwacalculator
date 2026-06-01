/*
  Author: Runor Ewhro
  Description: Normalizes rotation inspection output into display rows and
               summary values for the rotation inspector ui.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { SkillAggType } from '@/domain/entities/stats.ts'
import type { RotNspcEnt, RotNspcVl } from '@/engine/rotation/system'
import { fmtSttVl, getCondChoice } from '@/modules/calculator/features/rotation/lib/conditions.tsx'
import { getRotLpsCvr, type RotLoopInfo } from '@/modules/calculator/features/rotation/lib/loops.ts'
import type { CondChoice, NodeTotals } from '@/modules/calculator/features/rotation/lib/types.ts'
import { formatNumber } from '@/modules/calculator/features/rotation/lib/utils.ts'

interface RotLoopCtx {
  loopRuns: Record<string, number>
  loopRunCnts: Record<string, number>
}

export interface RotWhenNspcR {
  loopId: string
  label: string
  color: string
  run: number
  totalRuns: number
}

export interface RotWhenRow {
  key: string
  label: string
  contexts: RotWhenNspcR[]
  disabled: boolean
  totals?: NodeTotals
  ggrgType?: SkillAggType
  valueLabel?: string
  valueText?: string
}

function getCtxKey(loopRuns: Record<string, number>, loopOrder: string[]): string {
  return loopOrder.map((loopId) => `${loopId}:${loopRuns[loopId] ?? 0}`).join('|')
}

function mkLoopCntx(loops: RotLoopInfo[]): RotLoopCtx[] {
  if (loops.length === 0) {
    return [{ loopRuns: {}, loopRunCnts: {} }]
  }

  return loops.reduce<RotLoopCtx[]>(
    (contexts, loop) => {
      const next: RotLoopCtx[] = []

      for (const context of contexts) {
        for (let run = 1; run <= Math.max(1, Math.floor(loop.runs ?? 1)); run += 1) {
          next.push({
            loopRuns: {
              ...context.loopRuns,
              [loop.loopId]: run,
            },
            loopRunCnts: {
              ...context.loopRunCnts,
              [loop.loopId]: Math.max(1, Math.floor(loop.runs ?? 1)),
            },
          })
        }
      }

      return next
    },
    [{ loopRuns: {}, loopRunCnts: {} }],
  )
}

function mkCtxLbl(context: RotLoopCtx, loops: RotLoopInfo[]): string {
  if (loops.length === 0) {
    return 'Current context'
  }

  return loops
    .map((loop) => `${loop.label} #${context.loopRuns[loop.loopId]}/${context.loopRunCnts[loop.loopId]}`)
    .join(' · ')
}

function resNspcLoopI(
  items: RotationNode[],
  node: RotationNode,
  allLoops: RotLoopInfo[],
): { traceNodeId: string; loops: RotLoopInfo[] } {
  if (node.type !== 'loop') {
    return {
      traceNodeId: node.id,
      loops: getRotLpsCvr(items, node.id, allLoops),
    }
  }

  const linkedStart = allLoops.find((loop) => loop.loopId === node.loopId)
  const startNodeId = linkedStart?.startNode.id ?? node.id
  const outerLoops = getRotLpsCvr(items, startNodeId, allLoops)

  return {
    traceNodeId: startNodeId,
    loops: linkedStart ? [...outerLoops, linkedStart] : outerLoops,
  }
}

function mtchCtx(
  entry: RotNspcEnt,
  loopOrder: string[],
  context: RotLoopCtx,
  ownLoopId?: string,
): boolean {
  const entryRuns = entry.loopRuns ?? {}

  return loopOrder.every((loopId) => {
    if (loopId === ownLoopId && entryRuns[loopId] == null) {
      return true
    }

    return entryRuns[loopId] === context.loopRuns[loopId]
  })
}

function findEntForCt(
  entries: RotNspcEnt[],
  loops: RotLoopInfo[],
  context: RotLoopCtx,
  ownLoopId?: string,
): RotNspcEnt | null {
  const loopOrder = loops.map((loop) => loop.loopId)
  return entries.find((entry) => mtchCtx(entry, loopOrder, context, ownLoopId)) ?? null
}

function fmtNspcVl(
  node: RotationNode,
  value: RotNspcVl,
  choices: CondChoice[],
): Pick<RotWhenRow, 'totals' | 'ggrgType' | 'valueLabel' | 'valueText'> {
  if (value.kind === 'feature') {
    return {
      totals: {
        normal: value.normal,
        crit: value.crit,
        avg: value.avg,
      },
      ggrgType: value.ggrgType,
    }
  }

  if (value.kind === 'condition') {
    const displayChange = node.type === 'condition' ? node.changes[0] : undefined
    const choice = getCondChoice(choices, displayChange, 'resonatorId' in node ? node.resonatorId : undefined)
    return {
      valueLabel: choice?.label ?? displayChange?.path ?? value.path,
      valueText: choice ? fmtSttVl(choice.state, value.value) : String(value.value ?? '-'),
    }
  }

  if (value.kind === 'repeat') {
    return {
      valueLabel: 'Repeat',
      valueText: `${value.times} ${value.times === 1 ? 'time' : 'times'}`,
    }
  }

  if (value.kind === 'uptime') {
    return {
      valueLabel: 'Uptime',
      valueText: `${formatNumber(value.ratio * 100)}% uptime`,
    }
  }

  return {
    valueLabel: value.label,
    valueText: `${value.runs} ${value.runs === 1 ? 'time' : 'times'}`,
  }
}

export function mkWhenNspcRo(options: {
  items: RotationNode[]
  node: RotationNode
  allLoops: RotLoopInfo[]
  traces: RotNspcEnt[]
  choices: CondChoice[]
}): RotWhenRow[] {
  const { traceNodeId, loops } = resNspcLoopI(options.items, options.node, options.allLoops)
  const nodeEntries = options.traces.filter((entry) => entry.nodeId === traceNodeId)
  const contexts = mkLoopCntx(loops)
  const ownLoopId = options.node.type === 'loop' ? options.node.loopId : undefined

  return contexts.map((context) => {
    const entry = findEntForCt(nodeEntries, loops, context, ownLoopId)
    const disabled = !entry || !entry.executed

    return {
      key: `${traceNodeId}:${getCtxKey(context.loopRuns, loops.map((loop) => loop.loopId))}`,
      label: mkCtxLbl(context, loops),
      contexts: loops.map<RotWhenNspcR>((loop) => ({
        loopId: loop.loopId,
        label: loop.label,
        color: loop.color,
        run: context.loopRuns[loop.loopId] ?? 0,
        totalRuns: context.loopRunCnts[loop.loopId] ?? Math.max(1, Math.floor(loop.runs ?? 1)),
      })),
      disabled,
      ...(entry?.value && !disabled ? fmtNspcVl(options.node, entry.value, options.choices) : {}),
    }
  })
}
