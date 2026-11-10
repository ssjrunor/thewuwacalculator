/*
  Author: Runor Ewhro
  description: plans and applies rotation cleanup for editor and generated rotations.
               the plan marks inert, dead, redundant and reorderable rows from
               the last execution; applying it edits the tree the same way a
               manual delete or move would.
*/

import type { DataSrcRef, RotationNode, RtChng, RuntimeValue, SourceState } from '@/domain/gameData/contracts.ts'
import { makeSourceKey } from '@/data/gameData/registry.ts'
import { resolveInheritedPassBody } from '@/domain/gameData/loopPasses.ts'
import { normLoopRuns } from '@/domain/gameData/rotationLoops.ts'
import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'

/** the execution fields the cleanup reads. callers keep their own display fields on the node. */
interface CleanupBase {
  id: string
  sourceNode?: RotationNode
  disabled?: boolean
  gate?: { kind: 'inert' | 'dead' }
  attachedNote?: { id: string }
}
export interface CleanupCondition extends CleanupBase {
  type: 'condition'
  owner: { kind: string; memberId?: string }
  state?: Partial<Pick<SourceState, 'source' | 'maxWhen' | 'optionsWhen'>>
  change?: RtChng
  writeEdited?: boolean
  gateByRun?: Record<number, { kind: 'inert' | 'dead' }>
  prior?: { value: RuntimeValue }
  priorByRun?: Record<number, { value: RuntimeValue }>
}
export interface CleanupStep extends CleanupBase {
  type: 'step'
  owner: { kind: 'member'; memberId: string } | { kind: 'echo'; echoId: string }
  memberId: string
  changes?: RtChng[]
  attached?: CleanupStep[]
  changesEdited?: boolean
  attachedEdited?: boolean
  attachedChangesByRun?: unknown
  writesByRun?: unknown
  pendingWrites?: unknown
}
export interface CleanupBlock extends CleanupBase {
  type: 'loop' | 'repeat' | 'uptime' | 'setup'
  loopId?: string
  wrap?: 'head' | 'middle' | 'tail'
  loopSegment?: 'both' | 'start' | 'middle' | 'end'
  runs: number
  children: CleanupNode[]
  nodeCount: number
  passTemplate?: CleanupNode[]
  passForks?: Record<number, CleanupNode[]>
  checkedOutRun?: number
}
export type CleanupNode = CleanupCondition | CleanupStep | CleanupBlock
  | (CleanupBase & { type: 'note' })
  | (CleanupBase & { type: 'swap'; to: string; gateByRun?: Record<number, { kind: 'inert' | 'dead' }>;
      sourceNode?: Extract<RotationNode, { type: 'condition' }> })
export interface CleanupSection {
  children: CleanupNode[]
}

// container rows: their children are visited, the container itself is never a target
function isCleanupBlock(node: CleanupNode): node is CleanupBlock {
  return node.type === 'loop' || node.type === 'repeat' || node.type === 'uptime' || node.type === 'setup'
}
// plain loops store one body per run (template plus forks); wrapped or split loops do not
function isCheckoutableLoop(block: CleanupBlock): boolean {
  return block.type === 'loop' && block.wrap == null && (block.loopSegment == null || block.loopSegment === 'both')
}
// authored loop id, or the block id for loops saved before loop ids existed
function blockLoopId(block: CleanupBlock): string {
  return block.loopId ?? block.id
}
// the body a given run executes: its fork when present, otherwise the nearest earlier body
function resolvePassBody(template: readonly CleanupNode[], forks: CleanupBlock['passForks'], run: number): readonly CleanupNode[] {
  return resolveInheritedPassBody(template, forks, run)
}

export type CleanupReason =
  /** ran, and wrote only values the state already stored */
  | 'inert'
  /** the run never reached it, or could not resolve what it names */
  | 'dead'
  /** attached setters that repeat the persistent setters right before the skill */
  | 'redundant'
  /**
   * a persistent setter moved past neighbouring skills whose attached setters
   * only undo or pre-empt it. the move drops those attached copies.
   */
  | 'reordered'

