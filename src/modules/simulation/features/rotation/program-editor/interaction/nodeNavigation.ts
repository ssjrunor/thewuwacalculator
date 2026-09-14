/*
  Author: Runor Ewhro
  Description: Owns node navigation behavior and state transitions for the interaction module.
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
import {
  clampLoopRunSelections,
  collectEditorLoopScopeByNode,
  editorLoopId,
} from '@/modules/simulation/features/rotation/program-editor/model/executionScope.ts'
import { computeRowFoldParents } from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'
import {
  normLoopRuns,
} from '@/domain/gameData/rotationLoops.ts'
import {
  checkoutAllLoopPasses,
  isCheckoutableLoop,
  resolveEditorPassBody,
} from '@/modules/simulation/features/rotation/program-editor/model/passCheckout.ts'

export interface RotationNodeTarget {
  nodeId: string
  /** exact enclosing loop passes when a particular execution is requested */
  loopRuns?: LoopRunSelections
}

export interface RotationNodeRevealRequest {
  nodeId: string
  token: number
}

export interface FeatureOccurrence {
  nodeId: string
  label: string
  loopRuns: LoopRunSelections
  scope: EditorExecutionScope
  scopeLabel: string
}

interface RotationNodeLocation {
  node: EditorNode
  sectionId: string
  /** structural ancestors, outside to inside */
  blockIds: readonly string[]
  /** enclosing authored loops, outside to inside */
  loopIds: readonly string[]
  /** keys that must be removed from the editor's shut set */
  revealIds: readonly string[]
}

interface RotationNodeFindResult {
  node: EditorNode

  target: RotationNodeTarget
  label: string
  kind: EditorNode['type']
  sectionId: string
  sectionLabel: string
  scopeLabel: string
  /** Lower scores are stronger matches; document order breaks ties. */
  score: number
}

interface RotationNodeNavigation {
  sections: EditorSection[]
  runsByLoopId: Record<string, number>
  shutIds: ReadonlySet<string>
  selectedId: string
  revealRequest: RotationNodeRevealRequest
}

interface FinderCandidate {
  node: EditorNode
  selectionNodeId: string
  section: EditorSection
  loops: readonly EditorBlock[]
  loopRuns: LoopRunSelections
  order: number
}

function occurrenceScope(
  section: EditorSection,
  loops: readonly EditorBlock[],
  loopRuns: LoopRunSelections,
): EditorExecutionScope {
  const loop = loops[loops.length - 1]
  if (!loop) {
    return {
      kind: 'section',
      sectionId: section.id,
      sectionLabel: section.title,
    }
  }

  const loopId = editorLoopId(loop)
  return {
    kind: 'loop',
    sectionId: section.id,
    sectionLabel: section.title,
    loopId,
    loopLabel: loop.label,
    run: loopRuns[loopId] ?? 1,
    runs: normLoopRuns(loop.runs),
  }
}

function occurrenceLoopRuns(loops: readonly EditorBlock[]): Record<string, number>[] {
  let tuples: Record<string, number>[] = [{}]
  for (const loop of loops) {
    const loopId = editorLoopId(loop)
    const runs = normLoopRuns(loop.runs)
    const next: Record<string, number>[] = []
    for (const tuple of tuples) {
      for (let run = 1; run <= runs; run += 1) {
        next.push({ ...tuple, [loopId]: run })
      }
    }
    tuples = next
  }
  return tuples
}

function occurrenceScopeLabel(
  section: EditorSection,
  loops: readonly EditorBlock[],
  loopRuns: LoopRunSelections,
): string {
  if (loops.length === 0) {
    return section.title
  }
  return loops.map((loop) => {
    const loopId = editorLoopId(loop)
    return `${loop.label} . run ${loopRuns[loopId] ?? 1} of ${normLoopRuns(loop.runs)}`
  }).join(' / ')
}

/**
 * Every viewable occurrence of an authored feature in the current editor
 * document. This is deliberately tree-derived rather than simulation history,
 * so local edits and disabled passes remain represented.
 */
export function findFeatureOccurrences(
  sections: EditorSection[],
  featureId: string | null | undefined,
): FeatureOccurrence[] {
  if (!featureId) {
    return []
  }

  const occurrences: FeatureOccurrence[] = []
  const loopScope = collectEditorLoopScopeByNode(sections)
  const visit = (
    section: EditorSection,
    nodes: EditorNode[],
  ) => {
    for (const node of nodes) {
      if (node.type === 'step' && node.featureId === featureId) {
        const loops = (loopScope.byNodeId.get(node.id) ?? [])
          .map((loopId) => loopScope.loopsById.get(loopId))
          .filter((loop): loop is EditorBlock => Boolean(loop))
        for (const loopRuns of occurrenceLoopRuns(loops)) {
          occurrences.push({
            nodeId: node.id,
            label: node.label,
            loopRuns,
            scope: occurrenceScope(section, loops, loopRuns),
            scopeLabel: occurrenceScopeLabel(section, loops, loopRuns),
          })
        }
      }
      if (!isEditorBlock(node)) {
        continue
      }
      visit(section, node.children)
    }
  }

  for (const section of sections) {
    visit(section, section.children)
  }
  return occurrences
}

