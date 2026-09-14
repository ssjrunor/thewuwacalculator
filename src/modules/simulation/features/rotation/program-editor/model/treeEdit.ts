/*
  Author: Runor Ewhro
  Description: Owns tree edit behavior and state transitions for the model module.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type {
  ConditionWriteAction,
  EditorBlock,
  EditorCondition,
  MemberId,
  EditorNote,
  EditorNode,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  isEditorBlock,
  isEditorNoteHost,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  collectEditorLoopScopeByNode,
} from '@/modules/simulation/features/rotation/program-editor/model/executionScope.ts'
import {
  makeBlockColor,
  makeLoopColor,
} from '@/modules/simulation/features/rotation/shared/loopMeta.ts'
import {
  normLoopRuns,
} from '@/domain/gameData/rotationLoops.ts'
import { makeScopeLabel } from '@/modules/simulation/features/rotation/shared/containerMeta.ts'
import {
  makeNoteColor,
  makeNoteLabel,
} from '@/modules/simulation/features/rotation/shared/noteMeta.ts'
import { makeNodeId } from '@/domain/gameData/rotationNodeId.ts'
import { resizeLoopBlockRuns } from '@/modules/simulation/features/rotation/program-editor/model/passCheckout.ts'

const ROT_NODE_PREFIX: Record<string, string> = {
  step: 'rotation:feature',
  cond: 'rotation:condition',
  condition: 'rotation:condition',
  swap: 'rotation:condition',
  loop: 'rotation:loop-start',
  'loop-frame': 'rotation:loop',
  repeat: 'rotation:repeat',
  uptime: 'rotation:uptime',
  note: 'rotation:note',
}

export function nextNodeId(prefix = 'n'): string {
  return makeNodeId(ROT_NODE_PREFIX[prefix] ?? prefix)
}

const isBlock = isEditorBlock

function wrappableNodeIds(
  nodeIds: ReadonlySet<string>,
  isInSetup: (nodeId: string) => boolean,
): Set<string> {
  const result = new Set<string>()
  for (const nodeId of nodeIds) {
    if (!isInSetup(nodeId)) result.add(nodeId)
  }
  return result
}

type AuthoredBlockType = 'loop' | 'repeat' | 'uptime'

function authoredBlocks(sections: readonly EditorSection[]): EditorBlock[] {
  const blocks: EditorBlock[] = []
  const visit = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      if (!isBlock(node)) {
        continue
      }
      if (node.type !== 'setup') {
        blocks.push(node)
      }
      visit(node.children)
    }
  }
  sections.forEach((section) => visit(section.children))
  return blocks
}

function authoredNotes(sections: readonly EditorSection[]): EditorNote[] {
  const notes: EditorNote[] = []
  const visit = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      if (node.type === 'note') {
        notes.push(node)
      } else if (isEditorNoteHost(node) && node.attachedNote) {
        notes.push(node.attachedNote)
      }
      if (isBlock(node)) {
        visit(node.children)
      }
    }
  }
  sections.forEach((section) => visit(section.children))
  return notes
}

function blockDefaultGenerators(
  sections: readonly EditorSection[],
  type: AuthoredBlockType,
): { nextLabel: () => string; nextColor: () => string } {
  const blocks = authoredBlocks(sections)
  return {
    nextLabel: makeScopeLabel(
      type,
      blocks.filter((block) => block.type === type).map((block) => block.label),
    ),
    nextColor: type === 'loop'
      ? makeLoopColor(blocks.filter((block) => block.type === 'loop').map((block) => block.color))
      : makeBlockColor(
        blocks
          .filter((block) => block.type === 'repeat' || block.type === 'uptime')
          .map((block) => block.color),
      ),
  }
}

function makeSetupBranch(id: string, owner: EditorBlock['owner']): EditorBlock {
  return {
    type: 'setup',
    id: `${id}:setup`,
    owner,
    label: 'Setup',
    runs: 1,
    nodeCount: 0,
    children: [],
  }
}

function makeContainer(
  type: AuthoredBlockType,
  id: string,
  owner: EditorBlock['owner'],
  label: string,
  color: string,
  body: EditorNode[],
): EditorBlock {
  const children = type === 'uptime'
    ? [makeSetupBranch(id, owner), ...body]
    : body
  const block: EditorBlock = {
    type,
    id,
    ...(type === 'loop' ? { loopId: nextNodeId('loop-frame') } : {}),
    owner,
    label,
    color,
    runs: 1,
    ...(type === 'uptime' ? { ratio: 1 } : {}),
    nodeCount: children.length,
    children,
  }
  if (type === 'loop') {
    block.passTemplate = structuredClone(body) as EditorNode[]
    block.checkedOutRun = 1
  }
  return block
}

/** Build an empty authored container with the same defaults as wrapping rows. */
export function makeEmptyContainer(
  sections: EditorSection[],
  type: AuthoredBlockType,
  memberId: MemberId,
): EditorBlock {
  const { nextLabel, nextColor } = blockDefaultGenerators(sections, type)
  return makeContainer(
    type,
    nextNodeId(type),
    { kind: 'member', memberId },
    nextLabel(),
    nextColor(),
    [],
  )
}

/** Add the optional full-strength setup branch to a canonical block. */
export function addBlockSetup(sections: EditorSection[], id: string): EditorSection[] {
  return mapNode(sections, id, (node) => {
    if (!isBlock(node) || (node.type !== 'repeat' && node.type !== 'uptime')) return node
    if (node.children.some((child) => child.type === 'setup')) return node
    const setup = makeSetupBranch(node.id, node.owner)
    return { ...node, children: [setup, ...node.children], nodeCount: node.nodeCount + 1 }
  })
}

/**
 * Take the setup branch off a block again.
 *
 * Whatever was authored into the window is kept: those entries move to the top
 * of the body rather than leaving with the branch, so taking the window away is
 * never a way to lose work by accident.
 */
export function removeBlockSetup(sections: EditorSection[], id: string): EditorSection[] {
  return mapNode(sections, id, (node) => {
    if (!isBlock(node)) return node
    const setup = node.children.find((child): child is EditorBlock => child.type === 'setup')
    if (!setup) return node

    const children = [
      ...setup.children,
      ...node.children.filter((child) => child !== setup),
    ]
    return { ...node, children, nodeCount: children.length }
  })
}

/**
 * Rebuild every children list in the tree through `fn`. Lists that come back
 * unchanged keep their original array, so an edit deep in one loop does not
 * invalidate the sections around it.
 */
function mapLists(
  sections: EditorSection[],
  fn: (list: EditorNode[]) => EditorNode[],
): EditorSection[] {
  const visit = (list: EditorNode[]): EditorNode[] => {
    let touched = false
    const descended = list.map((node) => {
      if (!isBlock(node)) {
        return node
      }
      const children = visit(node.children)
      if (children === node.children) {
        return node
      }
      touched = true
      return { ...node, children, nodeCount: children.length }
    })

    const next = fn(touched ? descended : list)
    return next === list && !touched ? list : next
  }

  let changed = false
  const out = sections.map((section) => {
    const children = visit(section.children)
    if (children === section.children) {
      return section
    }
    changed = true
    return { ...section, children }
  })

  return changed ? out : sections
}

