/*
  Author: Runor Ewhro
  Description: Lazy copy-on-write loop pass bodies and the one-time migration
               from legacy run rules into canonical per-pass forks.
*/

import type {
  RotationNode,
  RtChng,
} from '@/domain/gameData/contracts.ts'
import {
  scopeLegacyRotationRulesToLoops,
  readLegacyRotWhen,
  type LegacyRotWhenRule as RotWhenRule,
  type LegacyRotWhenRunOverride as RotWhenRunOverride,
} from '@/domain/gameData/legacyRotationRules.ts'

export type LoopPassForks = Record<string, RotationNode[]>

export type RotLoopStart = Extract<RotationNode, { type: 'loop'; kind: 'start' }>

/** 1-based run keys as strings for stable JSON. */
export function passKey(run: number): string {
  return String(Math.max(1, Math.floor(run)))
}

export function readPassForks(
  start: RotLoopStart | { passForks?: LoopPassForks },
): LoopPassForks {
  return start.passForks ?? {}
}

/**
 * Resolve a pass from its nearest authored predecessor. Fork bodies are full
 * snapshots at transition points: an exact fork wins, otherwise the greatest
 * lower run wins, with the document template acting as run zero.
 */
export function resolveInheritedPassBody<T>(
  template: readonly T[],
  passForks:
    | Readonly<Record<string, readonly T[]>>
    | Readonly<Record<number, readonly T[]>>
    | undefined,
  run: number,
): readonly T[] {
  const target = Math.max(1, Math.floor(run))
  let inheritedRun = 0
  let inherited = template

  for (const [key, body] of Object.entries(passForks ?? {}) as Array<[string, readonly T[]]>) {
    const forkRun = Number(key)
    if (
      Number.isInteger(forkRun)
      && forkRun >= 1
      && forkRun <= target
      && forkRun > inheritedRun
    ) {
      inheritedRun = forkRun
      inherited = body
    }
  }

  return inherited
}

export function resolveLoopPassBody(
  template: readonly RotationNode[],
  passForks: LoopPassForks | undefined,
  run: number,
): RotationNode[] {
  return resolveInheritedPassBody(template, passForks, run) as RotationNode[]
}

/** Whether this run already has its own stored body. */
export function isLoopPassForked(
  passForks: LoopPassForks | undefined,
  run: number,
): boolean {
  return Boolean(passForks?.[passKey(run)])
}

function unresolvedWhenAt(
  when: RotWhenRule | undefined,
  coords: Readonly<Record<string, number>>,
): RotWhenRule | undefined {
  if (!when) {
    return undefined
  }
  const loops = (when.loops ?? []).filter((rule) => !(rule.loopId in coords))
  const overrides = (when.overrides ?? []).filter((override) =>
    Object.keys(override.runs).some((loopId) => !(loopId in coords)))
  if (loops.length === 0 && overrides.length === 0) {
    return undefined
  }
  return {
    ...(loops.length > 0 ? { loops } : {}),
    ...(overrides.length > 0 ? { overrides } : {}),
  }
}

function whenPreservingLoops(
  when: RotWhenRule | undefined,
  preservedLoopIds: ReadonlySet<string>,
): RotWhenRule | undefined {
  if (!when) {
    return undefined
  }
  const loops = (when.loops ?? []).filter((rule) => preservedLoopIds.has(rule.loopId))
  const overrides = (when.overrides ?? []).filter((override) =>
    Object.keys(override.runs).some((loopId) => preservedLoopIds.has(loopId)))
  if (loops.length === 0 && overrides.length === 0) {
    return undefined
  }
  return {
    ...(loops.length > 0 ? { loops } : {}),
    ...(overrides.length > 0 ? { overrides } : {}),
  }
}

function writeNodeWhen(node: RotationNode, when: RotWhenRule | undefined): RotationNode {
  if (node.type === 'note' || (node.type === 'loop' && node.kind === 'end')) {
    return node
  }
  const { when: _removedWhen, ...withoutWhen } = node as RotationNode & {
    when?: RotWhenRule
  }
  void _removedWhen
  return (when ? { ...withoutWhen, when } : withoutWhen) as unknown as RotationNode
}

