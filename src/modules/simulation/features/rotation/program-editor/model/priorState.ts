/*
  Author: Runor Ewhro
  Description: Reads where a state already stands at the point a condition is
               being added, so a new condition opens on a useful write rather
               than on the authored default.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { RuntimeValue } from '@/domain/gameData/contracts.ts'
import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'
import { srcSttKey, srcSttMax } from '@/domain/state/sourceStateInit.ts'
import {
  cycleCondValue,
  seedCondValue,
} from '@/modules/simulation/features/rotation/shared/conditions.tsx'
import type {
  CondChoice,
  RotationConditionValue,
} from '@/modules/simulation/features/rotation/shared/authoringTypes.ts'
import { isEditorBlock, type EditorCondition, type EditorNode, type EditorSection } from './program.ts'
import { parseRegValue } from './registerValues.ts'

const RT_CONTROLS_PREFIX = 'runtime.state.controls.'

/** Where the node being added lands, which is everything the walk counts. */
export type CondAnchor =
  | { kind: 'after' | 'before'; id: string }
  /** appended: into the block named by `id`, or onto the end of the program */
  | { kind: 'end'; id?: string }

/** The shape this module needs from a run's `history`, keyed by state path. */
export type CondWriteHistory = ReadonlyMap<
  string,
  ReadonlyArray<{ nodeId: string; run: number; to: string }>
>

export interface CondSeedContext {
  sections: readonly EditorSection[]
  anchor: CondAnchor
  /** last run's writes, which resolve adds, clamps and loop passes exactly */
  history?: CondWriteHistory
  runtimesById?: Record<string, ResRuntime>
  activeRuntime?: ResRuntime | null
}

interface AuthoredWrite {
  nodeId: string
  type: 'set' | 'add' | 'toggle'
  path: string
  value: RuntimeValue | undefined
  resonatorId?: string
}

function conditionWrite(node: EditorCondition): AuthoredWrite | null {
  if (!node.path) {
    return null
  }

  return {
    nodeId: node.id,
    type: node.writeAction ?? node.change?.type ?? 'set',
    path: node.path,
    value: parseRegValue(node.state, node.writeValue ?? node.to, node.change),
    ...(node.change?.resonatorId ? { resonatorId: node.change.resonatorId } : {}),
  }
}

function applyWrite(
  current: RuntimeValue | undefined,
  write: AuthoredWrite,
): RuntimeValue | undefined {
  if (write.type === 'add') {
    const base = Number(current ?? 0)
    return (Number.isFinite(base) ? base : 0) + Number(write.value ?? 0)
  }

  if (write.type === 'toggle') {
    return write.value ?? !current
  }

  return write.value
}

/** Match the rotation engine's missing-member fallback for handoff writes. */
function normalizeStandingValue(
  state: CondChoice['state'],
  value: RuntimeValue | undefined,
): RuntimeValue | undefined {
  if (
    state.path === ACTIVE_RESONATOR_PATH
    && !state.options?.some((option) => option.id === String(value ?? ''))
  ) {
    return state.defaultValue
  }
  return value
}

/** The last pass of a node's write, which is the value it leaves behind. */
function lastRun(
  history: CondWriteHistory | undefined,
  path: string,
  nodeId: string,
): string | undefined {
  let latest: { run: number; to: string } | undefined

  for (const record of history?.get(path) ?? []) {
    if (record.nodeId === nodeId && (!latest || record.run >= latest.run)) {
      latest = record
    }
  }

  return latest?.to
}

/**
 * The value a state holds where a new condition would land.
 *
 * Writes attached to a step are deliberately not counted: the engine runs them
 * in a scope that rolls back, so they never reach a later node.
 */
export function standingCondValue(
  choice: CondChoice,
  context: CondSeedContext,
): RuntimeValue | undefined {
  const { state } = choice
  // enemy and rotation states are globally scoped; a resonator state belongs to
  // the one member, and teammates sharing a weapon share its path.
  const scoped = !choice.changeTarget || choice.changeTarget === 'runtime'
  const { anchor, history } = context
  let standing: RuntimeValue | undefined
  let written = false

  const take = (write: AuthoredWrite, ownerId: string | undefined) => {
    if (write.path !== state.path) {
      return
    }

    if (scoped && (write.resonatorId ?? ownerId) !== choice.resonatorId) {
      return
    }

    const ran = lastRun(history, state.path, write.nodeId)
    standing = normalizeStandingValue(state, ran === undefined
      ? applyWrite(standing, write)
      : parseRegValue(state, ran))
    written = true
  }

  const visit = (list: readonly EditorNode[]): boolean => {
    for (const node of list) {
      if (anchor.kind === 'before' && node.id === anchor.id) {
        return true
      }

      if (node.type === 'condition') {
        const write = conditionWrite(node)
        if (write) {
          take(write, node.owner.kind === 'member' ? node.owner.memberId : undefined)
        }
      }

      // a handoff is the active-resonator write, wearing its own node type
      if (node.type === 'swap') {
        take({
          nodeId: node.id,
          type: 'set',
          path: ACTIVE_RESONATOR_PATH,
          value: node.to,
        }, undefined)
      }

      if (isEditorBlock(node) && visit(node.children)) {
        return true
      }

      if (anchor.kind !== 'before' && node.id === anchor.id) {
        return true
      }
    }

    return false
  }

  for (const section of context.sections) {
    if (visit(section.children)) {
      break
    }
  }

  if (written) {
    return standing
  }

  // nothing wrote it yet, so the rotation opens on whatever the build carries
  const runtime = context.runtimesById?.[choice.resonatorId]
  if (runtime && state.path.startsWith(RT_CONTROLS_PREFIX)) {
    const current = runtime.state.controls[srcSttKey(state)]
    if (current !== undefined) {
      return current
    }
  }

  return state.defaultValue
}

/** The write a condition added at this anchor should open on. */
export function seedCondValueFor(
  choice: CondChoice,
  context: CondSeedContext,
): RotationConditionValue {
  const { state } = choice
  const standing = standingCondValue(choice, context)

  if (state.path === ACTIVE_RESONATOR_PATH) {
    return cycleCondValue(state, standing)
  }

  const runtime = context.runtimesById?.[choice.resonatorId] ?? context.activeRuntime ?? null
  /*
    a select's max only means something when the data names one: srcSttMax
    otherwise hands back the last option, which is not what turning a mode on
    is supposed to mean.
  */
  const maxValue = state.kind === 'select'
    ? state.maxValue
    : runtime
      ? srcSttMax(runtime, runtime, state, context.activeRuntime ?? runtime)
      : state.maxValue ?? state.max

  return seedCondValue(state, standing, maxValue)
}