function markNoteFieldEdits(previous: EditorNote, next: EditorNote): EditorNote {
  const labelEdited = previous.label !== next.label
  const colorEdited = previous.color !== next.color
  const textEdited = previous.text !== next.text
  if (!labelEdited && !colorEdited && !textEdited) {
    return next
  }
  return {
    ...next,
    ...(labelEdited ? { labelEdited: true } : {}),
    ...(colorEdited ? { colorEdited: true } : {}),
    ...(textEdited ? { textEdited: true } : {}),
  }
}

/** rebuild a single node in place, wherever it sits */
export function mapNode(
  sections: EditorSection[],
  id: string,
  fn: (node: EditorNode) => EditorNode,
): EditorSection[] {
  return mapLists(sections, (list) => {
    const index = list.findIndex((node) => node.id === id)
    if (index >= 0) {
      const current = list[index]
      const result = fn(current)
      const updated = current.type === 'note' && result.type === 'note'
        ? markNoteFieldEdits(current, result)
        : result
      if (updated === list[index]) {
        return list
      }
      const next = [...list]
      next[index] = updated
      return next
    }

    const hostIndex = list.findIndex((node) =>
      isEditorNoteHost(node) && node.attachedNote?.id === id)
    if (hostIndex < 0) {
      return list
    }
    const host = list[hostIndex]
    if (!isEditorNoteHost(host) || !host.attachedNote) {
      return list
    }
    const result = fn(host.attachedNote)
    const updated = result.type === 'note'
      ? markNoteFieldEdits(host.attachedNote, result)
      : result
    if (updated.type !== 'note' || updated === host.attachedNote) {
      return list
    }
    const next = [...list]
    next[hostIndex] = { ...host, attachedNote: updated, noteEdited: true }
    return next
  })
}

/** update every visual segment that represents the same authored loop */
export function mapLoopBlocks(
  sections: EditorSection[],
  loopId: string,
  fn: (node: EditorBlock) => EditorBlock,
): EditorSection[] {
  return mapLists(sections, (list) => {
    let changed = false
    const next = list.map((node) => {
      if (!isBlock(node) || node.type !== 'loop' || (node.loopId ?? node.id) !== loopId) {
        return node
      }
      changed = true
      return fn(node)
    })
    return changed ? next : list
  })
}

/** Remove a loop's markers while leaving its checked-out body in document order. */
export function unwrapLoop(
  sections: EditorSection[],
  loopId: string,
): EditorSection[] {
  return mapLists(sections, (list) => {
    if (!list.some((node) =>
      isBlock(node) && node.type === 'loop' && (node.loopId ?? node.id) === loopId)) {
      return list
    }

    return list.flatMap((node) =>
      isBlock(node) && node.type === 'loop' && (node.loopId ?? node.id) === loopId
        ? node.children
        : [node],
    )
  })
}

export function findNode(sections: EditorSection[], id: string | null): EditorNode | null {
  if (!id) {
    return null
  }

  const visit = (list: EditorNode[]): EditorNode | null => {
    for (const node of list) {
      if (node.id === id) {
        return node
      }
      if (isEditorNoteHost(node) && node.attachedNote?.id === id) {
        return node.attachedNote
      }
      if (isBlock(node)) {
        const found = visit(node.children)
        if (found) {
          return found
        }
      }
    }
    return null
  }

  for (const section of sections) {
    const found = visit(section.children)
    if (found) {
      return found
    }
  }
  return null
}

export function findEnclosingLoop(sections: EditorSection[], id: string | null): EditorBlock | null {
  if (!id) {
    return null
  }

  const scope = collectEditorLoopScopeByNode(sections)
  const loopIds = scope.byNodeId.get(id)
  return loopIds?.length
    ? scope.loopsById.get(loopIds[loopIds.length - 1]) ?? null
    : null
}

/** True when the node sits in an uptime setup branch (not wrappable as a block). */
function isInsideSetup(sections: EditorSection[], id: string): boolean {
  const visit = (list: EditorNode[], inSetup: boolean): boolean | null => {
    for (const node of list) {
      if (node.id === id) {
        return inSetup
      }
      if (isBlock(node)) {
        const found = visit(node.children, inSetup || node.type === 'setup')
        if (found != null) {
          return found
        }
      }
    }
    return null
  }

  for (const section of sections) {
    const found = visit(section.children, false)
    if (found != null) {
      return found
    }
  }
  return false
}

function canSitBeside(sections: EditorSection[], node: EditorNode, targetId: string): boolean {
  return node.type === 'condition' || node.type === 'note' || !isInsideSetup(sections, targetId)
}

/** effective disabled state, with loop markers treated as flow controls */
export function isNodeEffectivelyDisabled(
  sections: EditorSection[],
  id: string,
): boolean {
  const visit = (
    nodes: EditorNode[],
    inheritedDisabled: boolean,
  ): boolean | null => {
    for (const node of nodes) {
      const ownDisabled = 'disabled' in node && Boolean(node.disabled)
      const disabled = inheritedDisabled
        || ownDisabled
      if (node.id === id) {
        return disabled
      }
      if (isBlock(node)) {
        const childInheritedDisabled = node.type === 'loop'
          ? inheritedDisabled
          : disabled
        const found = visit(node.children, childInheritedDisabled)
        if (found != null) {
          return found
        }
      }
    }
    return null
  }

  for (const section of sections) {
    const found = visit(section.children, false)
    if (found != null) {
      return found
    }
  }
  return false
}

/* Checked-out loop bodies are the authored pass, so edits always write the node. */
export function setStepMultiplier(
  sections: EditorSection[],
  id: string,
  value: number,
): EditorSection[] {
  const next = Math.max(1, Math.floor(value))
  return mapNode(sections, id, (node) => {
    if (node.type !== 'step') {
      return node
    }
    return {
      ...node,
      multiplier: next,
      multiplierByRun: undefined,
      multiplierEdited: true,
    }
  })
}

/* `from` is evaluated state; only the authored destination is changed here. */
export function setHandoffTo(
  sections: EditorSection[],
  nodeId: string,
  memberId: string,
): EditorSection[] {
  return mapNode(sections, nodeId, (node) => {
    if (node.type !== 'swap') {
      return node
    }

    return {
      ...node,
      to: memberId,
      toEdited: true,
      byRun: undefined,
      gate: undefined,
    }
  })
}

/* A checked-out pass owns the node being edited; no run overlay is authored. */
export function setCondValue(
  sections: EditorSection[],
  id: string,
  value: string,
): EditorSection[] {
  return mapNode(sections, id, (node) => {
    if (node.type !== 'condition') {
      return node
    }

    const rose = (from: string | undefined) => from !== undefined && (
      value === 'on' || (from !== '' && value !== '' && Number(value) > Number(from))
    )

    return {
      ...node,
      to: value,
      writeValue: value,
      writeEdited: true,
      rising: rose(node.from),
      byRun: undefined,
      gate: undefined,
    }
  })
}

export function setCondAction(
  sections: EditorSection[],
  id: string,
  action: ConditionWriteAction,
): EditorSection[] {
  return mapNode(sections, id, (node) => {
    if (node.type !== 'condition') {
      return node
    }

    const canAdd = node.state?.kind === 'number'
      || node.state?.kind === 'stack'
      || node.change?.type === 'add'
    const nextAction = action === 'add' && canAdd ? 'add' : 'set'

    return {
      ...node,
      writeAction: nextAction,
      writeEdited: true,
      byRun: undefined,
      gate: undefined,
    }
  })
}