function stripNodeWhenRunConfig(node: RotationNode): RotationNode {
  if (node.type === 'note' || (node.type === 'loop' && node.kind === 'end')) {
    return node
  }

  let next = writeNodeWhen(node, undefined)
  if (next.type === 'feature' && next.attached) {
    next = {
      ...next,
      attached: {
        conditions: next.attached.conditions.map(stripNodeWhenRunConfig) as Extract<
          RotationNode,
          { type: 'condition' }
        >[],
        features: next.attached.features.map(stripNodeWhenRunConfig) as Extract<
          RotationNode,
          { type: 'feature' }
        >[],
      },
    }
  } else if (next.type === 'repeat') {
    next = {
      ...next,
      ...(next.setup ? { setup: next.setup.map(stripNodeWhenRunConfig) } : {}),
      items: next.items.map(stripNodeWhenRunConfig),
    }
  } else if (next.type === 'uptime') {
    next = {
      ...next,
      ...(next.setup ? { setup: next.setup.map(stripNodeWhenRunConfig) } : {}),
      items: next.items.map(stripNodeWhenRunConfig),
    }
  } else if (next.type === 'loop' && next.kind === 'start') {
    const forks = readPassForks(next)
    const nextForks: LoopPassForks = {}
    for (const [key, body] of Object.entries(forks)) {
      nextForks[key] = body.map(stripNodeWhenRunConfig)
    }
    next = {
      ...next,
      ...(Object.keys(nextForks).length > 0 ? { passForks: nextForks } : { passForks: undefined }),
    }
  }
  return next
}

function stripNodeWhenRunConfigExcept(
  node: RotationNode,
  preservedLoopIds: ReadonlySet<string>,
): RotationNode {
  if (node.type === 'note' || (node.type === 'loop' && node.kind === 'end')) {
    return node
  }

  let next = writeNodeWhen(
    node,
    whenPreservingLoops(readLegacyRotWhen(node), preservedLoopIds),
  )
  if (next.type === 'feature' && next.attached) {
    next = {
      ...next,
      attached: {
        conditions: next.attached.conditions.map((child) =>
          stripNodeWhenRunConfigExcept(child, preservedLoopIds)) as Extract<
            RotationNode,
            { type: 'condition' }
          >[],
        features: next.attached.features.map((child) =>
          stripNodeWhenRunConfigExcept(child, preservedLoopIds)) as Extract<
            RotationNode,
            { type: 'feature' }
          >[],
      },
    }
  } else if (next.type === 'repeat') {
    next = {
      ...next,
      ...(next.setup
        ? {
          setup: next.setup.map((child) =>
            stripNodeWhenRunConfigExcept(child, preservedLoopIds)),
        }
        : {}),
      items: next.items.map((child) => stripNodeWhenRunConfigExcept(child, preservedLoopIds)),
    }
  } else if (next.type === 'uptime') {
    next = {
      ...next,
      ...(next.setup
        ? {
          setup: next.setup.map((child) =>
            stripNodeWhenRunConfigExcept(child, preservedLoopIds)),
        }
        : {}),
      items: next.items.map((child) => stripNodeWhenRunConfigExcept(child, preservedLoopIds)),
    }
  } else if (next.type === 'loop' && next.kind === 'start' && next.passForks) {
    next = {
      ...next,
      passForks: Object.fromEntries(
        Object.entries(next.passForks).map(([run, body]) => [
          run,
          body.map((child) => stripNodeWhenRunConfigExcept(child, preservedLoopIds)),
        ]),
      ),
    }
  }
  return next
}

function nodePresentAt(
  node: RotationNode,
  coords: Readonly<Record<string, number>>,
): boolean {
  if (node.type === 'loop' && node.kind === 'end') {
    return true
  }
  const when = readLegacyRotWhen(node)
  if (!when?.loops?.length) {
    return true
  }
  // Only enforce rules for loops already fixed in coords. Inner-loop rules
  // stay on the node until that loop is expanded.
  const applicable = when.loops.filter((rule) => rule.loopId in coords)
  if (applicable.length === 0) {
    return true
  }
  return applicable.every((rule) => {
    const active = coords[rule.loopId]
    return typeof active === 'number' && rule.runs.includes(active)
  })
}