export interface CleanupTarget {
  readonly id: string
  readonly reason: CleanupReason
  /** one logical pass body, when only that execution was inert/dead. */
  readonly loopId?: string
  readonly run?: number
  /** these persistent setters already precede the feature. */
  readonly precedingConditionIds?: readonly string[]
  /** a reordered condition lands directly after this sibling. */
  readonly moveAfterId?: string
  /** a reordered condition lands directly before this sibling. */
  readonly moveBeforeId?: string
  /** skills whose attached write to the reordered condition's state is dropped. */
  readonly detachFromIds?: readonly string[]
}

export interface CleanupPlan {
  /** in tree order, so a caller can report the sweep the way it reads */
  readonly targets: readonly CleanupTarget[]
}

export interface CleanupSourceContext {
  /** sources currently represented by the live team/build and enemy. */
  readonly availableSources?: ReadonlySet<string>
  /** write keys (owner, NUL, control path) whose recipient can change under local activation. the cleanup skips them. */
  readonly recipientSensitivePaths?: ReadonlySet<string>
}

const EMPTY_PLAN: CleanupPlan = Object.freeze({
  targets: Object.freeze([]) as readonly CleanupTarget[],
})

export interface CleanupCounts {
  readonly inert: number
  readonly dead: number
  readonly redundant: number
  readonly reordered: number
  /** attached setters dropped by reordered conditions */
  readonly detached: number
  readonly total: number
}

// count plan targets by reason; reordered targets also add the attached copies they drop
export function cleanupCounts(plan: CleanupPlan): CleanupCounts {
  let inert = 0
  let dead = 0
  let redundant = 0
  let reordered = 0
  let detached = 0
  for (const target of plan.targets) {
    if (target.reason === 'inert') inert += 1
    else if (target.reason === 'dead') dead += 1
    else if (target.reason === 'reordered') {
      reordered += 1
      detached += target.detachFromIds?.length ?? 0
    } else redundant += 1
  }
  return { inert, dead, redundant, reordered, detached, total: plan.targets.length }
}

// two plain sets that write the same value to the same path and resonator
function sameSetter(left: RtChng, right: RtChng): boolean {
  return left.type === 'set' && right.type === 'set'
    && left.path === right.path
    && left.resonatorId === right.resonatorId
    && Object.is(left.value, right.value)
}

/**
 * a complete, consecutive set of plain persistent setters right before the
 * feature that already write everything it attaches, so the attached copies
 * apply nothing new. setters repeated right after a feature are handled by
 * reordering, which also covers runs of several skills.
 */
function precedingDuplicateSetters(
  nodes: readonly CleanupNode[],
  index: number,
): readonly string[] | null {
  const step = nodes[index]
  if (step?.type !== 'step' || step.disabled || step.gate?.kind === 'dead') return null
  const source = step.sourceNode
  if (source?.type !== 'feature' || source.enabled === false) return null
  const attached = source.attached?.conditions ?? []
  if (source.changes?.length || attached.length === 0 || attached.length !== step.changes?.length) {
    return null
  }
  if (attached.some((node) => node.enabled === false || node.note || node.label || node.changes.length !== 1)) {
    return null
  }
  const changes = step.changes ?? []
  if (changes.some((change) => change.type !== 'set')) return null
  if (index < changes.length) return null
  const nearby = nodes.slice(index - changes.length, index)
  if (nearby.length !== changes.length) return null
  const unmatched = [...changes]
  for (const node of nearby) {
    if (node.type !== 'condition' || node.disabled || node.attachedNote
      || node.gate?.kind === 'dead' || node.sourceNode?.type !== 'condition'
      || node.sourceNode.changes.length !== 1 || dependentWrite(node)) return null
    const write = node.change ?? node.sourceNode.changes[0]
    if (!write) return null
    const match = unmatched.findIndex((change) => sameSetter(change, write))
    if (match < 0) return null
    unmatched.splice(match, 1)
  }
  return unmatched.length === 0 ? nearby.map((node) => node.id) : null
}

