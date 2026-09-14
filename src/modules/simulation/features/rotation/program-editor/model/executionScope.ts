/*
  Author: Runor Ewhro
  Description: Owns execution scope behavior and state transitions for the model module.
*/

import type {
  EditorBlock,
  EditorExecutionScope,
  EditorNode,
  EditorSection,
  LoopRunSelections,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  isEditorBlock,
  isEditorNoteHost,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'

export function editorLoopId(loop: EditorBlock): string {
  return loop.loopId ?? loop.id
}

function isLoopStartSegment(loop: EditorBlock): boolean {
  return loop.type === 'loop'
    && loop.loopSegment !== 'end'
    && loop.loopSegment !== 'middle'
    && loop.wrap !== 'head'
    && loop.wrap !== 'middle'
}

interface EditorLoopScopeIndex {
  byNodeId: ReadonlyMap<string, readonly string[]>
  loopsById: ReadonlyMap<string, EditorBlock>
}

/**
 * Resolve authored loop scope in document order. Most loops are ordinary
 * nested blocks. A freely positioned marker pair can cross a container edge,
 * so its start/end segments update one shared flow stack while recursion walks
 * through that container.
 */
export function collectEditorLoopScopeByNode(
  sections: readonly EditorSection[],
): EditorLoopScopeIndex {
  const loopsById = new Map<string, EditorBlock>()
  const firstFreeBoundary = new Map<string, 'start' | 'end'>()

  const indexLoops = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      if (!isEditorBlock(node)) {
        continue
      }
      if (node.type === 'loop') {
        const loopId = editorLoopId(node)
        if (isLoopStartSegment(node)) {
          loopsById.set(loopId, node)
        }
        if (node.loopSegment === 'start' || node.loopSegment === 'both') {
          firstFreeBoundary.set(loopId, firstFreeBoundary.get(loopId) ?? 'start')
        } else if (node.loopSegment === 'end') {
          firstFreeBoundary.set(loopId, firstFreeBoundary.get(loopId) ?? 'end')
        }
      }
      indexLoops(node.children)
    }
  }

  sections.forEach((section) => indexLoops(section.children))

  const active: EditorBlock[] = []
  for (const [loopId, boundary] of firstFreeBoundary) {
    const loop = loopsById.get(loopId)
    if (boundary === 'end' && loop) {
      active.push(loop)
    }
  }

  const byNodeId = new Map<string, readonly string[]>()
  const removeActive = (loopId: string) => {
    const index = active.map(editorLoopId).lastIndexOf(loopId)
    if (index >= 0) {
      active.splice(index, 1)
    }
  }
  const pushActive = (loop: EditorBlock) => {
    const loopId = editorLoopId(loop)
    removeActive(loopId)
    active.push(loopsById.get(loopId) ?? loop)
  }

  const visit = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      const loopIds = active.map(editorLoopId)
      byNodeId.set(node.id, loopIds)
      if (isEditorNoteHost(node) && node.attachedNote) {
        byNodeId.set(node.attachedNote.id, loopIds)
      }

      if (!isEditorBlock(node)) {
        continue
      }

      if (node.type !== 'loop') {
        visit(node.children)
        continue
      }

      const loopId = editorLoopId(node)
      if (node.loopSegment) {
        if (node.loopSegment === 'start' || node.loopSegment === 'both') {
          pushActive(node)
        }
        visit(node.children)
        if (node.loopSegment === 'end' || node.loopSegment === 'both') {
          removeActive(loopId)
        }
        continue
      }

      // Legacy same-list wrap segments are locally scoped display fragments.
      // They do not carry their active state through the surrounding parent.
      active.push(loopsById.get(loopId) ?? node)
      visit(node.children)
      active.pop()
    }
  }

  sections.forEach((section) => visit(section.children))
  return { byNodeId, loopsById }
}

export function selectedLoopRun(
  loop: Pick<EditorBlock, 'id' | 'loopId' | 'runs'>,
  selections: LoopRunSelections,
): number {
  const selected = selections[loop.loopId ?? loop.id] ?? 1
  return Math.min(Math.max(1, Math.floor(selected)), Math.max(1, loop.runs))
}

