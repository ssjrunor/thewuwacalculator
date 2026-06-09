/*
  Author: Runor Ewhro
  Description: Enumerates every distinct maximal state configuration of a
               resonator by steering at each diverging step. A "divergence" is an
               exclusive state group (a mode group or a mutually-exclusive member
               group); for each branch combination the path is resolved with that
               branch pinned via the existing `maxResRt` resolver, then deduped on
               the resolved controls.

  This is a self-contained prototype for the teammate-finder Phase-1 tracer. It
  reuses `maxResRt` as the per-leaf resolver (all dependency-fixpoint, reset and
  sequence-cap logic stays there) and only adds the branch enumeration on top.

  Notes / production refinements (intentionally out of scope here):
   - Eager product over divergences + dedup: equivalent to a lazy contextual
     traversal for the distinct-pool *set*; dedup collapses unreachable or
     equivalent combos. A lazy version would additionally skip resolving them.
   - Dedup is on the resolved control config (pure `maxResRt` output, no
     pipeline). The finder would instead dedup on the resolved non-self buff pool.
   - Divergence = exclusive groups only. Channel-routing selects (e.g. "amp
     glacio" vs "amp fusion") are also divergences for a damage finder; they are
     not enumerated here.
*/

import type { ResDtls, ResStateGroup } from '@/domain/entities/resonator'
import type { ResRuntime } from '@/domain/entities/runtime'
import { maxResRt } from '@/domain/gameData/resonatorMax'
import { getResStateGroups } from '@/domain/gameData/resonatorStateGraph'

export interface MaxStatePath {
  // groupId -> chosen branch (mode id, or member control key)
  pins: Record<string, string>
  // fully resolved, maxed runtime for this branch combination
  runtime: ResRuntime
  // canonical signature of the resolved controls (dedup key)
  signature: string
}

interface Divergence {
  groupId: string
  kind: 'mode' | 'member'
  options: string[]
}

export interface EnumerateOptions {
  targetSequence?: number
  // include the "none" branch of allowNone mode groups (default false: a maxed
  // path always picks an active mode).
  includeNone?: boolean
}

// classify an exclusive group into a divergence, or null when it offers no real
// fork (0 or 1 selectable branch).
function groupDivergence(group: ResStateGroup, includeNone: boolean): Divergence | null {
  if (group.type !== 'exclusive') {
    return null
  }

  if (group.controlKey && group.modes?.length) {
    const options = group.modes
      .map((mode) => mode.id)
      .filter((id) => includeNone || id !== 'none')
    return options.length > 1 ? { groupId: group.id, kind: 'mode', options } : null
  }

  if (group.members && group.members.length > 1) {
    return { groupId: group.id, kind: 'member', options: [...group.members] }
  }

  return null
}

// clone details and force each divergence to its chosen branch. maxPriority is
// cleared on pinned groups so the explicit choice wins over any sequence rule.
function pinDetails(
  details: ResDtls,
  divergences: Divergence[],
  combo: Record<string, string>,
): ResDtls {
  const clone = structuredClone(details)
  const groups = clone.stateGraph?.groups ?? []

  for (const divergence of divergences) {
    const group = groups.find((entry) => entry.id === divergence.groupId)
    if (!group) {
      continue
    }

    delete group.maxPriority
    const choice = combo[divergence.groupId]
    if (divergence.kind === 'mode') {
      group.maxValue = choice
    } else {
      group.maxKey = choice
    }
  }

  return clone
}

function controlSignature(runtime: ResRuntime): string {
  const controls = runtime.state.controls
  return Object.keys(controls)
    .sort()
    .map((key) => `${key}=${String(controls[key])}`)
    .join('|')
}

export function maxStateDivergences(
  details: ResDtls | null | undefined,
  options: EnumerateOptions = {},
): Divergence[] {
  return getResStateGroups(details)
    .map((group) => groupDivergence(group, options.includeNone ?? false))
    .filter((divergence): divergence is Divergence => divergence !== null)
}

export function enumerateMaxStatePaths(
  baseRuntime: ResRuntime,
  details: ResDtls | null | undefined,
  options: EnumerateOptions = {},
): MaxStatePath[] {
  if (!details) {
    return []
  }

  const divergences = maxStateDivergences(details, options)

  // cartesian product over divergence branches — steer at each diverging step.
  let combos: Array<Record<string, string>> = [{}]
  for (const divergence of divergences) {
    combos = combos.flatMap((combo) =>
      divergence.options.map((option) => ({ ...combo, [divergence.groupId]: option })),
    )
  }

  const seen = new Map<string, MaxStatePath>()
  for (const combo of combos) {
    const pinned = pinDetails(details, divergences, combo)
    const runtime = maxResRt(baseRuntime, pinned, { targetSequence: options.targetSequence })
    const signature = controlSignature(runtime)
    if (!seen.has(signature)) {
      seen.set(signature, { pins: combo, runtime, signature })
    }
  }

  return [...seen.values()]
}