/*
  reordering. an attached setter applies only while its skill runs, then its
  write is discarded. a persistent setter C and the skills next to it that
  attach the same state can trade places without changing what any row reads:

  - forward: C, F1[att p], F2[att p] where p is what the state held before C.
    the skills only attach p to hide C's write from themselves. with C moved
    after F2 they read p directly, and C still writes its value afterward.
  - backward: F1[att v], F2[att v], C(v). the skills only attach v to see C's
    write early. moving C before F1 gives them v directly.

  other independent absolute setters can be hopped. stack writes with dynamic
  bounds and routing writes stop the run even when their path differs: a
  control may change the cap used by the following stack write.
*/

/** the state a write lands on, with the owner the engine would resolve. */
function writeKey(change: RtChng, owner: string | undefined): string {
  return `${change.resonatorId ?? owner ?? ''}\u0000${change.path}`
}

// the resonator a condition writes to: the authored resonator first, then the member that owns the row
function conditionOwner(node: CleanupCondition): string | undefined {
  const source = node.sourceNode
  if (source?.type === 'condition' && source.resonatorId) return source.resonatorId
  return node.owner.kind === 'member' ? node.owner.memberId : undefined
}

// authored writes when the source node is present, otherwise the single resolved change
function conditionWrites(node: CleanupCondition): readonly RtChng[] {
  return node.sourceNode?.type === 'condition' ? node.sourceNode.changes : node.change ? [node.change] : []
}

/*
  writes whose effect depends on other state: conditional caps or options, the
  active resonator, enemy, team effect, routing and combat paths. these never
  move, never count as a duplicate, and stop a reorder run.
*/
function dependentWrite(node: CleanupCondition): boolean {
  return Boolean(node.state?.maxWhen?.length || node.state?.optionsWhen?.length || conditionWrites(node).some(change =>
    change.path === ACTIVE_RESONATOR_PATH || change.path.startsWith('enemy.') ||
    change.path.startsWith('teamEffects.') || change.path.startsWith('routing.') ||
    change.path.startsWith('runtime.rotation.') || change.path.startsWith('runtime.state.combat.')))
}

/** a persistent setter the sweep may move: one plain set it has really run. */
function movableSetter(node: CleanupNode): { key: string; change: RtChng } | null {
  if (node.type !== 'condition' || node.disabled || node.gate?.kind === 'dead') return null
  if (node.sourceNode?.type !== 'condition' || node.sourceNode.enabled === false) return null
  if (dependentWrite(node)) return null
  if (node.writeEdited || node.sourceNode.changes.length !== 1) return null
  const change = node.change ?? node.sourceNode.changes[0]
  if (!change || change.type !== 'set') return null
  return { key: writeKey(change, conditionOwner(node)), change }
}

/**
 * the value a skill attaches to `key`, when the skill's attachments are plain
 * enough to drop one of them through the canonical rewrite. undefined means
 * the skill does not attach the state at all, null that it cannot be edited.
 */
function attachedValue(
  node: CleanupNode,
  key: string,
): { value: RtChng['value'] } | undefined | null {
  if (node.type !== 'step' || node.disabled || node.gate?.kind === 'dead') return null
  const source = node.sourceNode
  if (source?.type !== 'feature' || source.enabled === false) return null
  if (typeof source.negativeEffectStacks === 'number') return null
  const changes = node.changes ?? []
  const attached = source.attached?.conditions ?? []
  if (source.changes?.length || attached.length !== changes.length) return null
  if (attached.some((condition) => (
    condition.type !== 'condition' || condition.enabled === false || condition.note
    || condition.label || condition.changes.length !== 1
  ))) return null
  const owner = node.memberId
  const matching = changes.filter((change) => writeKey(change, owner) === key)
  if (matching.length === 0) return undefined
  const [only] = matching
  if (matching.length > 1 || only?.type !== 'set') return null
  return { value: only.value }
}

/**
 * whether a reorder can pass this row. notes and disabled rows pass; a
 * condition passes only with independent plain sets to other states.
 */