function overrideMatches(
  override: RotWhenRunOverride,
  coords: Readonly<Record<string, number>>,
): boolean {
  const entries = Object.entries(override.runs)
  if (entries.length === 0) {
    return false
  }
  // Multi-loop overrides apply only when the full stack is known.
  if (entries.some(([loopId]) => coords[loopId] == null)) {
    return false
  }
  return entries.every(([loopId, run]) => coords[loopId] === run)
}

function applyOverrideToNode(
  node: RotationNode,
  override: RotWhenRunOverride,
): RotationNode {
  if (node.type === 'feature') {
    const withMultiplier = {
      ...node,
      ...(typeof override.multiplier === 'number' && Number.isFinite(override.multiplier)
        ? { multiplier: override.multiplier }
        : {}),
    }
    if (!override.changes) {
      return withMultiplier
    }
    return {
      ...withMultiplier,
      changes: undefined,
      attached: {
        conditions: override.changes.map((change: RtChng, index: number) => ({
          id: `${node.id}:legacy-condition:${index}`,
          type: 'condition' as const,
          resonatorId: change.resonatorId ?? node.resonatorId,
          enabled: true as const,
          changes: [change],
        })),
        features: node.attached?.features ?? [],
      },
    }
  }
  if (node.type === 'condition' && override.changes) {
    return { ...node, changes: override.changes }
  }
  if (node.type === 'repeat'
    && typeof override.times === 'number'
    && Number.isFinite(override.times)) {
    return { ...node, times: override.times }
  }
  if (node.type === 'uptime'
    && typeof override.ratio === 'number'
    && Number.isFinite(override.ratio)) {
    return { ...node, ratio: override.ratio }
  }
  return node
}

function applyOverridesAt(
  node: RotationNode,
  coords: Readonly<Record<string, number>>,
): RotationNode {
  const when = readLegacyRotWhen(node)
  if (!when?.overrides?.length) {
    return node
  }
  const matched = when.overrides.filter((override) => overrideMatches(override, coords))
  return matched.reduce(applyOverrideToNode, node)
}

function materializeNodeAt(
  node: RotationNode,
  coords: Readonly<Record<string, number>>,
): RotationNode | null {
  if (!nodePresentAt(node, coords)) {
    return null
  }
  let next = applyOverridesAt(node, coords)

  if (next.type === 'feature' && next.attached) {
    next = {
      ...next,
      attached: {
        conditions: next.attached.conditions.flatMap((child) => {
          const material = materializeNodeAt(child, coords)
          return material ? [material as Extract<RotationNode, { type: 'condition' }>] : []
        }),
        features: next.attached.features.flatMap((child) => {
          const material = materializeNodeAt(child, coords)
          return material ? [material as Extract<RotationNode, { type: 'feature' }>] : []
        }),
      },
    }
  } else if (next.type === 'repeat') {
    next = {
      ...next,
      ...(next.setup ? { setup: materializeBodyAt(next.setup, coords) } : {}),
      items: materializeBodyAt(next.items, coords),
    }
  } else if (next.type === 'uptime') {
    next = {
      ...next,
      ...(next.setup ? { setup: materializeBodyAt(next.setup, coords) } : {}),
      items: materializeBodyAt(next.items, coords),
    }
  } else if (next.type === 'loop' && next.kind === 'start' && next.passForks) {
    const passForks: LoopPassForks = {}
    for (const [run, body] of Object.entries(next.passForks)) {
      passForks[run] = materializeBodyAt(body, coords)
    }
    next = {
      ...next,
      passForks,
    }
  }

  const when = next.type === 'note' || (next.type === 'loop' && next.kind === 'end')
    ? undefined
    : unresolvedWhenAt(readLegacyRotWhen(next), coords)
  return writeNodeWhen(next, when)
}

function materializeBodyAt(
  items: readonly RotationNode[],
  coords: Readonly<Record<string, number>>,
): RotationNode[] {
  return items.flatMap((node) => {
    const material = materializeNodeAt(node, coords)
    return material ? [material] : []
  })
}

/** Structural compare for COW compression; ids may differ after materialize. */
export function rotationBodiesEqual(
  left: readonly RotationNode[],
  right: readonly RotationNode[],
): boolean {
  return stableBody(left) === stableBody(right)
}