export function selectedRunForLoopIds(
  loopIds: readonly string[],
  selections: LoopRunSelections,
): number {
  const loopId = loopIds[loopIds.length - 1]
  return loopId ? Math.max(1, Math.floor(selections[loopId] ?? 1)) : 1
}

function sectionScope(section: EditorSection): EditorExecutionScope {
  return {
    kind: 'section',
    sectionId: section.id,
    sectionLabel: section.title,
  }
}

function loopScope(
  section: EditorSection,
  loop: EditorBlock,
  selections: LoopRunSelections,
): EditorExecutionScope {
  return {
    kind: 'loop',
    sectionId: section.id,
    sectionLabel: section.title,
    loopId: editorLoopId(loop),
    loopLabel: loop.label,
    run: selectedLoopRun(loop, selections),
    runs: Math.max(1, loop.runs),
  }
}

/**
 * Display scope includes a loop block's own pass. Edit scope deliberately does
 * not: loop values are authored for the loop as a whole, while supported
 * children bind edits to their nearest enclosing loop.
 */
export function findNodeExecutionScope(
  sections: EditorSection[],
  id: string | null,
  selections: LoopRunSelections,
  mode: 'display' | 'edit' = 'display',
): EditorExecutionScope | null {
  if (!id) {
    return null
  }

  const scopeIndex = collectEditorLoopScopeByNode(sections)
  const visit = (section: EditorSection, nodes: EditorNode[]): EditorExecutionScope | null => {
    for (const node of nodes) {
      const isAttachedNote = isEditorNoteHost(node) && node.attachedNote?.id === id
      if (node.id === id || isAttachedNote) {
        if (node.type === 'loop' && isLoopStartSegment(node)) {
          return mode === 'display'
            ? loopScope(section, node, selections)
            : sectionScope(section)
        }
        const loopIds = scopeIndex.byNodeId.get(node.id) ?? []
        const loop = scopeIndex.loopsById.get(loopIds[loopIds.length - 1] ?? '')
        return loop ? loopScope(section, loop, selections) : sectionScope(section)
      }

      if (isEditorBlock(node)) {
        const found = visit(section, node.children)
        if (found) {
          return found
        }
      }
    }
    return null
  }

  for (const section of sections) {
    const found = visit(section, section.children)
    if (found) {
      return found
    }
  }
  return null
}

export function selectedRunForNode(
  sections: EditorSection[],
  id: string | null,
  selections: LoopRunSelections,
): number {
  const scope = findNodeExecutionScope(sections, id, selections)
  return scope?.kind === 'loop' ? scope.run : 1
}

export function clampLoopRunSelections(
  sections: EditorSection[],
  selections: LoopRunSelections,
): Record<string, number> {
  const next: Record<string, number> = {}

  const visit = (nodes: EditorNode[]) => {
    for (const node of nodes) {
      if (!isEditorBlock(node)) {
        continue
      }
      if (node.type === 'loop') {
        next[editorLoopId(node)] = selectedLoopRun(node, selections)
      }
      visit(node.children)
    }
  }

  for (const section of sections) {
    visit(section.children)
  }
  return next
}

export function collectLoopColors(sections: EditorSection[]): ReadonlyMap<string, string> {
  const colors = new Map<string, string>()
  const visit = (nodes: EditorNode[]) => {
    for (const node of nodes) {
      if (!isEditorBlock(node)) {
        continue
      }
      if (node.type === 'loop' && node.color) {
        colors.set(editorLoopId(node), node.color)
      }
      visit(node.children)
    }
  }

  for (const section of sections) {
    visit(section.children)
  }
  return colors
}

export function formatExecutionScope(scope: EditorExecutionScope): string {
  return scope.kind === 'loop'
    ? `${scope.loopLabel} . run ${scope.run} of ${scope.runs}`
    : scope.sectionLabel
}

export function formatExecutionRun(scope: EditorExecutionScope): string {
  return scope.kind === 'loop'
    ? `run ${scope.run} of ${scope.runs}`
    : scope.sectionLabel
}
