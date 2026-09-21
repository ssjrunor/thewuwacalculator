/*
  Author: Runor Ewhro
  Description: Derives selectable node order, visibility, and aggregate fold
               identities from projected editor sections.
*/

import type {
  EditorNode,
  EditorSection,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { isEditorBlock } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { computeRowFoldParents } from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows.ts'

interface EditorSelectionModel {
  items: Array<{ id: string; val: EditorNode }>
  availableIds: string[]
  visibleIds: string[]
  selectAllIds: string[]
}

function isSelectable(node: EditorNode): boolean {
  return !(
    isEditorBlock(node)
    && (
      node.type === 'setup'
      || node.wrap === 'head'
      || node.wrap === 'middle'
      || node.loopSegment === 'end'
      || node.loopSegment === 'middle'
    )
  )
}

/*
  A tenure group and its first step share a node id. Attached children use a
  suffixed identity so the two independent fold states cannot collide.
*/
export function carryFoldId(nodeId: string): string {
  return `${nodeId}:carried`
}

/** whether a step has anything drawn inside its own row to fold away */
export function stepCarries(node: EditorNode): boolean {
  return node.type === 'step' && (node.attached?.length ?? 0) > 0
}

function blockFoldId(node: EditorNode): string {
  return isEditorBlock(node) ? node.wrapOf ?? node.id : node.id
}

/**
 * Every fold control the tree currently draws. Sections, authored containers,
 * and compact same-owner/source row runs all share `shutIds`, so the toolbar
 * can close the complete visual tree with one state replacement.
 */
export function collectEditorVisualFoldIds(
  sections: readonly EditorSection[],
): ReadonlySet<string> {
  const ids = new Set<string>()

  const visit = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      if (stepCarries(node)) ids.add(carryFoldId(node.id))
      if (!isEditorBlock(node)) continue
      ids.add(blockFoldId(node))
      visit(node.children)
    }
  }

  for (const section of sections) {
    ids.add(section.id)
    visit(section.children)
  }

  for (const headId of computeRowFoldParents([...sections]).values()) {
    ids.add(headId)
  }

  return ids
}

/**
 * Select All uses owning blocks as representatives. Repeat and uptime blocks
 * carry their descendants, but loops are flow markers: their body entries are
 * peers in the pane's authored list and must remain selected in the page too.
 */
function collectRootIds(nodes: readonly EditorNode[], out: string[]): void {
  for (const node of nodes) {
    if (isEditorBlock(node) && node.type === 'loop') {
      // A wrapped head is only a visual continuation; its selectable tail
      // represents the loop marker. Both segments still contribute body rows.
      if (
        node.wrap !== 'head'
        && node.wrap !== 'middle'
        && node.loopSegment !== 'end'
        && node.loopSegment !== 'middle'
      ) {
        out.push(node.id)
      }
      collectRootIds(node.children, out)
      continue
    }

    if (isSelectable(node)) {
      out.push(node.id)
      continue
    }

    // A setup branch has no selectable header of its own. This fallback only
    // matters for a standalone setup; inside an uptime, the uptime represented
    // the whole branch before traversal reached here.
    if (isEditorBlock(node) && node.type === 'setup') {
      collectRootIds(node.children, out)
    }

  }
}

export function buildEditorSelectionModel(
  sections: readonly EditorSection[],
  shutIds: ReadonlySet<string>,
): EditorSelectionModel {
  const items: Array<{ id: string; val: EditorNode }> = []
  const availableIds: string[] = []
  const visibleIds: string[] = []
  const selectAllIds: string[] = []
  const rowFoldParents = computeRowFoldParents([...sections])

  const collectAll = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      if (isSelectable(node)) {
        items.push({ id: node.id, val: node })
        availableIds.push(node.id)
      }
      if (isEditorBlock(node)) {
        collectAll(node.children)
      }
    }
  }

  const collectVisible = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      const rowFoldParent = rowFoldParents.get(node.id)
      if (rowFoldParent && shutIds.has(rowFoldParent)) {
        continue
      }

      if (isSelectable(node)) {
        visibleIds.push(node.id)
      }
      if (isEditorBlock(node) && !shutIds.has(blockFoldId(node))) {
        collectVisible(node.children)
      }
    }
  }

  for (const section of sections) {
    collectAll(section.children)
    collectRootIds(section.children, selectAllIds)
    if (!shutIds.has(section.id)) {
      collectVisible(section.children)
    }
  }

  return {
    items,
    availableIds,
    visibleIds,
    selectAllIds,
  }
}

/**
 * Flat execution has no selectable container rows. Its selectable universe is
 * therefore every authored leaf that appears in the trace, including leaves
 * stored in a loop pass template or a non-checked-out pass fork. Select All is
 * deliberately the same list: the tree-only owning-block collapse has no
 * representative to apply to on this surface.
 */
export function buildFlatEditorSelectionModel(
  sections: readonly EditorSection[],
  orderedTraceIds: readonly string[],
): EditorSelectionModel {
  const nodesById = new Map<string, EditorNode>()

  const visit = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      if (isSelectable(node) && !nodesById.has(node.id)) {
        nodesById.set(node.id, node)
      }
      if (!isEditorBlock(node)) continue
      visit(node.children)
      if (node.passTemplate && node.passTemplate !== node.children) {
        visit(node.passTemplate)
      }
      for (const body of Object.values(node.passForks ?? {})) visit(body)
    }
  }

  for (const section of sections) visit(section.children)

  const ids: string[] = []
  const seen = new Set<string>()
  for (const id of orderedTraceIds) {
    if (seen.has(id) || !nodesById.has(id)) continue
    seen.add(id)
    ids.push(id)
  }

  return {
    items: ids.map((id) => ({ id, val: nodesById.get(id)! })),
    availableIds: ids,
    visibleIds: ids,
    selectAllIds: ids,
  }
}
