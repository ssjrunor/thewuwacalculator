/*
  Author: Runor Ewhro
  Description: Resolves display identity, ownership, and execution state for rotation rows.
*/

import type { RunResult } from '@/modules/simulation/surfaces/rotation/program-editor/simulation/runProgram.ts'
import type {
  BuffLine,
  EditorBlock,
  EditorCondition,
  EditorHandoff,
  EditorMember,
  EditorNode,
  EditorNote,
  EditorExecutionScope,
  EditorSection,
  EditorStep,
  LoopRunSelections,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { editorNodeLabel } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import type { AttributeKey } from '@/domain/entities/stats.ts'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay.ts'
import { findNode, collectSubtrees } from '@/modules/simulation/surfaces/rotation/program-editor/model/treeEdit.ts'
import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'
import {
  blockAverageDamage,
  blockRunTotals as getBlockRunTotals,
  collectSectionSteps,
  isDisabledInTree,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/nodeMetrics.ts'
import {
  findNodeExecutionScope,
  formatExecutionRun,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/executionScope.ts'
import {
  findFeatureOccurrences,
  type FeatureOccurrence,
} from '@/modules/simulation/surfaces/rotation/program-editor/interaction/nodeNavigation.ts'
import { loopBodyItems, stepCount, stepDamageAt, stepHasRun } from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows.ts'
import { ROT_LOOP_COLORS } from '@/modules/simulation/surfaces/rotation/shared/loopMeta.ts'
import { ROT_BLOCK_COLORS } from '@/modules/simulation/surfaces/rotation/shared/containerMeta.ts'
import { ROT_NOTE_COLORS } from '@/modules/simulation/surfaces/rotation/shared/noteMeta.ts'
import { ROT_FORMULA_OWNER_KEY } from '@/modules/simulation/surfaces/rotation/shared/conditions.tsx'

/** what a state write looked like on the run being read */
interface ReadWrite {
  from?: string
  to: string
  rising: boolean
}

interface ReadItem {
  id: string
  type: EditorNode['type']
  label: string
  note?: string
}

interface ReadHistoryRow {
  nodeId: string
  by: string
  from?: string
  to: string
}

export interface ReadNode {
  id: string
  /** what the mode line calls it */
  kindLabel: string

  address: string | null
  label: string
  accent: string
  element: AttributeKey | null
  headIcon: string
  headAlt: string
  modifier: boolean
  step: EditorStep | null
  condition: EditorCondition | null
  block: EditorBlock | null
  handoff: EditorHandoff | null
  note: EditorNote | null
  attachedNote: EditorNote | null
  owner: EditorMember | null
  handoffFrom: EditorMember | null
  handoffTo: EditorMember | null
  run: number
  scope: EditorExecutionScope | null
  scopeLabel: string | null

  figure: number
  share: number
  words: number
  write: ReadWrite | null
  runTotals: number[]
  blockSteps: number
  items: ReadItem[]
  buffs: BuffLine[]
  occurrences: FeatureOccurrence[]
  history: ReadHistoryRow[]
  historyWord: string
}

function itemNote(node: EditorNode): string | undefined {
  if (node.type === 'step' && node.multiplier > 1) return `x${node.multiplier}`
  if (node.type === 'condition') return node.to
  return undefined
}

function countWords(text: string | undefined): number {
  const trimmed = text?.trim() ?? ''
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0
}

/**
 * Resolve everything the read panel prints for one node. `buffsFor` is handed
 * in because a buff line builds its own combat context, which only the page
 * holds the runtimes for.
 */
export function resolveReadNode({
  id,
  sections,
  members,
  result,
  runsByLoopId,
  totalAvg,
  buffsFor,
}: {
  id: string
  sections: EditorSection[]
  members: EditorMember[]
  result: RunResult | null | undefined
  runsByLoopId: LoopRunSelections
  totalAvg: number
  buffsFor: (step: EditorStep, run: number, disabled: boolean) => BuffLine[]
}): ReadNode | null {
  const found = findNode(sections, id)
  const standalone = collectSubtrees(sections, new Set([id]))[0]
  const note = standalone?.type === 'note' ? standalone : null
  if (!found && !note) {
    return null
  }

  const scope = findNodeExecutionScope(sections, id, runsByLoopId)
  const run = scope?.kind === 'loop' ? scope.run : 1
  const scopeLabel = scope ? formatExecutionRun(scope) : null

  const rawStep = collectSectionSteps(sections).find((entry) => entry.id === id) ?? null
  const rawCondition = found?.type === 'condition' ? found : null
  const rawHandoff = found?.type === 'swap' ? found : null
  const rawBlock = found && found.type !== 'step' && found.type !== 'condition'
    && found.type !== 'swap' && found.type !== 'note'
    ? found as EditorBlock
    : null

  const dead = (node: EditorStep | EditorCondition | EditorHandoff | EditorBlock | null) =>
    Boolean(node && isDisabledInTree(sections, node))

  const step = rawStep ? (dead(rawStep) ? { ...rawStep, disabled: true } : rawStep) : null
  const condition = rawCondition
    ? (dead(rawCondition) ? { ...rawCondition, disabled: true } : rawCondition)
    : null
  const handoff = rawHandoff
    ? (dead(rawHandoff) ? { ...rawHandoff, disabled: true } : rawHandoff)
    : null
  const block = rawBlock ? (dead(rawBlock) ? { ...rawBlock, disabled: true } : rawBlock) : null

  const ownerId = step?.memberId
    ?? (condition?.owner.kind === 'member' ? condition.owner.memberId : undefined)
  const owner = members.find((entry) => entry.id === ownerId) ?? null
  const handoffFrom = handoff ? members.find((entry) => entry.id === handoff.from) ?? null : null
  const handoffTo = handoff ? members.find((entry) => entry.id === handoff.to) ?? null : null

  const damage = step && !step.disabled && stepHasRun(step, run) ? stepDamageAt(step, run) : 0
  const runTotals = block ? getBlockRunTotals(block) : []
  const blockBody = block
    ? block.type === 'loop'
      ? loopBodyItems(sections, block.loopId ?? block.id)
      : block.children
    : []

  const write: ReadWrite | null = condition
    ? condition.byRun?.[run] ?? {
      from: condition.from,
      to: condition.to,
      rising: condition.rising,
    }
    : null

  const historyPath = handoff ? ACTIVE_RESONATOR_PATH : condition?.path
  const rawHistory = historyPath ? result?.history.get(historyPath) ?? [] : []
  const history: ReadHistoryRow[] = rawHistory.map((entry) => ({
    nodeId: entry.nodeId,
    by: entry.by,
    from: entry.from,
    to: entry.to,
  }))

  const element = step?.element ?? (step ? owner?.attribute ?? null : null)
  const modifier = condition?.state?.ownerKey === ROT_FORMULA_OWNER_KEY
  const accent = modifier
    ? 'var(--accent)'
    : handoff
      ? handoffTo ? ATTR_COLORS[handoffTo.attribute] : 'var(--accent)'
      : note
        ? note.color ?? ROT_NOTE_COLORS[0]
        : block
          ? block.color ?? (block.type === 'loop' ? ROT_LOOP_COLORS[0] : ROT_BLOCK_COLORS[0])
          : step?.color
            ?? (element
              ? ATTR_COLORS[element]
              : owner ? ATTR_COLORS[owner.attribute] : 'var(--accent)')

  const kindLabel = note
    ? 'note'
    : handoff
      ? 'handoff'
      : condition
        ? 'condition'
        : block
          ? block.type
          : 'step'

  const attached = (step ?? condition ?? handoff ?? block)?.attachedNote ?? null

  return {
    id,
    kindLabel,
    address: step ? `#${step.index + 1}` : scopeLabel,
    label: note?.label ?? step?.label ?? condition?.label ?? block?.label ?? 'Node',
    accent,
    element: step ? element : null,
    headIcon: condition
      ? condition.sourceIcon ?? owner?.profile ?? ''
      : owner?.profile ?? '',
    headAlt: condition
      ? condition.effectName ?? condition.sourceName ?? owner?.name ?? ''
      : owner?.name ?? '',
    modifier,
    step,
    condition,
    block,
    handoff,
    note,
    attachedNote: note ? null : attached,
    owner,
    handoffFrom,
    handoffTo,
    run,
    scope,
    scopeLabel,
    figure: block
      ? block.disabled ? 0 : blockAverageDamage(block, run, runTotals)
      : damage,
    share: totalAvg > 0 ? (damage / totalAvg) * 100 : 0,
    words: countWords(note?.text),
    write,
    runTotals,
    blockSteps: stepCount(blockBody),
    items: blockBody.map((child) => ({
      id: child.id,
      type: child.type,
      label: editorNodeLabel(child),
      note: itemNote(child),
    })),
    buffs: step ? buffsFor(step, run, Boolean(step.disabled)) : [],
    occurrences: step?.featureId ? findFeatureOccurrences(sections, step.featureId) : [],
    history,
    historyWord: handoff
      ? history.length === 1 ? 'handoff' : 'handoffs'
      : history.length === 1 ? 'write' : 'writes',
  }
}
