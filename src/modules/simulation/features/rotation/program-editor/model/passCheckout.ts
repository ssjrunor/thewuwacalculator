/*
  Author: Runor Ewhro
  Description: Owns pass checkout behavior and state transitions for the model module.
*/

import type {
  EditorBlock,
  EditorNode,
  EditorSection,
  LoopRunSelections,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import { isEditorBlock } from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import { editorLoopId } from '@/modules/simulation/features/rotation/program-editor/model/executionScope.ts'
import {
  normLoopRuns,
} from '@/domain/gameData/rotationLoops.ts'
import { resolveInheritedPassBody } from '@/domain/gameData/loopPasses.ts'

export type EditorPassForks = Record<number, EditorNode[]>

/** Bounded (non-wrap) loops own a single body list that can be checked out. */
export function isCheckoutableLoop(block: EditorBlock): boolean {
  return block.type === 'loop'
    && block.wrap == null
    && (block.loopSegment == null || block.loopSegment === 'both')
}

/**
 * Deep-clone editor nodes while keeping ids (pass bodies are the same nodes
 * across storage, not paste copies).
 */
function cloneEditorList(nodes: readonly EditorNode[]): EditorNode[] {
  return structuredClone(nodes) as EditorNode[]
}

function cloneList(nodes: readonly EditorNode[]): EditorNode[] {
  return cloneEditorList(nodes)
}

/** Stable enough equality for COW compression of pass bodies. */
function editorBodiesEqual(
  left: readonly EditorNode[],
  right: readonly EditorNode[],
): boolean {
  return stableBody(left) === stableBody(right)
}

function stableBody(nodes: readonly EditorNode[]): string {
  return JSON.stringify(nodes.map(stableNode))
}

function stableNode(node: EditorNode): unknown {
  if (node.type === 'note') {
    return {
      type: 'note',
      label: node.label,
      color: node.color,
      text: node.text,
    }
  }
  if (node.type === 'step') {
    return {
      type: 'step',
      owner: node.owner,
      featureId: node.featureId,
      multiplier: node.multiplier,
      disabled: node.disabled ?? false,
      gate: node.gate,
      negativeEffectInstances: node.negativeEffectInstances,
      negativeEffectStableWidth: node.negativeEffectStableWidth,
      changes: node.changes,
      attached: node.attached?.map(stableNode),
      attachedNote: node.attachedNote ? stableNode(node.attachedNote) : undefined,
    }
  }
  if (node.type === 'condition') {
    return {
      type: 'condition',
      owner: node.owner,
      path: node.path,
      writeValue: node.writeValue,
      writeAction: node.writeAction,
      disabled: node.disabled ?? false,
      gate: node.gate,
      change: node.change,
      attachedNote: node.attachedNote ? stableNode(node.attachedNote) : undefined,
    }
  }
  if (node.type === 'swap') {
    return {
      type: 'swap',
      from: node.from,
      to: node.to,
      disabled: node.disabled ?? false,
      attachedNote: node.attachedNote ? stableNode(node.attachedNote) : undefined,
    }
  }
  // block
  return {
    type: node.type,
    runs: node.runs,
    ratio: node.ratio,
    disabled: node.disabled ?? false,
    gate: node.gate,
    label: node.label,
    color: node.color,
    attachedNote: node.attachedNote ? stableNode(node.attachedNote) : undefined,
    children: node.children.map(stableNode),
    passTemplate: node.passTemplate?.map(stableNode),
    passForks: node.passForks
      ? Object.fromEntries(
        Object.entries(node.passForks).map(([run, body]) => [run, body.map(stableNode)]),
      )
      : undefined,
  }
}

/**
 * Resolve the body for a run. A private fork wins; otherwise the run inherits
 * the nearest preceding fork, with the template as the initial body.
 */
export function resolveEditorPassBody(
  template: readonly EditorNode[],
  passForks: EditorPassForks | undefined,
  run: number,
): EditorNode[] {
  return resolveInheritedPassBody(template, passForks, run) as EditorNode[]
}

export function mapLoopPassBodies(
  block: EditorBlock,
  mapper: (body: EditorNode[], run: number) => EditorNode[],
): EditorBlock {
  if (!isCheckoutableLoop(block)) return block
  const checked = checkinLoopBlock(block)
  const template = checked.passTemplate ?? checked.children
  const runs = normLoopRuns(checked.runs)
  const bodies: EditorNode[][] = []
  let changed = false

  for (let run = 1; run <= runs; run += 1) {
    const original = resolveEditorPassBody(template, checked.passForks, run)
    const mapped = mapper(cloneList(original), run)
    bodies.push(mapped)
    changed ||= !editorBodiesEqual(original, mapped)
  }
  if (!changed) return checked

  const passForks: EditorPassForks = {}
  let inherited: readonly EditorNode[] = template
  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index]!
    if (!editorBodiesEqual(inherited, body)) {
      passForks[index + 1] = cloneList(body)
    }
    inherited = body
  }

  const checkedOutRun = Math.min(
    Math.max(1, Math.floor(checked.checkedOutRun ?? 1)),
    runs,
  )
  const children = cloneList(bodies[checkedOutRun - 1] ?? template)
  return {
    ...checked,
    children,
    nodeCount: children.length,
    passTemplate: checked.passTemplate ?? cloneList(template),
    passForks: Object.keys(passForks).length > 0 ? passForks : undefined,
    checkedOutRun,
  }
}