function canHop(node: CleanupNode, key: string): boolean {
  if (node.type === 'note') return true
  if (node.type !== 'condition') return false
  if (node.disabled) return true
  if (dependentWrite(node)) return false
  return conditionWrites(node).every(change => change.type === 'set' && writeKey(change, conditionOwner(node)) !== key)
}

/**
 * the skills a setter at `index` can move past in one direction, nearest
 * first, each attaching exactly `value` to `key`.
 */
function reorderRun(
  nodes: readonly CleanupNode[],
  index: number,
  direction: 1 | -1,
  key: string,
  value: RtChng['value'],
  blocked: (node: CleanupNode) => boolean,
): string[] {
  const run: string[] = []
  for (let at = index + direction; at >= 0 && at < nodes.length; at += direction) {
    const node = nodes[at]!
    if (node.type === 'step') {
      if (blocked(node)) break
      const attached = attachedValue(node, key)
      if (!attached || !Object.is(attached.value, value)) break
      run.push(node.id)
      continue
    }
    if (blocked(node) || !canHop(node, key)) break
  }
  return run
}

/**
 * containers are never cleanup candidates. empty containers are valid authored
 * placeholders even when the last execution produced no evidence for them.
 */
function targetFor(node: CleanupNode): CleanupReason | null {
  if (node.type === 'note' || isCleanupBlock(node)) return null
  if (node.gate?.kind === 'dead') return 'dead'
  if (node.gate?.kind === 'inert') return 'inert'
  return null
}

