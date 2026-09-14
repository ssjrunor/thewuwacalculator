/*
  Author: Runor Ewhro
  Description: Owns to rotation nodes behavior and state transitions for the model module.
*/

import type {
  RotationNoteNode,
  RotationNode,
  RuntimeValue,
  RtChng,
  SourceState,
} from '@/domain/gameData/contracts.ts'
import type {
  ConditionWriteAction,
  EditorBlock,
  EditorCondition,
  EditorHandoff,
  EditorNote,
  EditorNode,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import { isEditorBlock } from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import { markEditorSection } from '@/modules/simulation/features/rotation/program-editor/model/sections.ts'
import {
  ROT_LOOP_COLORS,
} from '@/modules/simulation/features/rotation/shared/loopMeta.ts'
import {
  makeLoopEnd as createLoopEnd,
  makeLoopStart as createLoopStart,
  normLoopRuns,
  type RotLoopEnd,
  type RotLoopStart,
} from '@/domain/gameData/rotationLoops.ts'
import { makeBlockNode } from '@/modules/simulation/features/rotation/shared/nodeTools.ts'
import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'
import { parseRegValue } from '@/modules/simulation/features/rotation/program-editor/model/registerValues.ts'
import {
  normalizeFeatureAttachments,
  stripFeatureAttachments,
} from '@/domain/gameData/rotationAttached.ts'
import {
  checkinAllLoopPasses,
  checkinLoopBlock,
  isCheckoutableLoop,
} from '@/modules/simulation/features/rotation/program-editor/model/passCheckout.ts'

interface OriginalIndex {
  byId: Map<string, RotationNode>
  loopStartByLoopId: Map<string, RotLoopStart>
  loopEndByLoopId: Map<string, RotLoopEnd>
}

function indexOriginals(items: RotationNode[]): OriginalIndex {
  const byId = new Map<string, RotationNode>()
  const loopStartByLoopId = new Map<string, RotLoopStart>()
  const loopEndByLoopId = new Map<string, RotLoopEnd>()

  const visit = (nodes: RotationNode[]) => {
    for (const node of nodes) {
      byId.set(node.id, node)
      if ('note' in node && node.note) {
        byId.set(node.note.id, node.note)
      }
      if (node.type === 'loop') {
        if (node.kind === 'start') {
          loopStartByLoopId.set(node.loopId, node)
        } else {
          loopEndByLoopId.set(node.loopId, node)
        }
      }
      if (node.type === 'repeat') {
        visit(node.setup ?? [])
        visit(node.items)
      } else if (node.type === 'uptime') {
        visit(node.setup ?? [])
        visit(node.items)
      }
    }
  }

  visit(items)
  return { byId, loopStartByLoopId, loopEndByLoopId }
}

/**
 * Rewrite an authored change from a value in display form. The controls speak
 * the regular text the rows do, so the value is parsed back against the state
 * it writes before it is stored.
 */
export function changeFromRegValue(
  change: RtChng,
  state: SourceState | undefined,
  value: string,
  action?: ConditionWriteAction,
): RtChng {
  const parsed = parseRegValue(state, value, change)
  return action
    ? changeWithAction(change, action, parsed)
    : changeWithValue(change, parsed)
}

function firstChangeFromCondition(node: EditorCondition): RtChng | null {
  if (!node.path) {
    return null
  }

  const hasWriteValue = Object.prototype.hasOwnProperty.call(node, 'writeValue')
  const writeValue = parseRegValue(
    node.state,
    hasWriteValue ? node.writeValue : node.to,
    node.change,
  )
  if (node.change) {
    return node.writeAction
      ? changeWithAction(node.change, node.writeAction, writeValue)
      : changeWithValue(node.change, writeValue)
  }

  const resonatorId = node.owner.kind === 'member' ? node.owner.memberId : undefined
  return node.writeAction === 'add'
    ? {
      type: 'add',
      path: node.path,
      value: Number(writeValue) || 0,
      resonatorId,
    }
    : {
      type: 'set',
      path: node.path,
      value: writeValue ?? '',
      resonatorId,
    }
}

function changeWithValue(change: RtChng, value: RuntimeValue | undefined): RtChng {
  if (change.type === 'add') {
    const numeric = typeof value === 'number' ? value : Number(value)
    return { ...change, value: Number.isFinite(numeric) ? numeric : 0 }
  }
  if (change.type === 'toggle') {
    if (value === undefined) {
      const { value: _removed, ...toggle } = change
      void _removed
      return toggle
    }
    const enabled = typeof value === 'boolean'
      ? value
      : value === 'on' || value === 'true' || value === 1
    return { ...change, value: enabled }
  }
  return { ...change, value: value ?? '' }
}

function changeWithAction(
  change: RtChng,
  action: ConditionWriteAction,
  value: RuntimeValue | undefined,
): RtChng {
  if (action === 'add') {
    const numeric = typeof value === 'number' ? value : Number(value)
    return {
      type: 'add',
      path: change.path,
      value: Number.isFinite(numeric) ? numeric : 0,
      resonatorId: change.resonatorId,
    }
  }
  return {
    type: 'set',
    path: change.path,
    value: value ?? '',
    resonatorId: change.resonatorId,
  }
}

function writeEnabled<T extends { enabled?: boolean }>(node: T, disabled: boolean | undefined): T {
  if (disabled) {
    return { ...node, enabled: false }
  }
  return node.enabled === false ? { ...node, enabled: true } : node
}

function serializeNote(
  node: EditorNote,
  original?: RotationNode,
): RotationNoteNode {
  const source = node.sourceNode
    ?? (original?.type === 'note' ? original : undefined)
  const next: RotationNoteNode = source
    ? { ...source, id: node.id }
    : { id: node.id, type: 'note', text: node.text }

  if (!source || node.labelEdited) {
    if (node.label == null || node.label === '') {
      delete next.label
    } else {
      next.label = node.label
    }
  }
  if (!source || node.colorEdited) {
    if (node.color == null || node.color === '') {
      delete next.color
    } else {
      next.color = node.color
    }
  }
  if (!source || node.textEdited) {
    next.text = node.text
  }
  return next
}

function writeAttachedNote<T extends RotationNode>(
  node: T,
  editor: { attachedNote?: EditorNote; noteEdited?: boolean },
): T {
  if (node.type === 'note' || (node.type === 'loop' && node.kind === 'end')) {
    return node
  }
  const host = node as Exclude<RotationNode, RotationNoteNode | RotLoopEnd>

  const noteChanged = editor.noteEdited
    || editor.attachedNote?.labelEdited
    || editor.attachedNote?.colorEdited
    || editor.attachedNote?.textEdited
  if (!noteChanged && (host.note || !editor.attachedNote)) {
    return node
  }

  const next = { ...host }
  if (editor.attachedNote) {
    next.note = serializeNote(editor.attachedNote, host.note)
  } else {
    delete next.note
  }
  return next as T
}

/** Serialize one attached feature without inventing a second feature shape. */
function serializeAttachedFeature(
  node: EditorStep,
): Extract<RotationNode, { type: 'feature' }> | null {
  const source = node.sourceNode?.type === 'feature'
    ? stripFeatureAttachments(node.sourceNode)
    : null
  const base = source
    ? source
    : node.featureId
      ? {
        type: 'feature' as const,
        id: node.id,
        featureId: node.featureId,
        enabled: true,
      }
      : null

  if (!base) {
    return null
  }

  const next: Extract<RotationNode, { type: 'feature' }> = {
    ...base,
    id: node.id,
    featureId: node.featureId ?? base.featureId,
  }
  if (!source || node.ownerEdited) {
    next.resonatorId = node.memberId
  }
  if (!source || node.multiplierEdited) {
    next.multiplier = node.multiplier
  }

  return writeAttachedNote(writeEnabled(next, node.disabled), node)
}

function serializeStep(
  node: EditorStep,
  original: RotationNode | undefined,
): RotationNode | null {
  const source = node.sourceNode?.type === 'feature'
    ? node.sourceNode
    : original?.type === 'feature'
      ? original
      : null

  const base = source
    ? source
    : node.featureId
      ? {
        type: 'feature' as const,
        id: node.id,
        featureId: node.featureId,
        enabled: true,
      }
      : null

  if (!base) {
    return null
  }

  const nextNode: Extract<RotationNode, { type: 'feature' }> = {
    ...base,
    id: node.id,
    featureId: node.featureId ?? base.featureId,
  }
  if (!source || node.ownerEdited) {
    nextNode.resonatorId = node.memberId
  }
  if (!source || node.multiplierEdited) {
    nextNode.multiplier = node.multiplier
  }

  if (node.changesEdited || node.attachedEdited) {
    // Rebuild edited writes while preserving untouched attachment semantics.
    const normalizedBase = normalizeFeatureAttachments(base)
    delete nextNode.changes
    delete nextNode.attached
    const features = node.attachedEdited
      ? (node.attached ?? []).flatMap((child) => {
        const feature = serializeAttachedFeature(child)
        return feature ? [feature] : []
      })
      : normalizedBase.attached?.features ?? []
    const conditions = node.changesEdited
      ? (node.changes ?? []).map((change, index) => ({
        id: `${node.id}:attached:cond:${index}`,
        type: 'condition' as const,
        resonatorId: change.resonatorId ?? nextNode.resonatorId,
        enabled: true as const,
        changes: [change],
      }))
      : normalizedBase.attached?.conditions ?? []
    if (conditions.length > 0 || features.length > 0) {
      nextNode.attached = { conditions, features }
    } else {
      delete nextNode.attached
    }
  }

  if (!source || node.negSeriesEdited) {
    // series config always clears a fixed stack override, matching the pane
    delete nextNode.negativeEffectStacks
    const instances = Math.max(1, Math.floor(node.negativeEffectInstances ?? 1))
    const stable = Math.max(1, Math.floor(node.negativeEffectStableWidth ?? 1))
    if (instances > 1) {
      nextNode.negativeEffectInstances = instances
    } else {
      delete nextNode.negativeEffectInstances
    }
    if (stable > 1) {
      nextNode.negativeEffectStableWidth = stable
    } else {
      delete nextNode.negativeEffectStableWidth
    }
  }

  return writeAttachedNote(writeEnabled(nextNode, node.disabled), node)
}

function serializeCondition(
  node: EditorCondition,
  original: RotationNode | undefined,
): RotationNode | null {
  const firstChange = firstChangeFromCondition(node)
  const source = node.sourceNode?.type === 'condition'
    ? node.sourceNode
    : original?.type === 'condition'
      ? original
      : null
  const base = source
    ? source
    : firstChange
      ? {
        type: 'condition' as const,
        id: node.id,
        changes: [firstChange],
        enabled: true,
      }
      : null

  if (!base) {
    return null
  }

  const changes = [...base.changes]
  if ((!source || node.writeEdited) && firstChange && changes[0]) {
    changes[0] = firstChange
  } else if (!source && firstChange) {
    changes.push(firstChange)
  }

  const nextNode: Extract<RotationNode, { type: 'condition' }> = {
    ...base,
    id: node.id,
    changes,
  }
  if (!source) {
    nextNode.label = node.label
  }
  if (!source || node.ownerEdited) {
    nextNode.resonatorId = node.owner.kind === 'member' ? node.owner.memberId : base.resonatorId
  }

  return writeAttachedNote(writeEnabled(nextNode, node.disabled), node)
}



/*
  a handoff is a condition writing the active resonator, so it round trips the
  same way one does: its source stays untouched unless the page edited it. Only
  the active-resonator write is replaced because a condition may carry others.
*/
function serializeHandoff(
  node: EditorHandoff,
  original: RotationNode | undefined,
): Extract<RotationNode, { type: 'condition' }> {
  const source = node.sourceNode?.type === 'condition'
    ? node.sourceNode
    : original?.type === 'condition'
      ? original
      : null

  const base: Extract<RotationNode, { type: 'condition' }> = source ?? {
    type: 'condition',
    id: node.id,
    changes: [{ type: 'set', path: ACTIVE_RESONATOR_PATH, value: node.to }],
  }

  const toActive = (changes: RtChng[], memberId: string): RtChng[] =>
    changes.map((change) => (
      change.path === ACTIVE_RESONATOR_PATH
        ? { ...change, type: 'set' as const, value: memberId }
        : change
    ))

  const changes = !source || node.toEdited
    ? toActive(base.changes, node.to)
    : base.changes

  const next = { ...base, id: node.id, changes }

  return writeAttachedNote(writeEnabled(next, node.disabled), node)
}

function loopIdOf(node: EditorBlock): string {
  return node.loopId ?? node.id
}

function makeLoopStart(
  node: EditorBlock,
  original: RotationNode | undefined,
): RotLoopStart {
  const loopId = loopIdOf(node)
  const source = node.sourceNode?.type === 'loop' && node.sourceNode.kind === 'start'
    ? node.sourceNode
    : original?.type === 'loop' && original.kind === 'start'
      ? original
      : null
  const base = source
    ? source
    : createLoopStart({
      id: node.id,
      loopId,
    })

  const next: RotLoopStart = {
    ...base,
    id: node.id,
    loopId,
  }
  // Materialize editor defaults so every serialized marker is self-contained.
  if (!source || node.labelEdited || base.label == null) {
    next.label = node.label
  }
  if (!source || node.colorEdited || base.color == null) {
    next.color = node.color ?? ROT_LOOP_COLORS[0]
  }
  if (!source || node.valueEdited || base.runs == null) {
    next.runs = normLoopRuns(node.runs)
  }
  return writeAttachedNote(writeEnabled(next, node.disabled), node)
}

function makeLoopEnd(
  start: RotLoopStart,
  originals: OriginalIndex,
  sourceEnd?: RotLoopEnd,
): RotLoopEnd {
  const originalEnd = sourceEnd ?? originals.loopEndByLoopId.get(start.loopId)
  const end = originalEnd
    ? {
      ...originalEnd,
      loopId: start.loopId,
    }
    : createLoopEnd(start, { id: `${start.id}:end` })

  return writeEnabled(end, start.enabled === false)
}

function serializeLoop(
  node: EditorBlock,
  original: RotationNode | undefined,
  originals: OriginalIndex,
): RotationNode[] {
  // Check in the viewed pass so children land in passForks when they diverged.
  const checked = isCheckoutableLoop(node) ? checkinLoopBlock(node) : node
  const templateNodes = isCheckoutableLoop(checked)
    ? (checked.passTemplate ?? checked.children)
    : checked.children

  let start = makeLoopStart(checked, original)
  const children = serializeList(templateNodes, originals)

  if (isCheckoutableLoop(checked) && checked.passForks) {
    const passForks: NonNullable<RotLoopStart['passForks']> = {}
    for (const [run, body] of Object.entries(checked.passForks)) {
      passForks[String(run)] = serializeList(body, originals)
    }
    if (Object.keys(passForks).length > 0) {
      start = { ...start, passForks }
    }
  }

  // a loop written with no end runs on round to its own start, so it is
  // written the way it was authored rather than closed on the way out
  return node.noEnd
    ? [start, ...children]
    : [start, ...children, makeLoopEnd(start, originals, node.sourceEndNode)]
}

function serializeLoopWrapHead(
  node: EditorBlock,
  originals: OriginalIndex,
): RotationNode[] {
  const loopId = loopIdOf(node)
  const originalStart = originals.loopStartByLoopId.get(loopId)
  const start = makeLoopStart(
    {
      ...node,
      id: originalStart?.id ?? node.wrapOf ?? node.id,
    },
    originalStart,
  )

  const children = serializeList(node.children, originals)
  return node.noEnd
    ? children
    : [...children, makeLoopEnd(start, originals, node.sourceEndNode)]
}

function serializeLoopWrapTail(
  node: EditorBlock,
  original: RotationNode | undefined,
  originals: OriginalIndex,
): RotationNode[] {
  const start = makeLoopStart(node, original)

  return [start, ...serializeList(node.children, originals)]
}

function serializeLoopWrapMiddle(
  node: EditorBlock,
  originals: OriginalIndex,
): RotationNode[] {
  return serializeList(node.children, originals)
}

function serializeBlock(
  node: EditorBlock,
  original: RotationNode | undefined,
  originals: OriginalIndex,
): RotationNode[] {
  if (node.type === 'setup') {
    return serializeList(node.children, originals)
  }

  if (node.type === 'loop') {
    if (node.wrap === 'head') {
      return serializeLoopWrapHead(node, originals)
    }
    if (node.wrap === 'middle') {
      return serializeLoopWrapMiddle(node, originals)
    }
    if (node.wrap === 'tail') {
      return serializeLoopWrapTail(node, original, originals)
    }
    return serializeLoop(node, original, originals)
  }

  if (node.type === 'repeat') {
    const source = node.sourceNode?.type === 'repeat'
      ? node.sourceNode
      : original?.type === 'repeat'
        ? original
        : null
    // the pane's own repeat, so a repeat the page adds is the one it makes
    const base = source
      ? source
      : { ...makeBlockNode('repeat'), id: node.id, times: normLoopRuns(node.runs) }
    const setupBlock = node.children.find((child) => child.type === 'setup')
    const itemChildren = node.children.filter((child) => child.type !== 'setup')
    const nextNode: Extract<RotationNode, { type: 'repeat' }> = {
      ...base,
      id: node.id,
      items: serializeList(itemChildren, originals),
    }
    if (!source || node.labelEdited) {
      nextNode.label = node.label
    }
    if (!source || node.colorEdited) {
      nextNode.color = node.color
    }
    if (!source || node.ownerEdited) {
      nextNode.resonatorId = node.owner.kind === 'member' ? node.owner.memberId : base.resonatorId
    }
    if (!source || node.valueEdited) {
      nextNode.times = normLoopRuns(node.runs)
    }
    if (setupBlock && isEditorBlock(setupBlock) && setupBlock.children.length > 0) {
      nextNode.setup = serializeList(setupBlock.children, originals)
    }
    if (node.ratio !== undefined && (node.ratio !== 1 || nextNode.setup?.length)) {
      nextNode.ratio = node.ratio
    }
    return [writeAttachedNote(writeEnabled(nextNode, node.disabled), node)]
  }

  const setupBlock = node.children.find((child) => child.type === 'setup')
  const itemChildren = node.children.filter((child) => child.type !== 'setup')
  const source = node.sourceNode?.type === 'uptime'
    ? node.sourceNode
    : original?.type === 'uptime'
      ? original
      : null
  const base = source
    ? source
    : { ...makeBlockNode('uptime'), id: node.id, ratio: node.ratio ?? 1 }

  const nextNode: Extract<RotationNode, { type: 'uptime' }> = {
    ...base,
    id: node.id,
    items: serializeList(itemChildren, originals),
  }
  if (!source || node.labelEdited) {
    nextNode.label = node.label
  }
  if (!source || node.colorEdited) {
    nextNode.color = node.color
  }
  if (setupBlock && isEditorBlock(setupBlock)) {
    nextNode.setup = serializeList(
      setupBlock.children,
      originals,
    )
  }
  if (!source || node.ownerEdited) {
    nextNode.resonatorId = node.owner.kind === 'member' ? node.owner.memberId : base.resonatorId
  }
  if (!source || node.valueEdited) {
    nextNode.ratio = node.ratio ?? 1
  }

  return [writeAttachedNote(writeEnabled(nextNode, node.disabled), node)]
}

function serializeList(
  nodes: EditorNode[],
  originals: OriginalIndex,
): RotationNode[] {
  const out: RotationNode[] = []

  for (const node of nodes) {
    const original = originals.byId.get(node.id)
    if (node.type === 'note') {
      out.push(serializeNote(node, original))
      continue
    }
    if (node.type === 'step') {
      const step = serializeStep(node, original)
      if (step) out.push(step)
    } else if (node.type === 'condition') {
      const condition = serializeCondition(node, original)
      if (condition) out.push(condition)
    } else if (node.type === 'swap') {
      out.push(serializeHandoff(node, original))
    } else if (isEditorBlock(node)) {
      out.push(...serializeBlock(node, original, originals))
    }
  }

  return out
}

/**
 * Serialize a clipboard-sized editor fragment through the same authored-node
 * path as a complete section. This deliberately returns ordinary rotation
 * feature/condition/block nodes: the flat projection is a view, never a
 * second clipboard format.
 */
export function editorNodesToRotation(
  nodes: EditorNode[],
  originalItems: RotationNode[],
): RotationNode[] {
  return serializeList(nodes, indexOriginals(originalItems))
}

export function editorSectionsToRotation(
  sections: EditorSection[],
  originalItems: RotationNode[],
  options?: { checkedIn?: boolean },
): Array<{ id: string; title: string; meta: string; items: RotationNode[] }> {
  // Capture the currently checked-out pass into passForks before walking.
  const ready = options?.checkedIn ? sections : checkinAllLoopPasses(sections)
  const originals = indexOriginals(originalItems)
  return ready.map((section) => ({
    id: section.id,
    title: section.title,
    meta: section.meta,
    items: markEditorSection(
      serializeList(section.children, originals),
      section.id,
    ),
  }))
}