function stableBody(items: readonly RotationNode[]): string {
  return JSON.stringify(items.map(stableNode))
}

function stableNode(node: RotationNode): unknown {
  if (node.type === 'note') {
    return {
      type: 'note',
      label: node.label,
      color: node.color,
      text: node.text,
      editorSection: node.editorSection,
    }
  }
  if (node.type === 'loop') {
    if (node.kind === 'end') {
      return {
        type: 'loop',
        kind: 'end',
        loopId: node.loopId,
        enabled: node.enabled ?? true,
        editorSection: node.editorSection,
      }
    }
    const forks = readPassForks(node)
    const stableForks: Record<string, unknown> = {}
    for (const [key, body] of Object.entries(forks)) {
      stableForks[key] = body.map(stableNode)
    }
    return {
      type: 'loop',
      kind: 'start',
      loopId: node.loopId,
      runs: node.runs ?? 1,
      label: node.label,
      color: node.color,
      enabled: node.enabled ?? true,
      when: readLegacyRotWhen(node),
      editorSection: node.editorSection,
      passForks: Object.keys(stableForks).length > 0 ? stableForks : undefined,
      note: node.note ? stableNode(node.note) : undefined,
    }
  }
  if (node.type === 'feature') {
    return {
      type: 'feature',
      featureId: node.featureId,
      resonatorId: node.resonatorId,
      enabled: node.enabled ?? true,
      multiplier: node.multiplier,
      negativeEffectStacks: node.negativeEffectStacks,
      negativeEffectInstances: node.negativeEffectInstances,
      negativeEffectStableWidth: node.negativeEffectStableWidth,
      changes: node.changes,
      when: readLegacyRotWhen(node),
      editorSection: node.editorSection,
      attached: node.attached
        ? {
          conditions: node.attached.conditions.map(stableNode),
          features: node.attached.features.map(stableNode),
        }
        : undefined,
      note: node.note ? stableNode(node.note) : undefined,
    }
  }
  if (node.type === 'condition') {
    return {
      type: 'condition',
      resonatorId: node.resonatorId,
      enabled: node.enabled ?? true,
      label: node.label,
      changes: node.changes,
      when: readLegacyRotWhen(node),
      editorSection: node.editorSection,
      note: node.note ? stableNode(node.note) : undefined,
    }
  }
  if (node.type === 'repeat') {
    return {
      type: 'repeat',
      resonatorId: node.resonatorId,
      enabled: node.enabled ?? true,
      label: node.label,
      color: node.color,
      times: node.times,
      ratio: node.ratio,
      when: readLegacyRotWhen(node),
      editorSection: node.editorSection,
      setup: node.setup?.map(stableNode),
      items: node.items.map(stableNode),
      note: node.note ? stableNode(node.note) : undefined,
    }
  }
  if (node.type === 'uptime') {
    return {
    type: 'uptime',
    resonatorId: node.resonatorId,
    enabled: node.enabled ?? true,
    label: node.label,
    color: node.color,
    ratio: node.ratio,
    when: readLegacyRotWhen(node),
    editorSection: node.editorSection,
    setup: node.setup?.map(stableNode),
    items: node.items.map(stableNode),
    note: node.note ? stableNode(node.note) : undefined,
    }
  }

  return node
}

function findMatchingEndIndex(
  items: readonly RotationNode[],
  startIndex: number,
  loopId: string,
): number | null {
  for (let index = startIndex + 1; index < items.length; index += 1) {
    const node = items[index]
    if (node?.type === 'loop' && node.kind === 'end' && node.loopId === loopId) {
      return index
    }
  }
  return null
}

function freeLoopIdsIn(items: readonly RotationNode[]): Set<string> {
  const freeLoopIds = new Set<string>()
  for (let index = 0; index < items.length; index += 1) {
    const node = items[index]
    if (node?.type !== 'loop' || node.kind !== 'start') {
      continue
    }
    if (findMatchingEndIndex(items, index, node.loopId) == null) {
      freeLoopIds.add(node.loopId)
    }
  }
  return freeLoopIds
}

