/*
  Author: Runor Ewhro
  Description: Finds a node by what it is called, so a long rotation can be
               reached by name rather than by scrolling it.
*/

import type {
  EditorNode,
  EditorSection,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import { isEditorBlock } from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import { editorLoopId } from '@/modules/simulation/features/rotation/program-editor/model/executionScope.ts'
import { normLoopRuns } from '@/domain/gameData/rotationLoops.ts'
import type { RotationNodeTarget } from '@/modules/simulation/features/rotation/program-editor/interaction/nodeNavigation.ts'

type SearchKind = 'step' | 'state' | 'swap' | 'block' | 'note'

interface IndexEntry {
  id: string
  kind: SearchKind
  /** what the hit prints, and the first thing a query is tried against */
  title: string

  aside: string
  /** where it sits, so two steps of the same name can be told apart */
  crumb: string
  order: number
  loop?: {
    id: string
    runs: number
  }
}

export interface SearchHit {
  id: string
  target: RotationNodeTarget
  kind: SearchKind
  title: string
  /** the span of the title the query matched, for the mark */
  from: number
  to: number
  crumb: string
  /** shown when the query was found in the aside rather than the title */
  via: string | null
  /** variant navigation shown when the result itself is a loop */
  loop?: {
    id: string
    runs: number
    /** direct `loop_label N` query; absent means the current/general view */
    requestedRun?: number
  }
}

/*
  what a kind is worth before position is taken into account. a step is what a
  rotation is made of and what a reader is nearly always looking for; a note is
  an aside about one.
*/
const KIND_SCORE: Record<SearchKind, number> = {
  step: 40,
  block: 34,
  swap: 30,
  state: 26,
  note: 22,
}

export const SEARCH_KIND_NAMES: Record<SearchKind, string> = {
  step: 'step',
  state: 'state',
  swap: 'swap',
  block: 'block',
  note: 'note',
}

export interface SearchNames {
  owner: (node: EditorNode) => string
  member: (id: string) => string
}

/**
 * Every node in the rotation, in the order it runs.
 *
 * The crumb is built on the way down rather than looked up after, because the
 * same feature appears at several depths and where it sits is most of what
 * tells two of them apart.
 */
export function buildNodeIndex(
  sections: readonly EditorSection[],
  names: SearchNames,
): IndexEntry[] {
  const out: IndexEntry[] = []
  let order = 0

  const visit = (nodes: readonly EditorNode[], crumb: readonly string[]) => {
    for (const node of nodes) {
      order += 1
      const where = crumb.join(' / ')

      if (isEditorBlock(node)) {
        out.push({
          id: node.id,
          kind: 'block',
          title: node.label || 'Block',
          aside: node.type,
          crumb: where,
          order,
          ...(node.type === 'loop' ? {
            loop: {
              id: editorLoopId(node),
              runs: normLoopRuns(node.runs),
            },
          } : {}),
        })
        visit(node.children, [...crumb, node.label])
        continue
      }

      if (node.type === 'note') {
        out.push({
          id: node.id,
          kind: 'note',
          title: node.text || node.label || 'Note',
          aside: node.label ?? '',
          crumb: where,
          order,
        })
        continue
      }

      if (node.type === 'swap') {
        // a handoff has no name of its own: it is who it hands to
        const to = names.member(node.to)
        out.push({
          id: node.id,
          kind: 'swap',
          title: to || 'Handoff',
          aside: names.member(node.from),
          crumb: where,
          order,
        })
        continue
      }

      const owner = names.owner(node)

      if (node.type === 'condition') {
        out.push({
          id: node.id,
          kind: 'state',
          title: node.label || 'State',
          aside: [owner, node.effectName ?? '', node.sourceName ?? ''].filter(Boolean).join(' '),
          crumb: where,
          order,
        })
        continue
      }

      out.push({
        id: node.id,
        kind: 'step',
        title: node.label || 'Step',
        aside: [owner, node.skillTypeLabel, node.talentNodeLabel]
          .filter(Boolean)
          .join(' '),
        crumb: where,
        order,
      })

      // a note lives on its host rather than beside it, so it is reached here
      if (node.attachedNote) {
        order += 1
        out.push({
          id: node.attachedNote.id,
          kind: 'note',
          title: node.attachedNote.text || node.attachedNote.label || 'Note',
          aside: node.label,
          crumb: [...crumb, node.label].join(' / '),
          order,
        })
      }
    }
  }

  for (const section of sections) {
    visit(section.children, [section.title])
  }
  return out
}

/**
 * The best few matches for a query.
 *
 * A match in the title outranks one in the aside, and an earlier match outranks
 * a later one: someone typing `heavy` means a step that starts with it before
 * one that mentions it halfway through.
 */
export function searchNodes(
  index: readonly IndexEntry[],
  query: string,
  limit = 8,
): SearchHit[] {
  const rawNeedle = query.trim().toLowerCase()
  const runQuery = /\s+(\d+)$/.exec(rawNeedle)
  const requestedRun = runQuery ? Number(runQuery[1]) : undefined
  const loopNeedle = runQuery
    ? rawNeedle.slice(0, runQuery.index).replaceAll('_', ' ').replace(/\s+/g, ' ').trim()
    : ''
  const needle = rawNeedle.replaceAll('_', ' ').replace(/\s+/g, ' ')
  if (needle.length === 0) {
    return []
  }

  const scored: Array<{
    entry: IndexEntry
    score: number
    at: number
    via: string | null
    requestedRun?: number
  }> = []

  for (const entry of index) {
    const title = entry.title.toLowerCase()
    const asideText = entry.aside.toLowerCase()
    const fullTitleAt = title.indexOf(needle)
    const fullAsideAt = asideText.indexOf(needle)
    const exactLoopRun = entry.loop
      && requestedRun !== undefined
      && requestedRun >= 1
      && requestedRun <= entry.loop.runs
      && loopNeedle.length > 0
      // Preserve ordinary searches such as a loop literally named "Loop 1".
      // The run grammar is only needed when the complete query is not a name.
      && fullTitleAt < 0
      && fullAsideAt < 0
      ? requestedRun
      : undefined
    const entryNeedle = exactLoopRun === undefined ? needle : loopNeedle
    const at = exactLoopRun === undefined ? fullTitleAt : title.indexOf(entryNeedle)
    // an entry with nothing to match on is nothing to offer
    if (at >= 0) {
      scored.push({
        entry,
        score: KIND_SCORE[entry.kind] + (at === 0 ? 20 : 0) - Math.min(at, 100) * 0.1,
        at,
        via: null,
        ...(exactLoopRun !== undefined ? { requestedRun: exactLoopRun } : {}),
      })
      continue
    }
    // found by what it is rather than by what it is called
    const aside = exactLoopRun === undefined ? fullAsideAt : asideText.indexOf(entryNeedle)
    if (aside >= 0) {
      scored.push({
        entry,
        score: KIND_SCORE[entry.kind] * 0.5 - Math.min(aside, 100) * 0.1,
        at: -1,
        via: entry.aside,
        ...(exactLoopRun !== undefined ? { requestedRun: exactLoopRun } : {}),
      })
    }
  }

  scored.sort((left, right) => right.score - left.score || left.entry.order - right.entry.order)

  return scored.slice(0, limit).map(({ entry, at, via, requestedRun: run }) => ({
    id: entry.id,
    target: {
      nodeId: entry.id,
      ...(entry.loop && run !== undefined ? { loopRuns: { [entry.loop.id]: run } } : {}),
    },
    kind: entry.kind,
    title: entry.title,
    from: at < 0 ? 0 : at,
    to: at < 0 ? 0 : at + (run === undefined ? needle.length : loopNeedle.length),
    crumb: entry.crumb,
    via,
    ...(entry.loop ? {
      loop: {
        ...entry.loop,
        ...(run !== undefined ? { requestedRun: run } : {}),
      },
    } : {}),
  }))
}