export function findRotationNodeLocation(
  sections: EditorSection[],
  nodeId: string,
): RotationNodeLocation | null {
  const loopScopeByNodeId = collectEditorLoopScopeByNode(sections).byNodeId
  interface LocatedNode {
    node: EditorNode
    sectionId: string
    blocks: readonly EditorBlock[]
    loopIds: readonly string[]
  }

  const visit = (
    section: EditorSection,
    nodes: EditorNode[],
    blocks: readonly EditorBlock[],
  ): LocatedNode | null => {
    for (const node of nodes) {
      if (node.id === nodeId) {
        return {
          node,
          sectionId: section.id,
          blocks,
          loopIds: loopScopeByNodeId.get(node.id)
            ?? blocks.filter((block) => block.type === 'loop').map(editorLoopId),
        }
      }
      if (isEditorNoteHost(node) && node.attachedNote?.id === nodeId) {
        return {
          node: node.attachedNote,
          sectionId: section.id,
          blocks,
          loopIds: loopScopeByNodeId.get(node.attachedNote.id)
            ?? blocks.filter((block) => block.type === 'loop').map(editorLoopId),
        }
      }
      if (!isEditorBlock(node)) {
        continue
      }

      const nestedBlocks = [...blocks, node]
      const found = visit(section, node.children, nestedBlocks)
      if (found) {
        return found
      }

      // Nodes that only exist on another pass live in the template/forks.
      if (node.type === 'loop') {
        if (node.passTemplate) {
          const inTemplate = visit(section, node.passTemplate, nestedBlocks)
          if (inTemplate) {
            return inTemplate
          }
        }
        if (node.passForks) {
          for (const body of Object.values(node.passForks)) {
            const inFork = visit(section, body, nestedBlocks)
            if (inFork) {
              return inFork
            }
          }
        }
      }
    }
    return null
  }

  let found: LocatedNode | null = null
  for (const section of sections) {
    found = visit(section, section.children, [])
    if (found) {
      break
    }
  }

  if (!found) {
    return null
  }

  const revealIds = new Set<string>([
    found.sectionId,
    ...found.blocks.map((block) => block.wrapOf ?? block.id),
  ])
  const foldParents = computeRowFoldParents(sections)
  const seen = new Set<string>()
  let foldParent = foldParents.get(nodeId)
  while (foldParent && !seen.has(foldParent)) {
    seen.add(foldParent)
    revealIds.add(foldParent)
    foldParent = foldParents.get(foldParent)
  }

  return {
    node: found.node,
    sectionId: found.sectionId,
    blockIds: found.blocks.map((block) => block.id),
    loopIds: found.loopIds,
    revealIds: [...revealIds],
  }
}

function nodeFinderLabel(node: EditorNode): string {
  if (node.type === 'swap') {
    return 'Handoff'
  }
  return node.label ?? 'Note'
}

function nodeFinderText(node: EditorNode): string {
  const fields = [node.id, node.type, nodeFinderLabel(node)]
  if (node.type === 'step') {
    fields.push(node.featureId ?? '', node.skillTypeLabel ?? '', node.talentNodeLabel ?? '')
  } else if (node.type === 'condition') {
    fields.push(node.path ?? '', node.effectName ?? '', node.sourceName ?? '', node.to)
  } else if (node.type === 'swap') {
    fields.push(node.from, node.to, 'swap')
  } else if (node.type === 'note') {
    fields.push(node.text)
  }
  return fields.join(' ').toLocaleLowerCase()
}

function finderScore(node: EditorNode, query: string): number | null {
  const label = nodeFinderLabel(node).toLocaleLowerCase()
  const id = node.id.toLocaleLowerCase()
  const text = nodeFinderText(node)
  if (label === query || id === query) return 0
  if (label.startsWith(query)) return 1
  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 2
  if (label.includes(query)) return 3
  if (text.includes(query)) return 4
  const tokens = query.split(/\s+/).filter(Boolean)
  return tokens.length > 1 && tokens.every((token) => text.includes(token)) ? 5 : null
}

/**
 * Every searchable row occurrence in the authored document. Loop bodies are
 * resolved per pass, so nodes that only exist in one fork carry that exact
 * tuple and shared nodes remain reachable on each view where they occur.
 */
function rotationNodeFinderCandidates(sections: EditorSection[]): FinderCandidate[] {
  const candidates: FinderCandidate[] = []
  let order = 0

  const visit = (
    section: EditorSection,
    nodes: readonly EditorNode[],
    loops: readonly EditorBlock[],
    loopRuns: LoopRunSelections,
  ) => {
    for (const node of nodes) {
      candidates.push({ node, selectionNodeId: node.id, section, loops, loopRuns, order: order++ })
      if (isEditorNoteHost(node) && node.attachedNote) {
        candidates.push({
          node: node.attachedNote,
          selectionNodeId: node.id,
          section,
          loops,
          loopRuns,
          order: order++,
        })
      }
      if (!isEditorBlock(node)) {
        continue
      }

      if (node.type === 'loop') {
        const loopId = editorLoopId(node)
        const scopedLoops = [...loops, node]
        const template = node.passTemplate ?? node.children
        for (let run = 1; run <= normLoopRuns(node.runs); run += 1) {
          const body = isCheckoutableLoop(node)
            ? resolveEditorPassBody(template, node.passForks, run)
            : node.children
          visit(section, body, scopedLoops, { ...loopRuns, [loopId]: run })
        }
      } else {
        visit(section, node.children, loops, loopRuns)
      }
    }
  }

  for (const section of sections) {
    visit(section, section.children, [], {})
  }
  return candidates
}

