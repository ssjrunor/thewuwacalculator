/*
  Author: Runor Ewhro
  Description: Flattens authored and executed rotation structures into stable editor row projections.
*/

import type {
  EditorNode,
  EditorStep,
  LoopRunSelections,
  MemberId,
  NodeOwner,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import {
  STAT_KEYS,
  factorAt,
  isTextStatKey,
  stepDamageAt,
  type StatKey,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows.ts'

/** one enclosing container, resolved for the pass the rows below it ran in */
export interface FlatScope {
  kind: 'loop' | 'repeat' | 'uptime'
  /** stable across passes; the run is what separates one band from the next */
  id: string
  label: string
  run: number
  runs: number
  /** uptime only: the share of the window this body was counted at */
  ratio?: number
  /** the body was evaluated in a branch that was rolled back afterwards */
  transient: boolean
}

/** a single state write, named by the source that owns it rather than a path */
export interface FlatWrite {
  id: string
  label: string
  /** semantic effect/passive identity, when this write came from a catalog choice */
  effectName?: string

  path?: string

  memberId?: MemberId
  owner?: NodeOwner
  sourceIcon?: string
  /** a state coming on, or a value going up */
  rising: boolean
  /** what it held before, when the engine could read it */
  from?: string
  /**
   * What it was set to. A handoff leaves this empty and carries `memberId`
   * instead: the value there is a resonator, and only the display knows their
   * name. An id is never something the reader is shown.
   */
  value: string
}

export interface FlatRowTarget {
  nodeId: string
  loopRuns?: LoopRunSelections
}

export type FlatRow =
  | {
    kind: 'hit'
    key: string
    step: EditorStep
    /** authored node represented by this execution entry when copied */
    copyNode?: EditorNode
    run: number
    scope: FlatScope[]
    target: FlatRowTarget
  }
  | {
    kind: 'state'
    key: string
    writes: FlatWrite[]
    /** authored condition represented by this execution entry when copied */
    copyNode?: EditorNode
    scope: FlatScope[]
    target: FlatRowTarget
  }

export function flatTargetMatchesRuns(
  target: FlatRowTarget,
  runsByLoopId: LoopRunSelections,
): boolean {
  return Object.entries(target.loopRuns ?? {}).every(
    ([loopId, run]) => (runsByLoopId[loopId] ?? 1) === run,
  )
}

/**
 * Keep a tree selection when it exists in the executed trace. If it does not,
 * walk forward through authored order (wrapping once) to the next node that
 * did execute. Repeated rows prefer the occurrence at the currently viewed
 * loop tuple.
 */
export function resolveFlatRowTarget(
  rows: readonly FlatRow[],
  selectedId: string | null,
  authoredOrder: readonly string[],
  runsByLoopId: LoopRunSelections,
): FlatRowTarget | null {
  if (!selectedId || rows.length === 0) return null

  const targetFor = (nodeId: string): FlatRowTarget | null => {
    let fallback: FlatRowTarget | null = null
    for (const row of rows) {
      if (row.target.nodeId !== nodeId) continue
      fallback ??= row.target
      if (flatTargetMatchesRuns(row.target, runsByLoopId)) return row.target
    }
    return fallback
  }

  const selected = targetFor(selectedId)
  if (selected) return selected

  const start = authoredOrder.indexOf(selectedId)
  if (start < 0) return rows[0]?.target ?? null
  for (let offset = 1; offset <= authoredOrder.length; offset += 1) {
    const nodeId = authoredOrder[(start + offset) % authoredOrder.length]
    if (!nodeId) continue
    const next = targetFor(nodeId)
    if (next) return next
  }
  return rows[0]?.target ?? null
}

export function countFlatSelectedEntries(
  rows: readonly FlatRow[],
  selectedIds: ReadonlySet<string>,
): { entries: number; hits: number; states: number } {
  let hits = 0
  let states = 0
  for (const row of rows) {
    if (!selectedIds.has(row.target.nodeId)) continue
    if (row.kind === 'hit') hits += 1
    else states += row.writes.length
  }
  return { entries: hits + states, hits, states }
}

/** Authored nodes represented by selected entries, in execution order. */
export function flatClipboardNodes(
  rows: readonly FlatRow[],
  selectedIds: ReadonlySet<string>,
): EditorNode[] {
  const nodes: EditorNode[] = []
  for (const row of rows) {
    if (!selectedIds.has(row.target.nodeId) || !row.copyNode) continue
    const copies = row.kind === 'state' ? Math.max(1, row.writes.length) : 1
    for (let index = 0; index < copies; index += 1) nodes.push(row.copyNode)
  }
  return nodes
}

export interface DrawnFlatRow {
  row: FlatRow
  /** Scope chain entered by this execution entry. */
  band: FlatScope[] | null

  face: boolean
  /**
   * Numeric factors reading exactly what they read on the hit before. The
   * authoring list fades its repeats for the same reason: down a register
   * this long the change points are what the eye should land on, and a column
   * of the same figure repeated forty times says nothing by shouting it.
   */
  ghost: ReadonlySet<StatKey>
  /**
   * Where this hit falls in the run, counted from one. An execution order is a
   * numbered thing, and the count is the one piece of navigation the authored
   * tree can never offer: it says both what this is and how far in it happened.
   */
  ordinal: number
}

const NUMERIC_KEYS = STAT_KEYS.filter((key) => !isTextStatKey(key))
const NO_GHOSTS: ReadonlySet<StatKey> = new Set()

export function decorateFlatRows(rows: readonly FlatRow[]): DrawnFlatRow[] {
  const out: DrawnFlatRow[] = []
  let open: FlatScope[] = []
  let owner = ''
  let previous: { step: EditorStep; run: number } | null = null
  let ordinal = 0

  for (const row of rows) {

    let shared = 0
    while (
      shared < open.length
      && shared < row.scope.length
      && open[shared]!.id === row.scope[shared]!.id
      && open[shared]!.run === row.scope[shared]!.run
    ) shared += 1
    const entered = row.scope.slice(shared)
    const band = entered.length > 0 ? entered : null
    open = [...row.scope]

    if (row.kind === 'state') {

      out.push({ row, band, face: false, ghost: NO_GHOSTS, ordinal })
      continue
    }

    const next = row.step.memberId
    const prior = previous
    ordinal += 1
    out.push({
      row,
      band,
      face: next !== owner,
      ghost: prior
        ? new Set(NUMERIC_KEYS.filter((key) =>
          factorAt(prior.step, prior.run, key) === factorAt(row.step, row.run, key)))
        : NO_GHOSTS,
      ordinal,
    })
    owner = next
    previous = { step: row.step, run: row.run }
  }

  return out
}

/**
 * Computes each resonator's contiguous tenure and its accumulated damage in a
 * single execution-order pass.
 */
export function flatTenureTotals(drawn: readonly DrawnFlatRow[]): {
  totals: number[]
  holders: MemberId[]
  indexByRow: number[]
} {
  const totals: number[] = []
  const holders: MemberId[] = []
  const indexByRow: number[] = []
  let current = -1

  for (const entry of drawn) {
    if (entry.row.kind === 'hit' && (entry.face || current < 0)) {
      totals.push(0)
      holders.push(entry.row.step.memberId)
      current += 1
    }
    indexByRow.push(Math.max(0, current))
    if (entry.row.kind !== 'hit') continue
    totals[current] = (totals[current] ?? 0) + stepDamageAt(entry.row.step, entry.row.run)
  }

  return { totals, holders, indexByRow }
}

/** the largest single hit in the flattened run, for marking the peak */
export function flatPeak(rows: readonly FlatRow[]): number {
  let peak = 0
  for (const row of rows) {
    if (row.kind !== 'hit') continue
    peak = Math.max(peak, stepDamageAt(row.step, row.run))
  }
  return peak
}

/** total of every hit shown, so the surface can state what it is summing */
export function flatTotal(rows: readonly FlatRow[]): number {
  let total = 0
  for (const row of rows) {
    if (row.kind === 'hit') total += stepDamageAt(row.step, row.run)
  }
  return total
}