function compressPassForks(
  template: RotationNode[],
  bodies: RotationNode[][],
): LoopPassForks {
  const forks: LoopPassForks = {}
  let inherited = template
  for (let run = 1; run <= bodies.length; run += 1) {
    const body = bodies[run - 1] ?? template
    if (!rotationBodiesEqual(body, inherited)) {
      forks[passKey(run)] = body
    }
    inherited = body
  }
  return forks
}

function deepCloneNodes(items: readonly RotationNode[]): RotationNode[] {
  return structuredClone(items) as RotationNode[]
}

/**
 * Expand nested loop starts inside a list without materializing this list's
 * own when.loops yet — those rules must survive until the enclosing loop
 * materializes each pass.
 */
function expandNestedLoopStructures(
  items: RotationNode[],
  parentCoords: Readonly<Record<string, number>>,
  preservedLoopIds: ReadonlySet<string>,
): RotationNode[] {
  const out: RotationNode[] = []
  let index = 0

  while (index < items.length) {
    const node = items[index]
    if (!node) {
      index += 1
      continue
    }

    if (node.type === 'loop' && node.kind === 'start') {
      // Expand only this nested loop span, not following siblings.
      const srcEnd = findMatchingEndIndex(items, index, node.loopId)
      if (srcEnd == null) {
        out.push(node)
        index += 1
        continue
      }
      const span = items.slice(index, srcEnd + 1)
      out.push(...normalizeLoopPassBodies(span, parentCoords, preservedLoopIds))
      index = srcEnd + 1
      continue
    }

    if (node.type === 'repeat') {
      out.push({
        ...node,
        ...(node.setup
          ? { setup: expandNestedLoopStructures(node.setup, parentCoords, preservedLoopIds) }
          : {}),
        items: expandNestedLoopStructures(node.items, parentCoords, preservedLoopIds),
      })
      index += 1
      continue
    }

    if (node.type === 'uptime') {
      out.push({
        ...node,
        ...(node.setup
          ? { setup: expandNestedLoopStructures(node.setup, parentCoords, preservedLoopIds) }
          : {}),
        items: expandNestedLoopStructures(node.items, parentCoords, preservedLoopIds),
      })
      index += 1
      continue
    }

    if (node.type === 'feature' && node.attached) {
      out.push({
        ...node,
        attached: {
          conditions: expandNestedLoopStructures(
            node.attached.conditions,
            parentCoords,
            preservedLoopIds,
          ) as Extract<RotationNode, { type: 'condition' }>[],
          features: expandNestedLoopStructures(
            node.attached.features,
            parentCoords,
            preservedLoopIds,
          ) as Extract<RotationNode, { type: 'feature' }>[],
        },
      })
      index += 1
      continue
    }

    out.push(node)
    index += 1
  }

  return out
}

/**
 * Expand bounded legacy when.loops / when.overrides into lazy pass forks.
 * Circular no-end and wrap loops retain their run rules for the frame-stack
 * interpreter. Idempotent on already-normalized trees.
 */