function forksWithoutRun(
  forks: EditorPassForks | undefined,
  run: number,
): EditorPassForks {
  if (!forks || forks[run] == null) {
    return forks ?? {}
  }
  const next = { ...forks }
  delete next[run]
  return next
}

function sameForkMap(
  left: EditorPassForks | undefined,
  right: EditorPassForks | undefined,
): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return !left && !right
  }
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  return leftKeys.every((key) => left[Number(key)] === right[Number(key)])
}

/** Seed template + checkout state the first time a loop is seen. */
function ensureLoopPassSeed(block: EditorBlock): EditorBlock {
  if (!isCheckoutableLoop(block)) {
    return block
  }
  if (block.passTemplate && block.checkedOutRun != null) {
    return block
  }
  return {
    ...block,
    passTemplate: block.passTemplate ?? cloneList(block.children),
    checkedOutRun: block.checkedOutRun ?? 1,
    nodeCount: block.children.length,
  }
}

/**
 * Persist the currently checked-out body into passForks when it has diverged
 * from the inherited resolve chain.
 */
export function checkinLoopBlock(block: EditorBlock): EditorBlock {
  if (!isCheckoutableLoop(block)) {
    return block
  }
  const seeded = ensureLoopPassSeed(block)
  const run = Math.max(1, Math.floor(seeded.checkedOutRun ?? 1))
  const template = seeded.passTemplate ?? seeded.children
  const withoutSelf = forksWithoutRun(seeded.passForks, run)
  const inherited = resolveEditorPassBody(template, withoutSelf, run)
  const forks: EditorPassForks = { ...withoutSelf }

  if (seeded.children !== inherited && !editorBodiesEqual(seeded.children, inherited)) {
    forks[run] = cloneList(seeded.children)
  }

  const nextForks = Object.keys(forks).length > 0 ? forks : undefined
  if (
    seeded.passTemplate
    && seeded.checkedOutRun === run
    && seeded.nodeCount === seeded.children.length
    && sameForkMap(seeded.passForks, nextForks)
  ) {
    return seeded
  }

  return {
    ...seeded,
    passTemplate: seeded.passTemplate ?? cloneList(template),
    passForks: nextForks,
    checkedOutRun: run,
    nodeCount: seeded.children.length,
  }
}

/** Replace `children` with a clone of the resolved body for `run`. */
export function checkoutLoopBlock(block: EditorBlock, run: number): EditorBlock {
  if (!isCheckoutableLoop(block)) {
    return block
  }
  const checkedIn = checkinLoopBlock(block)
  const target = Math.min(
    Math.max(1, Math.floor(run)),
    normLoopRuns(checkedIn.runs),
  )
  if (checkedIn.checkedOutRun === target) {
    return checkedIn
  }
  const template = checkedIn.passTemplate ?? checkedIn.children
  const body = resolveEditorPassBody(template, checkedIn.passForks, target)
  const children = cloneList(body)
  return {
    ...checkedIn,
    children,
    checkedOutRun: target,
    nodeCount: children.length,
  }
}

/**
 * Change a bounded loop's run count without retaining bodies for runs that
 * no longer exist. If the checked-out run is removed, the new last run is
 * resolved from the surviving inheritance chain.
 */
export function resizeLoopBlockRuns(block: EditorBlock, value: number): EditorBlock {
  const runs = normLoopRuns(value)
  if (!isCheckoutableLoop(block)) {
    return block.runs === runs ? block : { ...block, runs }
  }

  const checkedIn = checkinLoopBlock(block)
  const survivingEntries = Object.entries(checkedIn.passForks ?? {})
    .filter(([run]) => Number(run) <= runs)
  const passForks = survivingEntries.length > 0
    ? Object.fromEntries(survivingEntries) as EditorPassForks
    : undefined
  const checkedOutRun = Math.min(checkedIn.checkedOutRun ?? 1, runs)
  const stayedOnRun = checkedOutRun === checkedIn.checkedOutRun
  const template = checkedIn.passTemplate ?? checkedIn.children
  const children = stayedOnRun
    ? checkedIn.children
    : cloneList(resolveEditorPassBody(template, passForks, checkedOutRun))

  return {
    ...checkedIn,
    runs,
    passForks,
    children,
    checkedOutRun,
    nodeCount: children.length,
  }
}