/**
 * Find rows by label, id, node kind, and useful node metadata. Results are
 * ranked but otherwise stay in authored execution order. No UI state is
 * changed; each result is a target for `prepareRotationNodeNavigation`.
 */
export function findRotationNodes(
  sections: EditorSection[],
  rawQuery: string,
): RotationNodeFindResult[] {
  const query = rawQuery.trim().toLocaleLowerCase()
  if (!query) {
    return []
  }

  return rotationNodeFinderCandidates(sections)
    .flatMap((candidate) => {
      const score = finderScore(candidate.node, query)
      if (score == null) {
        return []
      }
      return [{ candidate, score }]
    })
    .sort((left, right) => left.score - right.score || left.candidate.order - right.candidate.order)
    .map(({ candidate, score }) => ({
      node: candidate.node,
      target: {
        nodeId: candidate.selectionNodeId,
        ...(candidate.loops.length > 0 ? { loopRuns: candidate.loopRuns } : {}),
      },
      label: nodeFinderLabel(candidate.node),
      kind: candidate.node.type,
      sectionId: candidate.section.id,
      sectionLabel: candidate.section.title,
      scopeLabel: occurrenceScopeLabel(candidate.section, candidate.loops, candidate.loopRuns),
      score,
    }))
}

/** The strongest finder match, preferring the loop views already selected. */
export function findRotationNode(
  sections: EditorSection[],
  query: string,
  currentRuns: LoopRunSelections = {},
): RotationNodeFindResult | null {
  const results = findRotationNodes(sections, query)
  if (results.length < 2 || results[0].score !== results[1].score) {
    return results[0] ?? null
  }
  const bestScore = results[0].score
  return results
    .filter((result) => result.score === bestScore)
    .sort((left, right) => {
      const distance = (result: RotationNodeFindResult) => Object.entries(result.target.loopRuns ?? {})
        .reduce((sum, [loopId, run]) => sum + (currentRuns[loopId] === run ? 0 : 1), 0)
      return distance(left) - distance(right)
    })[0] ?? null
}

/**
 * Apply only the execution tuple relevant to the target. Selections for
 * unrelated sibling loops remain where the user left them.
 */
export function loopRunsForRotationNodeTarget(
  sections: EditorSection[],
  current: LoopRunSelections,
  target: RotationNodeTarget,
  location = findRotationNodeLocation(sections, target.nodeId),
): Record<string, number> {
  const next = { ...current }
  if (location && target.loopRuns) {
    const targetLoopId = isEditorBlock(location.node) && location.node.type === 'loop'
      ? editorLoopId(location.node)
      : null
    const relevantLoopIds = targetLoopId
      ? [...location.loopIds, targetLoopId]
      : location.loopIds
    for (const loopId of relevantLoopIds) {
      const run = target.loopRuns[loopId]
      if (run != null) {
        next[loopId] = run
      }
    }
  }
  return clampLoopRunSelections(sections, next)
}

export function openRotationNodeLocation(
  shutIds: ReadonlySet<string>,
  location: RotationNodeLocation,
): ReadonlySet<string> {
  let next: Set<string> | null = null
  for (const id of location.revealIds) {
    if (!shutIds.has(id)) {
      continue
    }
    next ??= new Set(shutIds)
    next.delete(id)
  }
  return next ?? shutIds
}

/**
 * Resolve the same state transition used by Current/history navigation. The
 * returned state checks out nested passes before locating folds, then selects
 * and requests reveal of the row. Callers decide how to commit that state.
 */
export function prepareRotationNodeNavigation({
  sections,
  runsByLoopId,
  shutIds,
  target,
  revealToken = 0,
}: {
  sections: EditorSection[]
  runsByLoopId: LoopRunSelections
  shutIds: ReadonlySet<string>
  target: RotationNodeTarget
  revealToken?: number
}): RotationNodeNavigation | null {
  const initialLocation = findRotationNodeLocation(sections, target.nodeId)
  if (!initialLocation) {
    return null
  }
  const nextRuns = loopRunsForRotationNodeTarget(
    sections,
    runsByLoopId,
    target,
    initialLocation,
  )
  const nextSections = checkoutAllLoopPasses(sections, nextRuns)
  const location = findRotationNodeLocation(nextSections, target.nodeId) ?? initialLocation
  return {
    sections: nextSections,
    runsByLoopId: nextRuns,
    shutIds: openRotationNodeLocation(shutIds, location),
    selectedId: target.nodeId,
    revealRequest: { nodeId: target.nodeId, token: revealToken + 1 },
  }
}