export function setBlockValue(
  sections: EditorSection[],
  id: string,
  value: number,
): EditorSection[] {
  const update = (node: EditorNode): EditorNode => {
    if (!isBlock(node)) {
      return node
    }

    if (node.type === 'uptime') {
      const ratio = Math.min(1, Math.max(0, value / 100))
      return {
        ...node,
        ratio,
        ratioByRun: undefined,
        valueEdited: true,
      }
    }

    const runs = normLoopRuns(value)
    if (node.type === 'loop') {
      return {
        ...resizeLoopBlockRuns(node, runs),
        runsByRun: undefined,
        valueEdited: true,
      }
    }

    return {
      ...node,
      runs,
      runsByRun: undefined,
      valueEdited: true,
    }
  }

  const target = findNode(sections, id)
  if (target && isBlock(target) && target.type === 'loop') {
    return mapLoopBlocks(sections, target.loopId ?? target.id, (node) => update(node) as EditorBlock)
  }

  return mapNode(sections, id, update)
}

export function setBlockUptime(
  sections: EditorSection[],
  id: string,
  value: number,
): EditorSection[] {
  const ratio = Math.min(1, Math.max(0, value / 100))
  return mapNode(sections, id, (node) => (
    isBlock(node)
      && (node.type === 'repeat' || node.type === 'uptime')
      && Boolean(node.children.find((child): child is EditorBlock => child.type === 'setup')?.children.length)
      ? { ...node, ratio, ratioByRun: undefined, valueEdited: true }
      : node
  ))
}

/** Switch repeat/uptime implementations while retaining only frame metadata and body. */
export function reinitializeBlock(
  sections: EditorSection[],
  id: string,
  type: 'repeat' | 'uptime',
): EditorSection[] {
  const target = findNode(sections, id)
  if (!target || !isBlock(target) || target.type === type) {
    return sections
  }
  if (target.type !== 'repeat' && target.type !== 'uptime') {
    return sections
  }

  const body = target.children.filter((child) => child.type !== 'setup')
  const color = target.color ?? blockDefaultGenerators(sections, type).nextColor()
  const sourceNode: RotationNode = type === 'repeat'
    ? {
      id: target.id,
      type: 'repeat',
      label: target.label,
      color,
      times: 1,
      items: [],
      enabled: true,
    }
    : {
      id: target.id,
      type: 'uptime',
      label: target.label,
      color,
      ratio: 1,
      setup: [],
      items: [],
      enabled: true,
    }

  return mapNode(sections, id, () => ({
    ...makeContainer(type, target.id, target.owner, target.label, color, body),
    sourceNode,
  }))
}

export function removeNode(sections: EditorSection[], id: string): EditorSection[] {
  return mapLists(sections, (list) => {
    const index = list.findIndex((node) => node.id === id)
    if (index >= 0) {
      return list.filter((_, at) => at !== index)
    }

    let changed = false
    const next = list.map((node) => {
      if (!isEditorNoteHost(node) || node.attachedNote?.id !== id) {
        return node
      }
      changed = true
      const host = { ...node, noteEdited: true }
      delete host.attachedNote
      return host
    })
    return changed ? next : list
  })
}

/**
 * Remove several editor nodes with the same semantics as deleting them one at
 * a time. A loop is represented by markers, so deleting it unwraps its body;
 * repeat and uptime blocks own their children and are removed with them.
 */
export function removeNodes(
  sections: EditorSection[],
  ids: Iterable<string>,
): EditorSection[] {
  let next = sections

  for (const id of ids) {
    const node = findNode(next, id)
    if (!node) {
      continue
    }

    next = node.type === 'loop'
      ? unwrapLoop(next, node.loopId ?? node.id)
      : removeNode(next, id)
  }

  return next
}

/**
 * Whether a node can be lifted out of the tree whole. A loop drawn in segments
 * holds part of its body in each, and the segments are not in body order, so
 * lifting one out would reorder the loop rather than copy it.
 */
export function canLiftNode(node: EditorNode): boolean {
  return !(
    isBlock(node)
    && (
      node.wrap != null
      || (node.type === 'loop' && node.loopSegment != null && node.loopSegment !== 'both')
    )
  )
}

/**
 * The nodes an operation on a set of ids acts on, in tree order. A node inside
 * an already-collected block is skipped: the block carries its own children, so
 * collecting both would act on the same node twice.
 */
export function collectSubtrees(
  sections: EditorSection[],
  ids: ReadonlySet<string>,
): EditorNode[] {
  const out: EditorNode[] = []

  const walk = (list: readonly EditorNode[]) => {
    for (const node of list) {
      if (ids.has(node.id)) {
        out.push(node)
        continue
      }

      if (isBlock(node)) {
        walk(node.children)
      }
    }
  }

  for (const section of sections) {
    walk(section.children)
  }

  return out
}

/**
 * Remove nodes with their children, which is what taking them away leaves
 * behind. This is not `removeNodes`: deleting a loop unwraps it and keeps the
 * body, while cutting one takes the body with it.
 */
export function removeSubtrees(
  sections: EditorSection[],
  ids: Iterable<string>,
): EditorSection[] {
  const selectedIds = [...ids]
  let next = sections
  for (const id of selectedIds) {
    next = removeNode(next, id)
  }

  return next
}

export function replaceNodeWith(
  sections: EditorSection[],
  id: string,
  nodes: EditorNode[],
): EditorSection[] {
  return mapLists(sections, (list) => {
    const index = list.findIndex((node) => node.id === id)
    if (index < 0) {
      return list
    }

    const next = [...list]
    next.splice(index, 1, ...nodes)
    return next
  })
}

/**
 * Copy a node, and everything under it, as something new.
 *
 * A loop is more than its rows: it is an identity that its own markers, the
 * rules that name it, and the interpreter's own bookkeeping all point at. A
 * copy that kept that identity would be the same loop written twice, which
 * reads as one loop closing before it opens, so the copy takes a new one and
 * everything inside it that named the original is pointed at the copy.
 *
 * The markers it was projected from are dropped with it. They belong to the
 * loop that was copied, and the copy states itself from its own fields.
 */
export function cloneNode<T extends EditorNode>(node: T): T {
  const loopIds = new Map<string, string>()

  const mintIds = (current: EditorNode) => {
    if (!isBlock(current)) {
      return
    }
    if (current.type === 'loop') {
      loopIds.set(current.loopId ?? current.id, nextNodeId('loop-frame'))
    }
    current.children.forEach(mintIds)
  }
  mintIds(node)

  const copy = (current: EditorNode): EditorNode => {
    const rebound = current
    if (rebound.type === 'note') {
      const next = { ...rebound, id: nextNodeId('note') }
      delete next.sourceNode
      return next
    }

    const attachedNote = rebound.attachedNote
      ? copy(rebound.attachedNote) as EditorNote
      : undefined
    if (!isBlock(rebound)) {
      const attached = rebound.type === 'step' && rebound.attached?.length
        ? rebound.attached.map((child) => {
          const copied = copy(child)
          return copied.type === 'step' ? copied : child
        })
        : undefined
      return {
        ...rebound,
        id: nextNodeId(rebound.type),
        ...(attachedNote ? { attachedNote, noteEdited: true } : {}),
        ...(attached ? { attached, attachedEdited: true } : {}),
      }
    }

    const next: EditorBlock = {
      ...rebound,
      id: nextNodeId(rebound.type),
      ...(attachedNote ? { attachedNote, noteEdited: true } : {}),
      children: rebound.children.map(copy),
    }
    if (next.type !== 'loop') {
      return next
    }

    next.loopId = loopIds.get(rebound.loopId ?? rebound.id) ?? nextNodeId('loop-frame')
    next.passTemplate = rebound.passTemplate?.map(copy)
    next.passForks = rebound.passForks
      ? Object.fromEntries(
        Object.entries(rebound.passForks).map(([run, body]) => [run, body.map(copy)]),
      )
      : undefined
    delete next.sourceNode
    delete next.sourceEndNode
    /*
      a copy is one whole loop wherever it came from, so it never arrives as a
      piece of one: the piece it was copied from was a drawing of a loop whose
      markers stood apart, and these markers stand together.
    */
    delete next.wrap
    delete next.wrapOf
    delete next.loopSegment
    return next
  }

  return copy(node) as T
}

