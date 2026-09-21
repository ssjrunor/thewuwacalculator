/*
  Author: Runor Ewhro
  Description: Classifies inert or unreachable rotation nodes from execution
               evidence and applies cleanup through canonical tree operations.
*/

import type {
  EditorNode,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import type { DataSrcRef } from '@/domain/gameData/contracts.ts'
import { makeSourceKey } from '@/data/gameData/registry.ts'
import { isEditorBlock } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import {
  isCheckoutableLoop,
  mapLoopPassBodies,
  resolveEditorPassBody,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/passCheckout.ts'
import { editorLoopId } from '@/modules/simulation/surfaces/rotation/program-editor/model/executionScope.ts'
import { normLoopRuns } from '@/domain/gameData/rotationLoops.ts'
import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'

export type CleanupReason =
  /** ran, and wrote only what the state already held */
  | 'inert'
  /** the run never reached it, or could not resolve what it names */
  | 'dead'

export interface CleanupTarget {
  readonly id: string
  readonly reason: CleanupReason
  /** One logical pass body, when only that execution was inert/dead. */
  readonly loopId?: string
  readonly run?: number
}

export interface CleanupPlan {
  /** in tree order, so a caller can report the sweep the way it reads */
  readonly targets: readonly CleanupTarget[]
}

export interface CleanupSourceContext {
  /** Sources currently represented by the live team/build and enemy. */
  readonly availableSources: ReadonlySet<string>
}

const EMPTY_PLAN: CleanupPlan = Object.freeze({
  targets: Object.freeze([]) as readonly CleanupTarget[],
})

export interface CleanupCounts {
  readonly inert: number
  readonly dead: number
  readonly total: number
}

export function cleanupCounts(plan: CleanupPlan): CleanupCounts {
  let inert = 0
  let dead = 0
  for (const target of plan.targets) {
    if (target.reason === 'inert') inert += 1
    else dead += 1
  }
  return { inert, dead, total: plan.targets.length }
}

/**
 * Containers are never cleanup candidates. Empty containers are valid authored
 * placeholders even when the last execution produced no evidence for them.
 */
function targetFor(node: EditorNode): CleanupReason | null {
  if (node.type === 'note' || isEditorBlock(node)) return null
  if (node.gate?.kind === 'dead') return 'dead'
  if (node.gate?.kind === 'inert') return 'inert'
  return null
}

function sourcesFor(node: EditorNode): DataSrcRef[] {
  const sources: DataSrcRef[] = []
  const sourceResonatorId = node.sourceNode && 'resonatorId' in node.sourceNode
    ? node.sourceNode.resonatorId
    : undefined
  if (node.type === 'condition') {
    if (node.state?.source) sources.push(node.state.source)
    if (node.change?.resonatorId) {
      sources.push({ type: 'resonator', id: node.change.resonatorId })
    }
    if (sourceResonatorId) {
      sources.push({ type: 'resonator', id: sourceResonatorId })
    }
  } else if (node.type === 'step') {
    sources.push(node.owner.kind === 'member'
      ? { type: 'resonator', id: node.owner.memberId }
      : { type: 'echo', id: node.owner.echoId })
    if (sourceResonatorId) {
      sources.push({ type: 'resonator', id: sourceResonatorId })
    }
  } else if (node.type === 'swap') {
    if (sourceResonatorId) {
      sources.push({ type: 'resonator', id: sourceResonatorId })
    }
    const authoredTarget = node.sourceNode?.changes.find(
      (change) => change.path === ACTIVE_RESONATOR_PATH,
    )?.value
    const targetId = typeof authoredTarget === 'string' ? authoredTarget : node.to
    if (targetId) {
      sources.push({ type: 'resonator', id: targetId })
    }
  }
  return sources
}

export function planRotationCleanup(
  sections: readonly EditorSection[],
  context?: CleanupSourceContext,
): CleanupPlan {
  const targets: CleanupTarget[] = []
  const targetKeys = new Set<string>()
  const globalTargetIds = new Set<string>()

  const addTarget = (target: CleanupTarget): void => {
    if (globalTargetIds.has(target.id)) return
    const scoped = target.loopId != null && target.run != null
    if (!scoped) {
      globalTargetIds.add(target.id)
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        if (targets[index]?.id === target.id) targets.splice(index, 1)
      }
    }
    const key = scoped ? `${target.id}\u0000${target.loopId}\u0000${target.run}` : target.id
    if (targetKeys.has(key)) return
    targetKeys.add(key)
    targets.push(target)
  }

  const visit = (
    nodes: readonly EditorNode[],
    inheritedDisabled: boolean,
    pass?: { loopId: string; run: number },
  ): void => {
    for (const node of nodes) {
      const ownDisabled = 'disabled' in node && Boolean(node.disabled)
      const disabled = inheritedDisabled || ownDisabled

      if (isEditorBlock(node)) {
        const childDisabled = node.type === 'loop' ? inheritedDisabled : disabled
        if (isCheckoutableLoop(node)) {
          const template = node.passTemplate ?? node.children
          const loopId = editorLoopId(node)
          for (let run = 1; run <= normLoopRuns(node.runs); run += 1) {
            visit(
              resolveEditorPassBody(template, node.passForks, run),
              childDisabled,
              { loopId, run },
            )
          }
        } else {
          visit(node.children, childDisabled, pass)
        }
        continue
      }

      if (node.type === 'step' && node.attached) {
        visit(node.attached, disabled, pass)
      }
      if (disabled) continue

      const sourceMissing = Boolean(
        context
        && sourcesFor(node).some((source) => (
          !context.availableSources.has(makeSourceKey(source))
        )),
      )
      let reason = sourceMissing ? 'dead' : targetFor(node)
      let scoped = false
      if (
        !sourceMissing
        && pass
        && (node.type === 'condition' || node.type === 'swap')
      ) {
        const passGate = node.gateByRun?.[pass.run]
        reason = passGate?.kind
          ?? (node.gate?.kind === 'dead' ? 'dead' : null)
        scoped = reason != null
      }
      if (!reason) continue
      addTarget(scoped
        ? { id: node.id, reason, loopId: pass!.loopId, run: pass!.run }
        : { id: node.id, reason })
    }
  }

  for (const section of sections) {
    visit(section.children, false)
  }

  if (targets.length === 0) return EMPTY_PLAN
  return Object.freeze({
    targets: Object.freeze(targets.map((target) => Object.freeze(target))),
  })
}

type ScopedCleanupTargets = ReadonlyMap<string, ReadonlyMap<number, ReadonlySet<string>>>

function scopedTargets(plan: CleanupPlan): ScopedCleanupTargets {
  const mutable = new Map<string, Map<number, Set<string>>>()
  for (const target of plan.targets) {
    if (target.loopId == null || target.run == null) continue
    let byRun = mutable.get(target.loopId)
    if (!byRun) {
      byRun = new Map()
      mutable.set(target.loopId, byRun)
    }
    let ids = byRun.get(target.run)
    if (!ids) {
      ids = new Set()
      byRun.set(target.run, ids)
    }
    ids.add(target.id)
  }
  return mutable
}

function applyScopedCleanup(
  nodes: readonly EditorNode[],
  targets: ScopedCleanupTargets,
): readonly EditorNode[] {
  let changed = false
  const next = nodes.map((node) => {
    if (!isEditorBlock(node)) return node
    if (isCheckoutableLoop(node)) {
      const loopTargets = targets.get(editorLoopId(node))
      const mapped = mapLoopPassBodies(node, (body, run) => {
        let passBody = applyScopedCleanup(body, targets)
        const ids = loopTargets?.get(run)
        if (ids && ids.size > 0) passBody = removeFromNodes(passBody, ids)
        return passBody === body ? body : [...passBody]
      })
      changed ||= mapped !== node
      return mapped
    }
    const children = applyScopedCleanup(node.children, targets)
    if (children === node.children) return node
    changed = true
    return { ...node, children: [...children], nodeCount: children.length }
  })
  return changed ? next : nodes
}

function removeAttached(
  children: readonly EditorStep[],
  ids: ReadonlySet<string>,
): readonly EditorStep[] {
  let changed = false
  const next: EditorStep[] = []

  for (const child of children) {
    if (ids.has(child.id)) {
      changed = true
      continue
    }

    if (!child.attached) {
      next.push(child)
      continue
    }

    const attached = removeAttached(child.attached, ids)
    if (attached === child.attached) {
      next.push(child)
    } else {
      changed = true
      next.push({ ...child, attached: [...attached], attachedEdited: true })
    }
  }

  return changed ? next : children
}

function removeFromNodes(
  nodes: readonly EditorNode[],
  ids: ReadonlySet<string>,
): readonly EditorNode[] {
  let changed = false
  const next: EditorNode[] = []

  for (const node of nodes) {
    if (ids.has(node.id)) {
      changed = true
      continue
    }

    let current = node
    if (node.type === 'step' && node.attached) {
      const attached = removeAttached(node.attached, ids)
      if (attached !== node.attached) {
        current = { ...node, attached: [...attached], attachedEdited: true }
        changed = true
      }
    }

    if (isEditorBlock(node)) {
      const children = removeFromNodes(node.children, ids)
      const passTemplate = node.passTemplate
        ? removeFromNodes(node.passTemplate, ids)
        : undefined
      let passForks = node.passForks
      if (node.passForks) {
        let forksChanged = false
        const nextForks: Record<number, EditorNode[]> = {}
        for (const [run, body] of Object.entries(node.passForks)) {
          const nextBody = removeFromNodes(body, ids)
          nextForks[Number(run)] = nextBody === body ? body : [...nextBody]
          forksChanged ||= nextBody !== body
        }
        if (forksChanged) passForks = nextForks
      }
      const bodyChanged = children !== node.children
        || passTemplate !== node.passTemplate
        || passForks !== node.passForks
      if (bodyChanged) {
        current = {
          ...node,
          children: [...children],
          nodeCount: children.length,
          ...(passTemplate ? { passTemplate: [...passTemplate] } : {}),
          ...(passForks ? { passForks } : {}),
        }
        changed = true
      }
    }

    next.push(current)
  }

  return changed ? next : nodes
}

/** Removing a swept row is the same edit as deleting it by hand, including
 * copies held by loop pass storage and attached feature rows. */
export function applyRotationCleanup(
  sections: EditorSection[],
  plan: CleanupPlan,
): EditorSection[] {
  if (plan.targets.length === 0) return sections
  const ids = new Set(plan.targets.flatMap((target) => (
    target.loopId == null || target.run == null ? [target.id] : []
  )))
  const perPass = scopedTargets(plan)
  let changed = false
  const next = sections.map((section) => {
    const scoped = perPass.size > 0
      ? applyScopedCleanup(section.children, perPass)
      : section.children
    const children = ids.size > 0 ? removeFromNodes(scoped, ids) : scoped
    if (children === section.children) return section
    changed = true
    return { ...section, children: [...children] }
  })
  return changed ? next : sections
}

/** One phrasing of a plan, so the prompt and the toast never disagree. */
export function describeRotationCleanup(plan: CleanupPlan): string {
  const { inert, dead } = cleanupCounts(plan)
  const rows = (count: number) => `${count} ${count === 1 ? 'node' : 'nodes'}`

  if (inert > 0 && dead > 0) {
    return `${rows(inert)} that didn't actually change, and ${rows(dead)} the last run never used.`
  }
  if (inert > 0) {
    return `${rows(inert)} that didn't actually change.`
  }
  return `${rows(dead)} the last run never used.`
}