// the sources a row needs from the live team, build and enemy; any missing one makes the row dead
function sourcesFor(node: CleanupNode): DataSrcRef[] {
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

/*
  plan a cleanup over every section.
  high-level flow per body (each loop run is its own body):
  1. find skills whose attached setters repeat the setters right before them
  2. plan reorders for movable setters, nearest skills first, forward then backward
  3. walk the rows: recurse into blocks and attached rows, then record
     redundant, reordered, dead (missing source) or gated inert/dead targets
  a row targeted outside any loop run replaces its per-run targets.
*/
export function planRotationCleanup(
  sections: readonly CleanupSection[],
  context?: CleanupSourceContext,
): CleanupPlan {
  const targets: CleanupTarget[] = []
  const targetKeys = new Set<string>()
  const globalTargetIds = new Set<string>()

  // a global target wins over per-run targets for the same row; per-run targets dedupe by row, loop and run
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
    nodes: readonly CleanupNode[],
    inheritedDisabled: boolean,
    pass?: { loopId: string; run: number },
  ): void => {
    // persistent setters that make a skill's attached copies redundant. these rows are kept.
    const keptSetters = new Set<string>()
    const redundantByIndex = new Map<number, Pick<CleanupTarget, 'precedingConditionIds'>>()
    const recipientSensitive = (node: CleanupNode): boolean => {
      const writes = node.type === 'condition' ? conditionWrites(node) : node.type === 'step' ? node.changes ?? [] : []
      const owner = node.type === 'condition' ? conditionOwner(node) : node.type === 'step' ? node.memberId : undefined
      return writes.some(change => context?.recipientSensitivePaths?.has(writeKey(change, owner)))
    }
    if (!inheritedDisabled) {
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]!
        if (recipientSensitive(node)) continue
        const adjacentIds = precedingDuplicateSetters(nodes, index)
        if (!adjacentIds) continue
        const sourcesPresent = !context?.availableSources || [node, ...adjacentIds
          .map((id) => nodes.find((candidate) => candidate.id === id))
          .filter((candidate): candidate is CleanupNode => candidate != null)]
          .every((candidate) => sourcesFor(candidate).every((source) => (
            context.availableSources!.has(makeSourceKey(source))
          )))
        if (!sourcesPresent) continue
        adjacentIds.forEach((id) => keptSetters.add(id))
        redundantByIndex.set(index, { precedingConditionIds: adjacentIds })
      }
    }
    const sourceMissing = (node: CleanupNode): boolean => Boolean(
      context?.availableSources
      && sourcesFor(node).some((source) => (
        !context.availableSources!.has(makeSourceKey(source))
      )),
    )
    /*
      moves are planned before removals. a condition that can trade places
      with the attached copies around it is kept and moved, and the attached
      copies are dropped, even when the condition's own write was a no-op.
    */
    const moves = new Map<string, Pick<CleanupTarget, 'moveAfterId' | 'moveBeforeId' | 'detachFromIds'>>()
    if (!inheritedDisabled) {
      const redundantSteps = new Set([...redundantByIndex.keys()].map((index) => nodes[index]!.id))
      const blocked = (node: CleanupNode): boolean => (
        redundantSteps.has(node.id) || keptSetters.has(node.id) || sourceMissing(node) || recipientSensitive(node)
      )
      // one attached copy can only be dropped by one move.
      const claimed = new Set<string>()
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]!
        if (node.type !== 'condition' || blocked(node)) continue
        const setter = movableSetter(node)
        if (!setter) continue
        const unclaimed = (run: readonly string[]) => run.length > 0
          && run.every((id) => !claimed.has(`${id}\u0000${setter.key}`))

        let move: Pick<CleanupTarget, 'moveAfterId' | 'moveBeforeId' | 'detachFromIds'> | null = null
        const prior = pass ? node.priorByRun?.[pass.run] : node.prior
        if (prior && !Object.is(prior.value, setter.change.value)) {
          const run = reorderRun(nodes, index, 1, setter.key, prior.value, blocked)
          if (unclaimed(run)) move = { moveAfterId: run.at(-1)!, detachFromIds: run }
        }
        if (!move) {
          const run = reorderRun(nodes, index, -1, setter.key, setter.change.value, blocked)
          if (unclaimed(run)) move = { moveBeforeId: run.at(-1)!, detachFromIds: run }
        }
        if (!move) continue
        move.detachFromIds!.forEach((id) => claimed.add(`${id}\u0000${setter.key}`))
        moves.set(node.id, move)
      }
    }

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!
      const ownDisabled = 'disabled' in node && Boolean(node.disabled)
      const disabled = inheritedDisabled || ownDisabled

      if (isCleanupBlock(node)) {
        // a loop's own disabled flag is not passed to its children; other blocks pass it on
        const childDisabled = node.type === 'loop' ? inheritedDisabled : disabled
        if (isCheckoutableLoop(node)) {
          const template = node.passTemplate ?? node.children
          const loopId = blockLoopId(node)
          for (let run = 1; run <= normLoopRuns(node.runs); run += 1) {
            visit(
              resolvePassBody(template, node.passForks, run),
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

      const redundant = redundantByIndex.get(index)
      if (redundant) {
        addTarget({
          id: node.id,
          reason: 'redundant',
          ...(pass ? { loopId: pass.loopId, run: pass.run } : {}),
          ...redundant,
        })
      }

      const move = moves.get(node.id)
      if (move) {
        addTarget({
          id: node.id,
          reason: 'reordered',
          ...(pass ? { loopId: pass.loopId, run: pass.run } : {}),
          ...move,
        })
        continue
      }

      const missing = sourceMissing(node)
      let reason = missing ? 'dead' : targetFor(node)
      if (keptSetters.has(node.id)) reason = null
      // inside a loop run, conditions and swaps use the gate recorded for that run
      let scoped = false
      if (
        !missing
        && pass
        && !keptSetters.has(node.id)
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
type ScopedTargetLists = ReadonlyMap<string, ReadonlyMap<number, readonly CleanupTarget[]>>

// per-run removal ids, grouped by loop id and run
function scopedTargets(plan: CleanupPlan): ScopedCleanupTargets {
  const mutable = new Map<string, Map<number, Set<string>>>()
  for (const target of plan.targets) {
    if (target.reason === 'redundant' || target.reason === 'reordered') continue
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

// per-run redundant or reordered targets, grouped by loop id and run
function scopedByReason(plan: CleanupPlan, reason: 'redundant' | 'reordered' = 'redundant'): ScopedTargetLists {
  const grouped = new Map<string, Map<number, CleanupTarget[]>>()
  for (const target of plan.targets) {
    if (target.reason !== reason || target.loopId == null || target.run == null) continue
    let byRun = grouped.get(target.loopId)
    if (!byRun) {
      byRun = new Map()
      grouped.set(target.loopId, byRun)
    }
    const list = byRun.get(target.run) ?? []
    list.push(target)
    byRun.set(target.run, list)
  }
  return grouped
}

/**
 * clear the attached copies of skills whose preceding setters already apply
 * them. a skill is skipped when its preceding setters moved since planning.
 */
function dropPrecededAttachments(
  nodes: readonly CleanupNode[],
  targets: readonly CleanupTarget[],
): readonly CleanupNode[] {
  if (targets.length === 0) return nodes
  const byStep = new Map(targets.map((target) => [target.id, target]))
  let changed = false
  const next = nodes.map((node, index) => {
    const preceding = byStep.get(node.id)?.precedingConditionIds
    const stillPreceded = preceding?.length
      && preceding.every((id, offset) => nodes[index - preceding.length + offset]?.id === id)
      && precedingDuplicateSetters(nodes, index)
    if (node.type === 'step' && stillPreceded) {
      changed = true
      return {
        ...node,
        changes: undefined,
        changesEdited: true,
        attachedChangesByRun: undefined,
        writesByRun: undefined,
        pendingWrites: undefined,
      }
    }
    if (!isCleanupBlock(node)) return node
    const mapped = mapBlockBodies(node, (body) => dropPrecededAttachments(body, targets))
    changed ||= mapped !== node
    return mapped
  })
  return changed ? next : nodes
}

/** drop a skill's attached write to one state, the same edit as removing it by hand. */
function detachWrite(step: CleanupStep, keys: ReadonlySet<string>): CleanupStep {
  const changes = (step.changes ?? []).filter((change) => !keys.has(writeKey(change, step.memberId)))
  if (changes.length === (step.changes?.length ?? 0)) return step
  return {
    ...step,
    changes: changes.length > 0 ? changes : undefined,
    changesEdited: true,
    attachedChangesByRun: undefined,
    writesByRun: undefined,
    pendingWrites: undefined,
  }
}

/** rebuild a block whose bodies a mapper may have changed. */
function mapBlockBodies(
  node: CleanupBlock,
  mapper: (body: readonly CleanupNode[]) => readonly CleanupNode[],
): CleanupBlock {
  const children = mapper(node.children)
  const passTemplate = node.passTemplate ? mapper(node.passTemplate) : undefined
  let passForks = node.passForks
  if (node.passForks) {
    let forksChanged = false
    const forks: Record<number, CleanupNode[]> = {}
    for (const [run, body] of Object.entries(node.passForks)) {
      const updated = mapper(body)
      forks[Number(run)] = updated === body ? body : [...updated]
      forksChanged ||= updated !== body
    }
    if (forksChanged) passForks = forks
  }
  if (children === node.children && passTemplate === node.passTemplate && passForks === node.passForks) {
    return node
  }
  return {
    ...node,
    children: [...children],
    nodeCount: children.length,
    ...(passTemplate ? { passTemplate: [...passTemplate] } : {}),
    ...(passForks ? { passForks } : {}),
  }
}

/**
 * move each reordered setter beside its anchor and drop the attached copies
 * it made unnecessary. a move whose rows are no longer siblings is skipped.
 */
function applyReorders(
  nodes: readonly CleanupNode[],
  targets: readonly CleanupTarget[],
): readonly CleanupNode[] {
  if (targets.length === 0) return nodes
  const present = new Map(nodes.map((node) => [node.id, node]))
  const moving = new Set<string>()
  const before = new Map<string, CleanupNode[]>()
  const after = new Map<string, CleanupNode[]>()
  const detach = new Map<string, Set<string>>()

  for (const target of targets) {
    const node = present.get(target.id)
    const anchorId = target.moveAfterId ?? target.moveBeforeId
    const setter = node ? movableSetter(node) : null
    if (!node || !setter || !anchorId || !present.has(anchorId)) continue
    if (!(target.detachFromIds ?? []).every((id) => present.has(id))) continue
    moving.add(node.id)
    for (const id of target.detachFromIds ?? []) {
      const keys = detach.get(id) ?? new Set<string>()
      keys.add(setter.key)
      detach.set(id, keys)
    }
  }

  // several setters sharing an anchor keep their authored order.
  for (const node of nodes) {
    if (!moving.has(node.id)) continue
    const target = targets.find((entry) => entry.id === node.id)!
    const slots = target.moveAfterId ? after : before
    const anchorId = (target.moveAfterId ?? target.moveBeforeId)!
    const list = slots.get(anchorId) ?? []
    list.push(node)
    slots.set(anchorId, list)
  }

  let changed = moving.size > 0
  const next: CleanupNode[] = []
  for (const node of nodes) {
    if (moving.has(node.id)) continue
    next.push(...(before.get(node.id) ?? []))
    const keys = detach.get(node.id)
    if (keys && node.type === 'step') {
      next.push(detachWrite(node, keys))
    } else if (isCleanupBlock(node)) {
      const mapped = mapBlockBodies(node, (body) => applyReorders(body, targets))
      changed ||= mapped !== node
      next.push(mapped)
    } else {
      next.push(node)
    }
    next.push(...(after.get(node.id) ?? []))
  }
  return changed ? next : nodes
}

/**
 * map every run's body of a loop and store the results as template plus forks.
 * a run gets a fork whenever its body differs from the previous run by value;
 * bodies with equal display fields still keep separate node ids, which
 * identify distinct authored actions and trace rows.
 */
function mapCleanupPassBodies(
  block: CleanupBlock,
  mapper: (body: readonly CleanupNode[], run: number) => readonly CleanupNode[],
): CleanupBlock {
  const template = block.passTemplate ?? block.children
  const previousForks = block.passForks ?? {}
  const nextForks: Record<number, CleanupNode[]> = {}
  let nextTemplate: readonly CleanupNode[] = template
  let inherited: readonly CleanupNode[] = template
  let changed = false
  const bodies: CleanupNode[][] = []

  for (let run = 1; run <= normLoopRuns(block.runs); run += 1) {
    const original = resolvePassBody(template, previousForks, run)
    const mapped = mapper(original, run)
    const body = mapped === original ? original : [...mapped]
    changed ||= body !== original
    bodies.push([...body])

    if (run === 1 && previousForks[1] == null) {
      nextTemplate = body
    } else if (previousForks[run] != null || JSON.stringify(body) !== JSON.stringify(inherited)) {
      nextForks[run] = [...body]
    }
    inherited = body
  }

  if (!changed) return block
  const checkedOutRun = Math.min(Math.max(1, block.checkedOutRun ?? 1), bodies.length)
  const children = bodies[checkedOutRun - 1] ?? [...nextTemplate]
  return {
    ...block,
    children,
    nodeCount: children.length,
    passTemplate: [...nextTemplate],
    passForks: Object.keys(nextForks).length > 0 ? nextForks : undefined,
  }
}

/*
  apply per-run targets inside every checkoutable loop.
  each run's body applies nested loops first, then redundant copies, reorders,
  and finally removals, the same order as the global pass.
*/
function applyScopedCleanup(
  nodes: readonly CleanupNode[],
  targets: ScopedCleanupTargets,
  redundant: ScopedTargetLists,
  reorders: ScopedTargetLists,
): readonly CleanupNode[] {
  let changed = false
  const next = nodes.map((node) => {
    if (!isCleanupBlock(node)) return node
    if (isCheckoutableLoop(node)) {
      const loopTargets = targets.get(blockLoopId(node))
      const loopRedundant = redundant.get(blockLoopId(node))
      const loopReorders = reorders.get(blockLoopId(node))
      const mapped = mapCleanupPassBodies(node, (body, run) => {
        let passBody = applyScopedCleanup(body, targets, redundant, reorders)
        const passRedundant = loopRedundant?.get(run)
        if (passRedundant) passBody = dropPrecededAttachments(passBody, passRedundant)
        const passReorders = loopReorders?.get(run)
        if (passReorders) passBody = applyReorders(passBody, passReorders)
        const ids = loopTargets?.get(run)
        if (ids && ids.size > 0) passBody = removeFromNodes(passBody, ids)
        return passBody === body ? body : [...passBody]
      })
      changed ||= mapped !== node
      return mapped
    }
    const children = applyScopedCleanup(node.children, targets, redundant, reorders)
    if (children === node.children) return node
    changed = true
    return { ...node, children: [...children], nodeCount: children.length }
  })
  return changed ? next : nodes
}

// remove targeted rows from a skill's attached rows, recursively; edited skills are marked attachedEdited
function removeAttached(
  children: readonly CleanupStep[],
  ids: ReadonlySet<string>,
): readonly CleanupStep[] {
  let changed = false
  const next: CleanupStep[] = []

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

// remove targeted rows from a body, its attached rows, and every stored loop body
function removeFromNodes(
  nodes: readonly CleanupNode[],
  ids: ReadonlySet<string>,
): readonly CleanupNode[] {
  let changed = false
  const next: CleanupNode[] = []

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

    if (isCleanupBlock(node)) {
      const children = removeFromNodes(node.children, ids)
      const passTemplate = node.passTemplate
        ? removeFromNodes(node.passTemplate, ids)
        : undefined
      let passForks = node.passForks
      if (node.passForks) {
        let forksChanged = false
        const nextForks: Record<number, CleanupNode[]> = {}
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

/**
 * apply a cleanup plan. removing a row is the same edit as deleting it by
 * hand, including its copies in stored loop bodies and attached feature rows.
 * order: per-run targets, then global redundant copies, reorders, removals.
 */
export function applyRotationCleanup<S extends CleanupSection>(
  sections: S[],
  plan: CleanupPlan,
): S[] {
  if (plan.targets.length === 0) return sections
  const ids = new Set(plan.targets.flatMap((target) => (
    target.reason !== 'redundant' && target.reason !== 'reordered'
    && (target.loopId == null || target.run == null)
      ? [target.id]
      : []
  )))
  const perPass = scopedTargets(plan)
  const perPassRedundant = scopedByReason(plan)
  const perPassReorders = scopedByReason(plan, 'reordered')
  const globalRedundant = plan.targets.filter((target) => (
    target.reason === 'redundant' && target.loopId == null
  ))
  const globalReorders = plan.targets.filter((target) => (
    target.reason === 'reordered' && target.loopId == null
  ))
  let changed = false
  const next = sections.map((section) => {
    const scoped = perPass.size > 0 || perPassRedundant.size > 0 || perPassReorders.size > 0
      ? applyScopedCleanup(section.children, perPass, perPassRedundant, perPassReorders)
      : section.children
    const deduped = globalRedundant.length > 0 ? dropPrecededAttachments(scoped, globalRedundant) : scoped
    const reordered = globalReorders.length > 0 ? applyReorders(deduped, globalReorders) : deduped
    const children = ids.size > 0 ? removeFromNodes(reordered, ids) : reordered
    if (children === section.children) return section
    changed = true
    return { ...section, children: [...children] }
  })
  // every rewrite spreads the original nodes and sections, so caller fields survive the cast
  return changed ? next as S[] : sections
}

/** the plan summary shared by the confirmation prompt and the result toast. */
export function describeRotationCleanup(plan: CleanupPlan): string {
  const { inert, dead, redundant, reordered, detached } = cleanupCounts(plan)
  const rows = (count: number) => `${count} ${count === 1 ? 'node' : 'nodes'}`
  const parts = [
    inert > 0 ? `${rows(inert)} that didn't actually change` : null,
    dead > 0 ? `${rows(dead)} the last run never used` : null,
    redundant > 0
      ? `${redundant} ${redundant === 1 ? 'skill' : 'skills'} with attached setters the conditions before them already apply`
      : null,
    reordered > 0
      ? `${detached} attached ${detached === 1 ? 'setter' : 'setters'} by moving ${reordered} ${reordered === 1 ? 'condition' : 'conditions'} past the skills they covered`
      : null,
  ].filter(Boolean)
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}` : parts[0]}.`
}