export function makeNote(
  text = '',
  options: { label?: string; color?: string } = {},
): EditorNote {
  return {
    type: 'note',
    id: nextNodeId('note'),
    text,
    ...(options.label ? { label: options.label } : {}),
    ...(options.color ? { color: options.color } : {}),
  }
}

/** Build a newly authored note with the next available label and colour. */
export function makeEmptyNote(sections: readonly EditorSection[]): EditorNote {
  const notes = authoredNotes(sections)
  return makeNote('', {
    label: makeNoteLabel(notes.map((note) => note.label))(),
    color: makeNoteColor(notes.map((note) => note.color))(),
  })
}

/** Attach one note to a logical node. An occupied host is left unchanged. */
export function attachNote(
  sections: EditorSection[],
  hostId: string,
  note: EditorNote,
): EditorSection[] {
  return mapNode(sections, hostId, (node) => (
    isEditorNoteHost(node) && !node.attachedNote
      ? { ...node, attachedNote: note, noteEdited: true }
      : node
  ))
}

/** Remove an owned note without removing its host from the rotation. */
export function detachNote(
  sections: EditorSection[],
  hostId: string,
): EditorSection[] {
  return mapNode(sections, hostId, (node) => {
    if (!isEditorNoteHost(node) || !node.attachedNote) {
      return node
    }
    const next = { ...node, noteEdited: true }
    delete next.attachedNote
    return next
  })
}

/**
 * Duplicate every named node, each copy standing directly after the node it
 * was copied from. It takes as many as you name, so one row and a whole
 * selection are the same call.
 *
 * A node that stands for a loop drawn in pieces is left alone: a piece is not
 * a loop, and copying one would make a marker with nothing to pair with.
 */
export function duplicateNodes(
  sections: EditorSection[],
  ids: ReadonlySet<string>,
): EditorSection[] {
  if (ids.size === 0) {
    return sections
  }

  return mapLists(sections, (list) => {
    if (!list.some((node) => ids.has(node.id) && canLiftNode(node))) {
      return list
    }
    return list.flatMap((node) => (
      ids.has(node.id) && canLiftNode(node) ? [node, cloneNode(node)] : [node]
    ))
  })
}

/**
 * Drop a new node in after `afterId`. With nothing selected, or a selection
 * that is no longer in the tree, it lands at the end of `fallbackSectionId` so
 * the palette always has somewhere to add to.
 */
export function insertNode(
  sections: EditorSection[],
  node: EditorNode,
  afterId: string | null,
  fallbackSectionId: string,
): EditorSection[] {
  if (afterId && findNode(sections, afterId) && canSitBeside(sections, node, afterId)) {
    return insertBeside(sections, node, afterId, 'after')
  }

  return appendToSection(sections, node, fallbackSectionId)
}

/** a step's own settings, edited from the inspector */
export function updateStep(
  sections: EditorSection[],
  id: string,
  patch: (step: EditorStep) => EditorStep,
): EditorSection[] {
  return mapNode(sections, id, (node) => (node.type === 'step' ? patch(node) : node))
}

/*
  hang a feature off another. the child is an ordinary step and keeps its own
  id, so it resolves its own rows on the next run; the parent only records that
  its attachments were authored here rather than read off the source node.
*/
export function attachFeature(
  sections: EditorSection[],
  parentId: string,
  child: EditorStep,
): EditorSection[] {
  return updateStep(sections, parentId, (step) => ({
    ...step,
    attached: [...(step.attached ?? []), child],
    attachedEdited: true,
  }))
}

/*
  a carried feature's own multiplier, authored on the parent because that is the
  only panel it has. what the engine runs it at is this times the parent's.
*/
export function setAttachedMultiplier(
  sections: EditorSection[],
  parentId: string,
  childId: string,
  value: number,
): EditorSection[] {
  const next = Math.max(1, Math.floor(value))
  return updateStep(sections, parentId, (step) => ({
    ...step,
    attached: (step.attached ?? []).map((child) => (
      child.id === childId
        ? {
          ...child,
          multiplier: next,
          multiplierByRun: undefined,
          multiplierEdited: true,
        }
        : child
    )),
    attachedEdited: true,
  }))
}

export function detachFeature(
  sections: EditorSection[],
  parentId: string,
  childId: string,
): EditorSection[] {
  return updateStep(sections, parentId, (step) => ({
    ...step,
    attached: (step.attached ?? []).filter((child) => child.id !== childId),
    attachedEdited: true,
  }))
}

/**
 * Swap a step for a neighbouring skill. Its damage no longer describes what it
 * is, so it goes back to unrun until the next run fills it in.
 */
export function replaceFeature(
  sections: EditorSection[],
  id: string,
  featureId: string,
  label: string,
): EditorSection[] {
  return updateStep(sections, id, (step) => ({
    ...step,
    featureId,
    label,
    damageByRun: {},
    statsByRun: {},
    writesByRun: undefined,
    gate: undefined,
  }))
}

/** wrap a node in a block of its own, in place */
function makeWrappedBlock(
  nodes: EditorNode[],
  type: AuthoredBlockType,
  nextLabel: () => string,
  nextColor: () => string,
): EditorBlock {
  const firstOwned = nodes.find(
    (node): node is Exclude<EditorNode, EditorNote> => node.type !== 'note',
  )
  if (!firstOwned) {
    throw new Error('A display-only note cannot create an execution block by itself')
  }
  const owner = firstOwned.type === 'swap'
    ? { kind: 'member' as const, memberId: firstOwned.to }
    : firstOwned.owner
  return makeContainer(
    type,
    nextNodeId(type),
    owner,
    nextLabel(),
    nextColor(),
    nodes,
  )
}

/**
 * Wrap each contiguous sibling group in the selection. A selected parent
 * represents its descendants, so traversal does not also transform selected
 * children inside that parent.
 */