function normalizeLoopPassBodies(
  items: RotationNode[],
  parentCoords: Readonly<Record<string, number>> = {},
  inheritedPreservedLoopIds: ReadonlySet<string> = new Set(),
): RotationNode[] {
  const out: RotationNode[] = []
  const freeLoopIds = new Set([
    ...inheritedPreservedLoopIds,
    ...freeLoopIdsIn(items),
  ])
  let index = 0

  while (index < items.length) {
    const node = items[index]
    if (!node) {
      index += 1
      continue
    }

    if (node.type === 'loop' && node.kind === 'start') {
      const start = node
      const endIndex = findMatchingEndIndex(items, index, start.loopId)
      if (endIndex == null) {
        out.push(
          Object.keys(parentCoords).length === 0
            ? stripNodeWhenRunConfigExcept(start, freeLoopIds)
            : start,
        )
        index += 1
        continue
      }
      const rawBody = items.slice(index + 1, endIndex)
      const endNode = items[endIndex]
      const runs = Math.max(1, Math.floor(start.runs ?? 1))

      // Expand nested loops first; keep this loop's when.rules on body nodes.
      const nestedReady = expandNestedLoopStructures(rawBody, parentCoords, freeLoopIds)

      const existingForks = readPassForks(start)
      const hasLegacyWhen = bodyHasRunWhenConfig(nestedReady)
        || bodyHasRunWhenConfig(Object.values(existingForks).flat())

      let template: RotationNode[]
      let passForks: LoopPassForks | undefined

      if (!hasLegacyWhen && Object.keys(existingForks).length > 0) {
        template = nestedReady.map(stripNodeWhenRunConfig)
        const nextForks: LoopPassForks = {}
        for (const [key, body] of Object.entries(existingForks)) {
          const coords = { ...parentCoords, [start.loopId]: Number(key) }
          nextForks[key] = normalizeLoopPassBodies(body, coords, freeLoopIds)
        }
        passForks = Object.keys(nextForks).length > 0 ? nextForks : undefined
      } else if (!hasLegacyWhen) {
        // Uniform loop, no forks and no when run config.
        template = nestedReady.map(stripNodeWhenRunConfig)
        passForks = undefined
      } else {
        const bodies: RotationNode[][] = []
        for (let run = 1; run <= runs; run += 1) {
          const coords = { ...parentCoords, [start.loopId]: run }
          const source = resolveLoopPassBody(nestedReady, existingForks, run)
          const materialized = materializeBodyAt(deepCloneNodes(source), coords)
          // Nested loops inside the materialized body may still carry rules.
          bodies.push(
            normalizeLoopPassBodies(materialized, coords, freeLoopIds),
          )
        }
        template = bodies[0] ?? []
        const compressed = compressPassForks(template, bodies)
        passForks = Object.keys(compressed).length > 0 ? compressed : undefined
      }

      const nextStart = writeNodeWhen(
        start,
        unresolvedWhenAt(readLegacyRotWhen(start), parentCoords),
      ) as RotLoopStart
      if (passForks && Object.keys(passForks).length > 0) {
        nextStart.passForks = passForks
      } else {
        delete (nextStart as { passForks?: LoopPassForks }).passForks
      }

      out.push(nextStart)
      out.push(...template)
      out.push(endNode)
      index = endIndex + 1
      continue
    }

    if (node.type === 'repeat') {
      out.push({
        ...node,
        items: normalizeLoopPassBodies(node.items, parentCoords, freeLoopIds),
      })
      index += 1
      continue
    }

    if (node.type === 'uptime') {
      out.push({
        ...node,
        ...(node.setup
          ? { setup: normalizeLoopPassBodies(node.setup, parentCoords, freeLoopIds) }
          : {}),
        items: normalizeLoopPassBodies(node.items, parentCoords, freeLoopIds),
      })
      index += 1
      continue
    }

    if (node.type === 'feature' && node.attached) {
      out.push({
        ...node,
        attached: {
          conditions: normalizeLoopPassBodies(
            node.attached.conditions,
            parentCoords,
            freeLoopIds,
          ) as Extract<RotationNode, { type: 'condition' }>[],
          features: normalizeLoopPassBodies(
            node.attached.features,
            parentCoords,
            freeLoopIds,
          ) as Extract<RotationNode, { type: 'feature' }>[],
        },
      })
      index += 1
      continue
    }

    // Outside any loop being expanded: strip residual run config only.
    out.push(
      Object.keys(parentCoords).length === 0
        ? stripNodeWhenRunConfigExcept(node, freeLoopIds)
        : node,
    )
    index += 1
  }

  return out
}

function bodyHasRunWhenConfig(items: readonly RotationNode[]): boolean {
  for (const node of items) {
    if (node.type === 'loop' && node.kind === 'end') {
      continue
    }
    const when = readLegacyRotWhen(node)
    if (when) {
      if ((when.loops?.length ?? 0) > 0 || (when.overrides?.length ?? 0) > 0) {
        return true
      }
    }
    if (node.type === 'feature' && node.attached) {
      if (bodyHasRunWhenConfig(node.attached.conditions)
        || bodyHasRunWhenConfig(node.attached.features)) {
        return true
      }
    }
    if (node.type === 'repeat') {
      if (node.setup && bodyHasRunWhenConfig(node.setup)) {
        return true
      }
      if (bodyHasRunWhenConfig(node.items)) {
        return true
      }
    }
    if (node.type === 'uptime') {
      if (node.setup && bodyHasRunWhenConfig(node.setup)) {
        return true
      }
      if (bodyHasRunWhenConfig(node.items)) {
        return true
      }
    }
    if (node.type === 'loop' && node.kind === 'start') {
      const forks = readPassForks(node)
      if (bodyHasRunWhenConfig(Object.values(forks).flat())) {
        return true
      }
    }
  }
  return false
}