function mapCheckoutableLoops(
  sections: EditorSection[],
  fn: (block: EditorBlock) => EditorBlock,
): EditorSection[] {
  const visit = (nodes: EditorNode[]): EditorNode[] => {
    let changed = false
    const next = nodes.map((node) => {
      if (!isEditorBlock(node)) {
        return node
      }
      let current = node
      if (isCheckoutableLoop(current)) {
        const updated = fn(current)
        if (updated !== current) {
          changed = true
          current = updated
        }
      }
      const children = visit(current.children)
      if (children !== current.children) {
        changed = true
        return { ...current, children, nodeCount: children.length }
      }
      return current
    })
    return changed ? next : nodes
  }

  let changed = false
  const next = sections.map((section) => {
    const children = visit(section.children)
    if (children !== section.children) {
      changed = true
      return { ...section, children }
    }
    return section
  })
  return changed ? next : sections
}

/** Check in every checkoutable loop (before serialize or bulk switch). */
export function checkinAllLoopPasses(sections: EditorSection[]): EditorSection[] {
  return mapCheckoutableLoops(sections, checkinLoopBlock)
}

/**
 * Ensure a loop is seeded, then apply an immutable update to its checked-out
 * `children` only, then check in so the pass is forked. Never touches
 * `passTemplate` except to create it from the pre-edit body on first seed.
 */
export function updateCheckedOutLoopChildren(
  sections: EditorSection[],
  loopId: string,
  update: (children: EditorNode[]) => EditorNode[],
): EditorSection[] {
  return mapCheckoutableLoops(sections, (block) => {
    if (editorLoopId(block) !== loopId) {
      return block
    }
    const seeded = ensureLoopPassSeed(block)
    // Seed template from the pre-edit body before mutating children.
    const template = seeded.passTemplate ?? cloneList(seeded.children)
    const children = update(seeded.children)
    if (children === seeded.children) {
      return seeded.passTemplate ? seeded : { ...seeded, passTemplate: template }
    }
    return checkinLoopBlock({
      ...seeded,
      passTemplate: template,
      children,
      nodeCount: children.length,
    })
  })
}

function removeIdDeep(nodes: EditorNode[], nodeId: string): EditorNode[] {
  let changed = false
  const next = nodes.flatMap<EditorNode>((node): EditorNode[] => {
    if (node.id === nodeId) {
      changed = true
      return []
    }
    if (!isEditorBlock(node)) {
      return [node]
    }
    const children = removeIdDeep(node.children, nodeId)
    if (children === node.children) {
      return [node]
    }
    changed = true
    return [{ ...node, children, nodeCount: children.length }]
  })
  return changed ? next : nodes
}

/** Remove a node from the currently checked-out pass of its enclosing loop. */
export function removeFromCheckedOutPass(
  sections: EditorSection[],
  loopId: string,
  nodeId: string,
): EditorSection[] {
  return updateCheckedOutLoopChildren(sections, loopId, (children) =>
    removeIdDeep(children, nodeId))
}

/**
 * Check in current passes, then check out each loop to the selected run
 * (default 1). Nested loops use their own selection keys.
 */
export function checkoutAllLoopPasses(
  sections: EditorSection[],
  selections: LoopRunSelections,
): EditorSection[] {
  const checkedIn = checkinAllLoopPasses(sections)
  return mapCheckoutableLoops(checkedIn, (block) => {
    const loopId = editorLoopId(block)
    const run = Math.max(1, Math.floor(selections[loopId] ?? 1))
    return checkoutLoopBlock(block, run)
  })
}

/** Switch one loop to another run, leaving other loops alone. */
export function checkoutLoopPassById(
  sections: EditorSection[],
  loopId: string,
  run: number,
): EditorSection[] {
  return mapCheckoutableLoops(sections, (block) => {
    if (editorLoopId(block) !== loopId) {
      return block
    }
    return checkoutLoopBlock(block, run)
  })
}

/**
 * After engine projection, seed every bounded loop with a template and
 * optional forks (already as editor nodes), checked out to run 1 or selection.
 */
export function seedLoopPassState(
  block: EditorBlock,
  options: {
    passForks?: EditorPassForks
    checkoutRun?: number
  } = {},
): EditorBlock {
  if (!isCheckoutableLoop(block)) {
    return block
  }
  const passTemplate = cloneList(block.children)
  const passForks = options.passForks
    ? Object.fromEntries(
      Object.entries(options.passForks).map(([run, body]) => [
        Number(run),
        cloneList(body),
      ]),
    )
    : undefined
  const checkoutRun = Math.max(1, Math.floor(options.checkoutRun ?? 1))
  const body = resolveEditorPassBody(passTemplate, passForks, checkoutRun)
  const children = cloneList(body)
  return {
    ...block,
    passTemplate,
    passForks: passForks && Object.keys(passForks).length > 0 ? passForks : undefined,
    children,
    checkedOutRun: checkoutRun,
    nodeCount: children.length,
  }
}