export function wrapNodes(
  sections: EditorSection[],
  ids: ReadonlySet<string>,
  type: 'loop' | 'repeat' | 'uptime',
): EditorSection[] {
  if (ids.size === 0) {
    return sections
  }

  // Same rule as the pane: setup-branch nodes cannot be wrapped.
  const setupWrappableIds = wrappableNodeIds(
    ids,
    (nodeId) => isInsideSetup(sections, nodeId),
  )
  const wrappableIds = new Set(
    [...setupWrappableIds].filter((nodeId) => findNode(sections, nodeId)?.type !== 'note'),
  )
  if (wrappableIds.size === 0) {
    return sections
  }

  /*
    a loop takes the next colour nothing else is using, the same way it takes
    its label. wrapping several groups at once is several loops, so they draw
    from the one run of colours and come out apart from each other.
  */
  const { nextLabel, nextColor } = blockDefaultGenerators(sections, type)

  const visit = (nodes: EditorNode[], inSetup: boolean): EditorNode[] => {
    const next: EditorNode[] = []
    let changed = false

    for (let index = 0; index < nodes.length;) {
      if (!inSetup && wrappableIds.has(nodes[index].id)) {
        const group: EditorNode[] = []
        while (index < nodes.length && wrappableIds.has(nodes[index].id)) {
          group.push(nodes[index])
          index += 1
        }
        next.push(makeWrappedBlock(group, type, nextLabel, nextColor))
        changed = true
        continue
      }

      const node = nodes[index]
      if (isBlock(node)) {
        const children = visit(node.children, inSetup || node.type === 'setup')
        if (children !== node.children) {
          next.push({ ...node, children, nodeCount: children.length })
          changed = true
        } else {
          next.push(node)
        }
      } else {
        next.push(node)
      }
      index += 1
    }

    return changed ? next : nodes
  }

  let changed = false
  const next = sections.map((section) => {
    const children = visit(section.children, false)
    if (children === section.children) {
      return section
    }
    changed = true
    return { ...section, children }
  })

  return changed ? next : sections
}

/** wrap one node in place */
export function wrapNode(
  sections: EditorSection[],
  id: string,
  type: 'loop' | 'repeat' | 'uptime',
): EditorSection[] {
  if (isInsideSetup(sections, id)) {
    return sections
  }

  return wrapNodes(sections, new Set([id]), type)
}

/** put a node at the end of a section, which is how an empty one is filled */
/*
  the end of a section is inside a wrapped loop's trailing segment, not after
  it: that segment runs to the bottom of the list, so its bracket is the last
  segment runs to the bottom of the list, so appending after it would place
  the node outside a block it is written inside.
*/
function lastOfSection(children: EditorNode[]): EditorNode | undefined {
  const last = children[children.length - 1]
  if (last && isEditorBlock(last) && last.wrap === 'tail') {
    return lastOfSection(last.children) ?? last
  }
  return last
}

function appendToTail(children: EditorNode[], node: EditorNode): EditorNode[] {
  const last = children[children.length - 1]
  if (last && isEditorBlock(last) && last.wrap === 'tail') {
    const nextChildren = appendToTail(last.children, node)
    return [
      ...children.slice(0, -1),
      { ...last, children: nextChildren, nodeCount: nextChildren.length },
    ]
  }

  return [...children, node]
}

function appendToSection(
  sections: EditorSection[],
  node: EditorNode,
  sectionId: string,
): EditorSection[] {
  if (!sections.some((section) => section.id === sectionId)) {
    return sections
  }

  return sections.map((section) =>
    section.id === sectionId
      ? { ...section, children: appendToTail(section.children, node) }
      : section,
  )
}

/**
 * Put a node at the end of whatever holds it: a section, or a block that is
 * currently empty. A block with nothing in it has no row to drop beside, so
 * this is the only way into one.
 */
export function appendInto(
  sections: EditorSection[],
  node: EditorNode,
  containerId: string,
): EditorSection[] {
  if (sections.some((section) => section.id === containerId)) {
    return appendToSection(sections, node, containerId)
  }

  return mapNode(sections, containerId, (target) => {
    if (!isBlock(target)) {
      return target
    }
    // Setup executes conditions only; notes may sit there because they do not execute.
    if (target.type === 'setup' && node.type !== 'condition' && node.type !== 'note') {
      return target
    }
    const children = [...target.children, node]
    return { ...target, children, nodeCount: children.length }
  })
}

/** lift a node out of wherever it is and set it down at the end of a container */
export function moveInto(
  sections: EditorSection[],
  id: string,
  containerId: string,
): EditorSection[] {
  if (sections.some((section) => section.id === containerId)) {
    return moveToSection(sections, id, containerId)
  }

  // a block cannot be put inside itself, nor inside anything it holds
  if (id === containerId || isWithin(sections, id, containerId)) {
    return sections
  }

  const node = findNode(sections, id)
  const target = findNode(sections, containerId)
  if (!node || !target || !isBlock(target)) {
    return sections
  }
  if (target.type === 'setup' && node.type !== 'condition' && node.type !== 'note') {
    return sections
  }

  return appendInto(removeNode(sections, id), node, containerId)
}

/** lift a selection out of wherever it is and set it down at a container's end */
export function moveIntoMany(
  sections: EditorSection[],
  ids: ReadonlySet<string>,
  containerId: string,
): EditorSection[] {
  const moving = collectSubtrees(sections, ids)
  if (moving.length === 0) {
    return sections
  }

  if (moving.some((node) => node.id === containerId || isWithin(sections, node.id, containerId))) {
    return sections
  }

  const target = findNode(sections, containerId)
  if (
    target
    && isBlock(target)
    && target.type === 'setup'
    && moving.some((node) => node.type !== 'condition' && node.type !== 'note')
  ) {
    return sections
  }

  let next = sections
  for (const node of moving) {
    next = moveInto(next, node.id, containerId)
  }

  return next
}

/** lift a node out of wherever it is and set it down at a section's end */
function moveToSection(
  sections: EditorSection[],
  id: string,
  sectionId: string,
): EditorSection[] {
  const node = findNode(sections, id)
  const section = sections.find((entry) => entry.id === sectionId)
  if (!node || !section) {
    return sections
  }

  // already the last thing in that section: nothing to do. the last thing may
  // be inside a wrapped loop's trailing segment, which is where an append goes.
  if (lastOfSection(section.children)?.id === id) {
    return sections
  }

  return appendToSection(removeNode(sections, id), node, sectionId)
}

export type DropEdge = 'before' | 'after'

/** true when `id` is `ancestorId` or sits somewhere inside it */
function isWithin(sections: EditorSection[], ancestorId: string, id: string): boolean {
  if (ancestorId === id) {
    return true
  }

  const node = findNode(sections, ancestorId)
  if (!node || !isBlock(node)) {
    return false
  }

  const visit = (list: EditorNode[]): boolean =>
    list.some((entry) => entry.id === id || (isBlock(entry) && visit(entry.children)))

  return visit(node.children)
}

function holds(node: EditorNode, id: string): boolean {
  if (node.id === id) {
    return true
  }
  return isBlock(node) ? node.children.some((child) => holds(child, id)) : false
}

type LoopExtentMarker = {
  kind: 'loop-extent-marker'
  marker: 'start' | 'end'
}

type LoopExtentEntry =
  | LoopExtentMarker
  | {
    kind: 'node'
    node: EditorNode
    children?: LoopExtentEntry[]
  }

const LOOP_EXTENT_START: LoopExtentMarker = {
  kind: 'loop-extent-marker',
  marker: 'start',
}

const LOOP_EXTENT_END: LoopExtentMarker = {
  kind: 'loop-extent-marker',
  marker: 'end',
}