/**
 * Extract the template body of a loop from a flat list (nodes strictly between
 * start and its matching end). No-end loops take everything after the start.
 */
export function extractLoopTemplateBody(
  items: readonly RotationNode[],
  startIndex: number,
): { body: RotationNode[]; endIndex: number | null } {
  const start = items[startIndex]
  if (!start || start.type !== 'loop' || start.kind !== 'start') {
    return { body: [], endIndex: null }
  }
  const endIndex = findMatchingEndIndex(items, startIndex, start.loopId)
  if (endIndex == null) {
    return {
      body: items.slice(startIndex + 1) as RotationNode[],
      endIndex: null,
    }
  }
  return {
    body: items.slice(startIndex + 1, endIndex) as RotationNode[],
    endIndex,
  }
}

function findAnyMatchingEndIndex(
  items: readonly RotationNode[],
  startIndex: number,
  loopId: string,
): number | null {
  const index = items.findIndex((node, candidateIndex) =>
    candidateIndex !== startIndex
    && node.type === 'loop'
    && node.kind === 'end'
    && node.loopId === loopId)
  return index >= 0 ? index : null
}

/** Logical body of a wrap/no-end loop in the order the circular walker runs it. */
function extractCircularLoopBody(
  items: readonly RotationNode[],
  startIndex: number,
  endIndex: number | null,
): RotationNode[] {
  const tail = items.slice(startIndex + 1)
  const head = endIndex == null ? items.slice(0, startIndex) : items.slice(0, endIndex)
  return [...tail, ...head] as RotationNode[]
}

/** Body order used by execution for bounded, wrap-around, and no-end loops. */
export function extractLoopExecutionBody(
  items: readonly RotationNode[],
  startIndex: number,
): { body: RotationNode[]; endIndex: number | null; circular: boolean } {
  const start = items[startIndex]
  if (!start || start.type !== 'loop' || start.kind !== 'start') {
    return { body: [], endIndex: null, circular: false }
  }
  const endIndex = findAnyMatchingEndIndex(items, startIndex, start.loopId)
  if (endIndex != null && endIndex > startIndex) {
    return {
      body: items.slice(startIndex + 1, endIndex) as RotationNode[],
      endIndex,
      circular: false,
    }
  }
  return {
    body: extractCircularLoopBody(items, startIndex, endIndex),
    endIndex,
    circular: true,
  }
}

/** Remove every legacy `when` field. Only its run rules ever carried meaning. */
function stripLegacyWhenNode(node: RotationNode): RotationNode {
  if (node.type === 'note') {
    return node
  }

  const { when: _when, ...withoutWhen } = node as RotationNode & { when?: RotWhenRule }
  void _when
  if (node.type === 'loop' && node.kind === 'end') {
    return withoutWhen as RotationNode
  }
  let next = withoutWhen as RotationNode

  if (next.type === 'feature' && next.attached) {
    next = {
      ...next,
      attached: {
        conditions: stripLegacyWhenItems(next.attached.conditions) as Extract<
          RotationNode,
          { type: 'condition' }
        >[],
        features: stripLegacyWhenItems(next.attached.features) as Extract<
          RotationNode,
          { type: 'feature' }
        >[],
      },
    }
  } else if (next.type === 'repeat') {
    next = {
      ...next,
      ...(next.setup ? { setup: stripLegacyWhenItems(next.setup) } : {}),
      items: stripLegacyWhenItems(next.items),
    }
  } else if (next.type === 'uptime') {
    next = {
      ...next,
      ...(next.setup ? { setup: stripLegacyWhenItems(next.setup) } : {}),
      items: stripLegacyWhenItems(next.items),
    }
  } else if (next.type === 'loop' && next.kind === 'start' && next.passForks) {
    next = {
      ...next,
      passForks: Object.fromEntries(
        Object.entries(next.passForks).map(([run, body]) => [
          run,
          stripLegacyWhenItems(body),
        ]),
      ),
    }
  }

  return next
}

