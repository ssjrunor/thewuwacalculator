/*
  Author: Runor Ewhro
  Description: Implements the nodeMetrics logic for the presentation module.
*/

/* Read-only calculations over the editor tree and its selected loop passes. */

import type {
  EditorBlock,
  EditorCondition,
  EditorHandoff,
  EditorSection,
  EditorStep,
  LoopRunSelections,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  blockTotal,
  collectSteps,
  stepDamageAt,
  stepHasRun,
} from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'
import { isNodeEffectivelyDisabled } from '@/modules/simulation/features/rotation/program-editor/model/treeEdit.ts'
import { selectedRunForNode } from '@/modules/simulation/features/rotation/program-editor/model/executionScope.ts'

export function isDisabledInTree(
  sections: EditorSection[],
  node: EditorStep | EditorCondition | EditorHandoff | EditorBlock,
): boolean {
  return isNodeEffectivelyDisabled(sections, node.id)
}

export function collectSectionSteps(sections: EditorSection[]): EditorStep[] {
  return collectSteps(sections.flatMap((section) => section.children))
}

export function peakDamageForRun(
  steps: EditorStep[],
  sections: EditorSection[],
  selections: LoopRunSelections,
): number {
  return steps.reduce((peak, step) => {
    const run = selectedRunForNode(sections, step.id, selections)
    return Math.max(
      peak,
      isDisabledInTree(sections, step) || !stepHasRun(step, run)
        ? 0
        : stepDamageAt(step, run),
    )
  }, 1)
}

export function blockRunTotals(block: EditorBlock | null): number[] {
  if (!block || block.type !== 'loop') return []

  if (block.damageByRun) {
    return Array.from({ length: Math.max(1, block.runs) }, (_, index) =>
      block.damageByRun?.[index + 1] ?? 0,
    )
  }
  if (block.totals) return [block.totals.avg]

  return Array.from({ length: Math.max(1, block.runs) }, (_, index) =>
    blockTotal(block, index + 1),
  )
}

export function blockAverageDamage(
  block: EditorBlock | null,
  run: number,
  totals: number[],
): number {
  if (!block) return 0
  if (totals.length === 0) return blockTotal(block, run)

  return totals.reduce((total, amount) => total + amount, 0) / Math.max(1, block.runs)
}