function isLoopExtentMarker(entry: LoopExtentEntry): entry is LoopExtentMarker {
  return entry.kind === 'loop-extent-marker'
}

function isSameEditorLoop(
  node: EditorNode,
  loopId: string,
): node is EditorBlock & { type: 'loop' } {
  return isBlock(node) && node.type === 'loop' && (node.loopId ?? node.id) === loopId
}

function loopSegmentEntries(
  node: EditorBlock,
  loopId: string,
): LoopExtentEntry[] {
  const children = node.children.flatMap((child) => loopExtentEntries(child, loopId))

  if (node.wrap === 'head') {
    return [...children, LOOP_EXTENT_END]
  }
  if (node.wrap === 'middle') {
    return children
  }
  if (node.wrap === 'tail') {
    return [LOOP_EXTENT_START, ...children]
  }
  return [LOOP_EXTENT_START, ...children, LOOP_EXTENT_END]
}

function loopExtentEntries(
  node: EditorNode,
  loopId: string,
): LoopExtentEntry[] {
  if (isSameEditorLoop(node, loopId)) {
    return loopSegmentEntries(node, loopId)
  }

  return [{
    kind: 'node',
    node,
    ...(isBlock(node)
      ? { children: node.children.flatMap((child) => loopExtentEntries(child, loopId)) }
      : {}),
  }]
}

function sectionExtentEntries(
  sections: EditorSection[],
  loopId: string,
): LoopExtentEntry[][] {
  return sections.map((section) =>
    section.children.flatMap((node) => loopExtentEntries(node, loopId)))
}

function withoutLoopEndMarker(entries: LoopExtentEntry[]): LoopExtentEntry[] {
  return entries.flatMap((entry): LoopExtentEntry[] => {
    if (isLoopExtentMarker(entry)) {
      return entry.marker === 'end' ? [] : [entry]
    }
    if (!entry.children) {
      return [entry]
    }
    return [{ ...entry, children: withoutLoopEndMarker(entry.children) }]
  })
}

function insertLoopEndAfter(
  entries: LoopExtentEntry[],
  targetId: string,
): { entries: LoopExtentEntry[]; inserted: boolean } {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (isLoopExtentMarker(entry)) {
      continue
    }

    if (entry.node.id === targetId) {
      return {
        entries: [
          ...entries.slice(0, index + 1),
          LOOP_EXTENT_END,
          ...entries.slice(index + 1),
        ],
        inserted: true,
      }
    }

    if (entry.children) {
      const nested = insertLoopEndAfter(entry.children, targetId)
      if (nested.inserted) {
        const next = [...entries]
        next[index] = { ...entry, children: nested.entries }
        return { entries: next, inserted: true }
      }
    }
  }

  return { entries, inserted: false }
}

function insertLoopEndInto(
  entries: LoopExtentEntry[],
  targetId: string,
): { entries: LoopExtentEntry[]; inserted: boolean } {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (isLoopExtentMarker(entry)) {
      continue
    }

    if (entry.node.id === targetId && entry.children) {
      const next = [...entries]
      next[index] = {
        ...entry,
        children: [...entry.children, LOOP_EXTENT_END],
      }
      return { entries: next, inserted: true }
    }

    if (entry.children) {
      const nested = insertLoopEndInto(entry.children, targetId)
      if (nested.inserted) {
        const next = [...entries]
        next[index] = { ...entry, children: nested.entries }
        return { entries: next, inserted: true }
      }
    }
  }

  return { entries, inserted: false }
}

function insertLoopEndAfterStart(
  entries: LoopExtentEntry[],
): { entries: LoopExtentEntry[]; inserted: boolean } {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (isLoopExtentMarker(entry) && entry.marker === 'start') {
      return {
        entries: [
          ...entries.slice(0, index + 1),
          LOOP_EXTENT_END,
          ...entries.slice(index + 1),
        ],
        inserted: true,
      }
    }

    if (!isLoopExtentMarker(entry) && entry.children) {
      const nested = insertLoopEndAfterStart(entry.children)
      if (nested.inserted) {
        const next = [...entries]
        next[index] = { ...entry, children: nested.entries }
        return { entries: next, inserted: true }
      }
    }
  }

  return { entries, inserted: false }
}

/*
  where the end of a loop that has none sits: on the start. the body runs from
  the marker to the foot of the list, round to the top, and back to the marker,
  so the row it stops at is the one standing just above it.
*/
function insertLoopEndBeforeStart(
  entries: LoopExtentEntry[],
): { entries: LoopExtentEntry[]; inserted: boolean } {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (isLoopExtentMarker(entry) && entry.marker === 'start') {
      return {
        entries: [
          ...entries.slice(0, index),
          LOOP_EXTENT_END,
          ...entries.slice(index),
        ],
        inserted: true,
      }
    }

    if (!isLoopExtentMarker(entry) && entry.children) {
      const nested = insertLoopEndBeforeStart(entry.children)
      if (nested.inserted) {
        const next = [...entries]
        next[index] = { ...entry, children: nested.entries }
        return { entries: next, inserted: true }
      }
    }
  }

  return { entries, inserted: false }
}

function hasLoopExtentMarker(entries: LoopExtentEntry[]): boolean {
  return entries.some((entry) =>
    isLoopExtentMarker(entry) || Boolean(entry.children && hasLoopExtentMarker(entry.children)))
}

function loopExtentMarkerOrder(entryLists: LoopExtentEntry[][]): Array<'start' | 'end'> {
  const order: Array<'start' | 'end'> = []
  const visit = (entries: LoopExtentEntry[]) => {
    for (const entry of entries) {
      if (isLoopExtentMarker(entry)) {
        order.push(entry.marker)
      } else if (entry.children) {
        visit(entry.children)
      }
    }
  }
  entryLists.forEach(visit)
  return order
}

function targetInsideSetup(
  sections: EditorSection[],
  targetId: string,
): boolean {
  const visit = (nodes: EditorNode[], inSetup: boolean): boolean => {
    for (const node of nodes) {
      const nestedSetup = inSetup || (isBlock(node) && node.type === 'setup')
      if (node.id === targetId) {
        return nestedSetup
      }
      if (isBlock(node) && visit(node.children, nestedSetup)) {
        return true
      }
    }
    return false
  }

  return sections.some((section) => visit(section.children, false))
}

interface LoopExtentState {
  active: boolean
  segmentIndex: number
}

function makeLoopExtentSegment(
  template: EditorBlock,
  children: EditorNode[],
  hasStart: boolean,
  hasEnd: boolean,
  state: LoopExtentState,
): EditorBlock | null {
  if (!hasStart && !hasEnd && children.length === 0) {
    return null
  }

  const wrap = hasStart && hasEnd
    ? undefined
    : hasStart
      ? 'tail'
      : hasEnd
        ? 'head'
        : 'middle'
  const loopSegment = hasStart && hasEnd
    ? 'both'
    : hasStart
      ? 'start'
      : hasEnd
        ? 'end'
        : 'middle'
  const id = hasStart
    ? template.id
    : `${template.id}:segment:${state.segmentIndex++}`

  return {
    ...template,
    id,
    loopSegment,
    ...(wrap ? { wrap } : {}),
    ...(!wrap ? { wrap: undefined } : {}),
    ...(hasStart ? { wrapOf: undefined } : { wrapOf: template.id }),
    nodeCount: children.length,
    children,
  }
}