function stripLegacyWhenItems(items: readonly RotationNode[]): RotationNode[] {
  return items.map(stripLegacyWhenNode)
}

/**
 * Materialize legacy rules on wrap-around and no-end loops. Their document
 * template is distributed around the marker list, so divergent runs are kept
 * as exact forks while the distributed template remains the shared fallback.
 */
function normalizeCircularLoopPasses(
  items: RotationNode[],
  parentCoords: Readonly<Record<string, number>> = {},
): RotationNode[] {
  const nextItems = [...items]

  for (let index = 0; index < nextItems.length; index += 1) {
    const node = nextItems[index]
    if (!node) continue

    if (node.type === 'loop' && node.kind === 'start') {
      const forwardEnd = findMatchingEndIndex(nextItems, index, node.loopId)
      if (forwardEnd == null) {
        const endIndex = findAnyMatchingEndIndex(nextItems, index, node.loopId)
        const rawTemplate = extractCircularLoopBody(nextItems, index, endIndex)
        const existingForks = readPassForks(node)
        const hasLegacyRules = bodyHasRunWhenConfig(rawTemplate)
          || bodyHasRunWhenConfig(Object.values(existingForks).flat())
        const runs = Math.max(1, Math.floor(node.runs ?? 1))
        const canonicalTemplate = stripLegacyWhenItems(rawTemplate)
        const bodies: RotationNode[][] = []

        for (let run = 1; run <= runs; run += 1) {
          const source = resolveLoopPassBody(rawTemplate, existingForks, run)
          const coords = { ...parentCoords, [node.loopId]: run }
          const body = hasLegacyRules
            ? materializeBodyAt(deepCloneNodes(source), coords)
            : deepCloneNodes(source)
          const normalized = stripLegacyWhenItems(
            normalizeCircularLoopPasses(normalizeLoopPassBodies(body, coords), coords),
          )
          bodies.push(normalized)
        }
        const passForks = compressPassForks(canonicalTemplate, bodies)

        nextItems[index] = {
          ...node,
          ...(Object.keys(passForks).length > 0
            ? { passForks }
            : { passForks: undefined }),
        }
      }
    }

    const current = nextItems[index]
    if (!current) continue
    if (current.type === 'feature' && current.attached) {
      nextItems[index] = {
        ...current,
        attached: {
          conditions: normalizeCircularLoopPasses(
            current.attached.conditions,
            parentCoords,
          ) as Extract<RotationNode, { type: 'condition' }>[],
          features: normalizeCircularLoopPasses(
            current.attached.features,
            parentCoords,
          ) as Extract<RotationNode, { type: 'feature' }>[],
        },
      }
    } else if (current.type === 'repeat') {
      nextItems[index] = {
        ...current,
        ...(current.setup
          ? { setup: normalizeCircularLoopPasses(current.setup, parentCoords) }
          : {}),
        items: normalizeCircularLoopPasses(current.items, parentCoords),
      }
    } else if (current.type === 'uptime') {
      nextItems[index] = {
        ...current,
        ...(current.setup
          ? { setup: normalizeCircularLoopPasses(current.setup, parentCoords) }
          : {}),
        items: normalizeCircularLoopPasses(current.items, parentCoords),
      }
    } else if (current.type === 'loop' && current.kind === 'start' && current.passForks) {
      nextItems[index] = {
        ...current,
        passForks: Object.fromEntries(
          Object.entries(current.passForks).map(([run, body]) => [
            run,
            normalizeCircularLoopPasses(body, {
              ...parentCoords,
              [current.loopId]: Number(run),
            }),
          ]),
        ),
      }
    }
  }

  return nextItems
}

/**
 * One-time compatibility migration for persisted/imported rotations. Current
 * editor and execution paths must receive only the returned canonical shape.
 */
export function migrateLegacyRotationItems(items: RotationNode[]): RotationNode[] {
  const copied = structuredClone(items) as RotationNode[]
  const scoped = scopeLegacyRotationRulesToLoops(copied)
  const bounded = normalizeLoopPassBodies(scoped)
  return stripLegacyWhenItems(normalizeCircularLoopPasses(bounded))
}