function restoreLoopExtentEntries(entries: LoopExtentEntry[]): EditorNode[] {
  return entries.flatMap((entry): EditorNode[] => {
    if (isLoopExtentMarker(entry)) {
      return []
    }
    if (!entry.children || !isBlock(entry.node)) {
      return [entry.node]
    }
    const children = restoreLoopExtentEntries(entry.children)
    return [{
      ...entry.node,
      children,
      nodeCount: children.length,
    }]
  })
}

function materializeLoopExtentList(
  entries: LoopExtentEntry[],
  template: EditorBlock,
  state: LoopExtentState,
): EditorNode[] {
  const out: EditorNode[] = []
  let segmentChildren: EditorNode[] = []
  let segmentHasStart = false
  let segmentHasEnd = false

  const flush = () => {
    const segment = makeLoopExtentSegment(
      template,
      segmentChildren,
      segmentHasStart,
      segmentHasEnd,
      state,
    )
    if (segment) {
      out.push(segment)
    }
    segmentChildren = []
    segmentHasStart = false
    segmentHasEnd = false
  }

  for (const entry of entries) {
    if (isLoopExtentMarker(entry)) {
      if (entry.marker === 'start') {
        if (state.active) {
          flush()
        }
        state.active = true
        segmentHasStart = true
      } else {
        if (!state.active) {
          continue
        }
        segmentHasEnd = true
        flush()
        state.active = false
      }
      continue
    }

    if (entry.children && hasLoopExtentMarker(entry.children)) {
      flush()
      const children = materializeLoopExtentList(entry.children, template, state)
      const node = isBlock(entry.node)
        ? {
          ...entry.node,
          children,
          nodeCount: children.length,
        }
        : entry.node
      out.push(node)
      continue
    }

    const node = entry.children && isBlock(entry.node)
      ? (() => {
        const children = restoreLoopExtentEntries(entry.children)
        return {
          ...entry.node,
          children,
          nodeCount: children.length,
        }
      })()
      : entry.node

    if (state.active) {
      segmentChildren.push(node)
    } else {
      out.push(node)
    }
  }

  flush()
  return out
}

function setLoopExtent(
  sections: EditorSection[],
  block: EditorBlock,
  targetId: string,
  placement: 'after' | 'inside',
): EditorSection[] {
  if (targetInsideSetup(sections, targetId)) {
    return sections
  }

  const loopId = block.loopId ?? block.id
  /*
    the loop's other segments are drawn on the page but they are not in the
    list the markers are placed in: the extent is one start and one end over
    the rows themselves. released on a segment of this same loop, the end goes
    where that segment stops, which is the last row it holds. a segment holding
    no rows is only the marker showing, so there is nothing there to close on.
  */
  const target = findNode(sections, targetId)
  const targetSegment = target
    && target.id !== block.id
    && isSameEditorLoop(target, loopId)
    ? target
    : null
  if (targetSegment && targetSegment.children.length === 0) {
    return sections
  }

  const withoutEnd = sectionExtentEntries(sections, loopId).map(withoutLoopEndMarker)
  const targetsOwnBody = placement === 'inside' && targetId === block.id
  const resolvedTargetId = targetSegment
    ? targetSegment.children[targetSegment.children.length - 1].id
    : targetsOwnBody
      ? block.children[block.children.length - 1]?.id ?? block.id
      : targetId
  let inserted = false
  const withEnd = withoutEnd.map((entries, sectionIndex) => {
    if (inserted) {
      return entries
    }
    const section = sections[sectionIndex]
    const result = placement === 'inside' && section?.id === targetId
      ? { entries: [...entries, LOOP_EXTENT_END], inserted: true }
      : placement === 'inside' && !targetsOwnBody && !targetSegment
        ? insertLoopEndInto(entries, targetId)
        : resolvedTargetId === block.id
          ? insertLoopEndAfterStart(entries)
          : insertLoopEndAfter(entries, resolvedTargetId)
    inserted = result.inserted
    return result.entries
  })
  if (!inserted) {
    return sections
  }

  return materializeLoopExtent(sections, withEnd, { ...block, noEnd: undefined })
}

function materializeLoopExtent(
  sections: EditorSection[],
  entryLists: LoopExtentEntry[][],
  template: EditorBlock,
): EditorSection[] {
  const markerOrder = loopExtentMarkerOrder(entryLists)
  const state: LoopExtentState = {
    active: markerOrder[0] === 'end',
    segmentIndex: 1,
  }
  const next = sections.map((section, index) => ({
    ...section,
    children: materializeLoopExtentList(entryLists[index], template, state),
  }))

  // A wrap loop remains active after its start because its end was already
  // encountered at the top of the authored order. That state is local to this
  // materialization pass, not a scope that leaks into another edit.
  state.active = false
  return next
}

/**
 * Take a loop's end away, so it runs on round to its own start again.
 *
 * The end does not simply vanish: a loop that has none still stops somewhere,
 * and where it stops is the row above its own start. So the end is moved
 * there, which is where the page already draws it, and the loop is marked as
 * written without one so nothing writes the marker back out.
 */
export function removeLoopEnd(sections: EditorSection[], loopId: string): EditorSection[] {
  const start = findLoopStartSegment(sections, loopId)
  if (!start) {
    return sections
  }

  const stripped = sectionExtentEntries(sections, loopId).map(withoutLoopEndMarker)
  let inserted = false
  const withEnd = stripped.map((entries) => {
    if (inserted) {
      return entries
    }
    const result = insertLoopEndBeforeStart(entries)
    inserted = result.inserted
    return result.entries
  })
  if (!inserted) {
    return sections
  }

  const template: EditorBlock = { ...start, noEnd: true, sourceEndNode: undefined }
  return materializeLoopExtent(sections, withEnd, template)
}

/** the segment a loop's start marker stands in, which is the loop as authored */
function findLoopStartSegment(
  sections: EditorSection[],
  loopId: string,
): EditorBlock | null {
  let found: EditorBlock | null = null
  const visit = (nodes: EditorNode[]) => {
    for (const node of nodes) {
      if (found || !isBlock(node)) {
        continue
      }
      if (
        node.type === 'loop'
        && (node.loopId ?? node.id) === loopId
        && (node.wrap == null || node.wrap === 'tail')
      ) {
        found = node
        return
      }
      visit(node.children)
    }
  }

  for (const section of sections) {
    visit(section.children)
  }
  return found
}

/**
 * Move a block's closing edge to end at `targetId`, which is what dragging the
 * bracket's bottom does. Dragged down over a following sibling the block takes
 * everything down to it; dragged up over one of its own rows the rest spill out
 * below it; dragged onto the head the block gives everything up. Repeat and
 * uptime blocks cannot end before their heads. Loop edges are independent
 * markers, so their branch above handles wrap and cross-container targets.
 *
 * A loop with no end marker is drawn as two segments of one loop. Giving it an
 * end is exactly what this gesture does, so the segments collapse back into one
 * ordinary block and the rows that were only in it by wrapping are let go.
 */
export function setBlockExtent(
  sections: EditorSection[],
  blockId: string,
  targetId: string,
  placement: 'after' | 'inside' = 'after',
): EditorSection[] {
  const selected = findNode(sections, blockId)
  if (selected?.type === 'loop') {
    return setLoopExtent(sections, selected, targetId, placement)
  }
  if (placement === 'inside') {
    return sections
  }

  return mapLists(sections, (list) => {
    let working = list
    let index = working.findIndex((node) => node.id === blockId)
    if (index < 0) {
      return list
    }

    let block = working[index]
    if (!isBlock(block)) {
      return list
    }

    // the end being placed is the end this loop never had
    if (block.wrap === 'tail') {
      const headIndex = working.findIndex(
        (node) => isBlock(node) && node.wrap === 'head' && node.wrapOf === blockId,
      )
      if (headIndex >= 0) {
        const head = working[headIndex] as typeof block
        working = [
          ...working.slice(0, headIndex),
          ...head.children,
          ...working.slice(headIndex + 1),
        ]
        index = working.findIndex((node) => node.id === blockId)
      }

      const bounded = { ...block }
      delete bounded.wrap
      delete bounded.wrapOf
      block = bounded
      working = working.map((node) => (node.id === blockId ? bounded : node))
    }

    const settle = (children: EditorNode[], after: EditorNode[], from: number) => [
      ...working.slice(0, index),
      { ...block, children, nodeCount: children.length },
      ...after,
      ...working.slice(from),
    ]

    /*
      an uptime's setup branch is part of the block rather than something it
      holds: it opens the window the rest of the block runs in. it never leaves
      and it is never where the block ends, so the edge passes over it.
    */
    const isSetupBranch = (node: EditorNode) => isBlock(node) && node.type === 'setup'
    const pinned = block.children.filter(isSetupBranch)
    const movable = block.children.filter((child) => !isSetupBranch(child))

    if (pinned.some((child) => holds(child, targetId))) {
      return working === list ? list : working
    }

    // one of its own rows: everything past it spills out below the block
    const inside = movable.findIndex((child) => holds(child, targetId))
    if (inside >= 0) {
      const keep = [...pinned, ...movable.slice(0, inside + 1)]
      const spill = movable.slice(inside + 1)
      return spill.length === 0 && working === list
        ? list
        : settle(keep, spill, index + 1)
    }

    // the head itself: the block keeps nothing it can let go of
    if (targetId === blockId) {
      return movable.length === 0 && working === list
        ? list
        : settle(pinned, movable, index + 1)
    }

    // a following sibling: the block swallows down to it
    const below = working.findIndex((node, at) => at > index && holds(node, targetId))
    if (below > index) {
      return settle([...block.children, ...working.slice(index + 1, below + 1)], [], below + 1)
    }

    // above the head, or somewhere else entirely: nothing to do
    return working === list ? list : working
  })
}

/** set a node down on one side of another, wherever that other one lives */
export function insertBeside(
  sections: EditorSection[],
  node: EditorNode,
  targetId: string,
  edge: DropEdge,
): EditorSection[] {
  if (!canSitBeside(sections, node, targetId)) {
    return sections
  }
  const target = findNode(sections, targetId)
  if (edge === 'after' && target && isBlock(target) && target.wrap === 'tail') {
    return appendInto(sections, node, target.id)
  }

  return mapLists(sections, (list) => {
    const index = list.findIndex((entry) => entry.id === targetId)
    if (index < 0) {
      return list
    }
    const next = [...list]
    next.splice(edge === 'before' ? index : index + 1, 0, node)
    return next
  })
}

/**
 * Pick a node up and set it down beside another one. Dropping beside a node
 * that lives inside a loop moves it into that loop, which is how a node
 * changes parent without a separate reparent gesture.
 */
export function relocateNode(
  sections: EditorSection[],
  id: string,
  targetId: string,
  edge: DropEdge,
): EditorSection[] {
  // a block cannot be dropped inside itself, and a node dropped beside itself
  // has not moved
  if (id === targetId || isWithin(sections, id, targetId)) {
    return sections
  }

  const node = findNode(sections, id)
  if (!node || !findNode(sections, targetId) || !canSitBeside(sections, node, targetId)) {
    return sections
  }

  return insertBeside(removeNode(sections, id), node, targetId, edge)
}

/**
 * Every node a selection would carry, including the rows sitting inside a
 * picked block. None of them can be the place the set is set down.
 */
export function collectHeldIds(
  sections: EditorSection[],
  ids: ReadonlySet<string>,
): ReadonlySet<string> {
  const out = new Set<string>()

  const swallow = (node: EditorNode) => {
    out.add(node.id)
    if (isBlock(node)) {
      for (const child of node.children) swallow(child)
    }
  }

  for (const node of collectSubtrees(sections, ids)) swallow(node)
  return out
}

/**
 * Move a whole selection to one place, in the order the list reads rather than
 * the order the rows were picked.
 *
 * Rows that were never neighbours become neighbours, which is a real edit to
 * the program and not a tidy-up: the caller is expected to have said so before
 * this runs.
 */
export function relocateNodes(
  sections: EditorSection[],
  ids: ReadonlySet<string>,
  targetId: string,
  edge: DropEdge,
): EditorSection[] {
  // a picked node inside a picked block travels with the block, never twice
  const moving = collectSubtrees(sections, ids)
  if (moving.length === 0) {
    return sections
  }

  if (moving.length === 1) {
    return relocateNode(sections, moving[0]!.id, targetId, edge)
  }

  // nothing can be set down on itself, or inside something it is holding
  if (moving.some((node) => isWithin(sections, node.id, targetId))) {
    return sections
  }

  if (
    !findNode(sections, targetId)
    || !moving.every((node) => canSitBeside(sections, node, targetId))
  ) {
    return sections
  }

  let next = removeSubtrees(sections, moving.map((node) => node.id))
  if (!findNode(next, targetId)) {
    return sections
  }

  // the first lands beside the target, and each one after it follows the last,
  // so the set arrives reading the way it read before
  let anchor = targetId
  let anchorEdge = edge
  for (const node of moving) {
    const placed = insertBeside(next, node, anchor, anchorEdge)
    if (placed === next) {
      return sections
    }
    next = placed
    anchor = node.id
    anchorEdge = 'after'
  }

  return next
}

interface NodeCounts {
  nodes: number
  steps: number
}

export function countNodes(list: EditorNode[]): NodeCounts {
  let nodes = 0
  let steps = 0

  const visit = (entries: EditorNode[]) => {
    for (const node of entries) {
      nodes += 1
      if (node.type === 'step') {
        steps += 1
      } else if (isBlock(node)) {
        visit(node.children)
      }
    }
  }

  visit(list)
  return { nodes, steps }
}

/** a step added since the last run has no simulated damage yet */
export function isUnrun(node: EditorNode): boolean {
  return node.type === 'step' && Object.keys(node.damageByRun).length === 0
}

/** a step built from a palette entry, owned by whoever holds the field */
export function makeStep(label: string, memberId: MemberId): EditorStep {
  return {
    type: 'step',
    id: nextNodeId('step'),
    owner: { kind: 'member', memberId },
    label,
    index: 0,
    multiplier: 1,
    damageByRun: {},
    statsByRun: {},
    memberId,
    kindLabel: 'Added',
    buffCount: 0,
  }
}

/** a condition built from a palette choice, written as a fresh state change */
export function makeCondition(label: string, memberId: MemberId): EditorCondition {
  return {
    type: 'condition',
    id: nextNodeId('cond'),
    owner: { kind: 'member', memberId },
    label,
    to: 'on',
    rising: false,
  }
}
