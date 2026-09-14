/*
  Author: Runor Ewhro
  Description: Implements the compiler logic for the rotation module.
*/

/*
  Rotation programs are authored as a rich object tree, but execution should
  not repeatedly rediscover node kinds, loop boundaries, pass bodies, or
  string-table identities. This module lowers that tree into compact numeric
  blocks while retaining node references only as cold semantic payloads.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  extractLoopExecutionBody,
  readPassForks,
  resolveLoopPassBody,
} from '@/domain/gameData/loopPasses.ts'

export const ROT_OP_FEATURE = 1
export const ROT_OP_CONDITION = 2
export const ROT_OP_REPEAT = 3
export const ROT_OP_UPTIME = 4
export const ROT_OP_LOOP_START = 5
export const ROT_OP_LOOP_END = 6
export const ROT_OP_NOTE = 7

export const ROT_WRITE_SET = 1
export const ROT_WRITE_ADD = 2
export const ROT_WRITE_TOGGLE = 3

export const ROT_VALUE_DEFAULT = 0
export const ROT_VALUE_NUMBER = 1
export const ROT_VALUE_BOOLEAN = 2
export const ROT_VALUE_STRING = 3

export const ROT_FLAG_ENABLED = 1 << 0
export const ROT_FLAG_ATTACHMENTS = 1 << 2
export const ROT_FLAG_DYNAMIC_OPERAND = 1 << 3

export type RotationOpcode =
  | typeof ROT_OP_FEATURE
  | typeof ROT_OP_CONDITION
  | typeof ROT_OP_REPEAT
  | typeof ROT_OP_UPTIME
  | typeof ROT_OP_LOOP_START
  | typeof ROT_OP_LOOP_END
  | typeof ROT_OP_NOTE

export interface CompiledRotationBlock {
  readonly items: readonly RotationNode[]
  /** One byte per authored node. */
  readonly opcodes: Uint8Array
  /** Pre-resolved gates/scope traits, aligned with `opcodes`. */
  readonly flagsByIndex: Uint8Array
  /** Matching end index for loop starts, or -1. */
  readonly loopEndByIndex: Int32Array
  readonly loopsByIndex: Array<CompiledRotationLoop | null>
  /** Intern-table operands aligned one-to-one with authored nodes. */
  readonly featureIndexByIndex: Int32Array
  /** Numeric repeat/uptime/loop literal, or NaN for a dynamic expression. */
  readonly numericOperandByIndex: Float64Array
  /** CSR ranges into the flattened authored state-write program. */
  readonly writeStartByIndex: Int32Array
  readonly writeCountByIndex: Int32Array
  readonly writeOpcodes: Uint8Array
  readonly writePathIndexes: Int32Array
  readonly writeResonatorIndexes: Int32Array
  readonly writeValueKinds: Uint8Array
  readonly writeNumericValues: Float64Array
  readonly writeStringIndexes: Int32Array
}

export interface CompiledRotationLoop {
  readonly endIndex: number | null
  readonly circular: boolean
  readonly template: readonly RotationNode[]
  /** Resolved and compiled body for every one-based pass. */
  readonly passBlocks: readonly CompiledRotationBlock[]
}

export interface CompiledRotationPlan {
  readonly root: CompiledRotationBlock
  readonly blockByItems: WeakMap<readonly RotationNode[], CompiledRotationBlock>
  /** Interned cold tables used by future numeric backends. */
  readonly featureIds: readonly string[]
  readonly runtimePaths: readonly string[]
  readonly resonatorIds: readonly string[]
  readonly stringValues: readonly string[]
  readonly nodeCount: number
}

function opcodeFor(node: RotationNode): RotationOpcode {
  if (node.type === 'feature') return ROT_OP_FEATURE
  if (node.type === 'condition') return ROT_OP_CONDITION
  if (node.type === 'repeat') return ROT_OP_REPEAT
  if (node.type === 'uptime') return ROT_OP_UPTIME
  if (node.type === 'note') return ROT_OP_NOTE
  return node.kind === 'start' ? ROT_OP_LOOP_START : ROT_OP_LOOP_END
}

function intern(table: string[], indexes: Map<string, number>, value: string | undefined): number {
  if (!value) return -1
  const existing = indexes.get(value)
  if (existing !== undefined) return existing
  const index = table.length
  indexes.set(value, index)
  table.push(value)
  return index
}

function hasStructuredForwardLoops(items: readonly RotationNode[]): boolean {
  const stack: string[] = []
  for (const node of items) {
    if (node.type !== 'loop') continue
    if (node.kind === 'start') {
      stack.push(node.loopId)
      continue
    }
    if (stack.pop() !== node.loopId) return false
  }
  return stack.length === 0
}

export function compileRotationPlan(items: RotationNode[]): CompiledRotationPlan {
  const blockByItems = new WeakMap<readonly RotationNode[], CompiledRotationBlock>()
  const featureIds: string[] = []
  const runtimePaths: string[] = []
  const resonatorIds: string[] = []
  const stringValues: string[] = []
  const featureIndexes = new Map<string, number>()
  const pathIndexes = new Map<string, number>()
  const resonatorIndexes = new Map<string, number>()
  const stringIndexes = new Map<string, number>()
  let nodeCount = 0

  const compileBlock = (blockItems: readonly RotationNode[]): CompiledRotationBlock => {
    const cached = blockByItems.get(blockItems)
    if (cached) return cached

    const opcodes = new Uint8Array(blockItems.length)
    const flagsByIndex = new Uint8Array(blockItems.length)
    const loopEndByIndex = new Int32Array(blockItems.length)
    loopEndByIndex.fill(-1)
    const featureIndexByIndex = new Int32Array(blockItems.length)
    featureIndexByIndex.fill(-1)
    const numericOperandByIndex = new Float64Array(blockItems.length)
    numericOperandByIndex.fill(Number.NaN)
    const writeStartByIndex = new Int32Array(blockItems.length)
    writeStartByIndex.fill(-1)
    const writeCountByIndex = new Int32Array(blockItems.length)
    const writeOpcodes: number[] = []
    const writePathIndexes: number[] = []
    const writeResonatorIndexes: number[] = []
    const writeValueKinds: number[] = []
    const writeNumericValues: number[] = []
    const writeStringIndexes: number[] = []
    const loopsByIndex = new Array<CompiledRotationLoop | null>(blockItems.length).fill(null)
    const block = {
      items: blockItems,
      opcodes,
      flagsByIndex,
      loopEndByIndex,
      loopsByIndex,
      featureIndexByIndex,
      numericOperandByIndex,
      writeStartByIndex,
      writeCountByIndex,
      // Filled after the authored block is walked.
      writeOpcodes: new Uint8Array(0),
      writePathIndexes: new Int32Array(0),
      writeResonatorIndexes: new Int32Array(0),
      writeValueKinds: new Uint8Array(0),
      writeNumericValues: new Float64Array(0),
      writeStringIndexes: new Int32Array(0),
    } satisfies CompiledRotationBlock
    // Register before descending so circular/shared authored arrays are safe.
    blockByItems.set(blockItems, block)
    const canLowerLoops = hasStructuredForwardLoops(blockItems)

    for (let index = 0; index < blockItems.length; index += 1) {
      const node = blockItems[index]
      if (!node) continue
      nodeCount += 1
      opcodes[index] = opcodeFor(node)
      let flags = !('enabled' in node) || node.enabled !== false ? ROT_FLAG_ENABLED : 0
      if (node.type === 'feature' && (
        node.attached?.conditions.length || node.attached?.features.length || node.changes?.length
      )) flags |= ROT_FLAG_ATTACHMENTS
      if (
        (node.type === 'repeat' && typeof node.times !== 'number')
        || (node.type === 'uptime' && typeof node.ratio !== 'number')
      ) flags |= ROT_FLAG_DYNAMIC_OPERAND
      flagsByIndex[index] = flags

      if (node.type === 'feature') {
        featureIndexByIndex[index] = intern(featureIds, featureIndexes, node.featureId)
        if (node.attached?.conditions.length) compileBlock(node.attached.conditions)
        if (node.attached?.features.length) compileBlock(node.attached.features)
        continue
      }

      if (node.type === 'condition') {
        writeStartByIndex[index] = writeOpcodes.length
        for (const change of node.changes) {
          writeOpcodes.push(
            change.type === 'set'
              ? ROT_WRITE_SET
              : change.type === 'add'
                ? ROT_WRITE_ADD
                : ROT_WRITE_TOGGLE,
          )
          writePathIndexes.push(intern(runtimePaths, pathIndexes, change.path))
          writeResonatorIndexes.push(intern(resonatorIds, resonatorIndexes, change.resonatorId))
          const value = change.value
          if (typeof value === 'number') {
            writeValueKinds.push(ROT_VALUE_NUMBER)
            writeNumericValues.push(value)
            writeStringIndexes.push(-1)
          } else if (typeof value === 'boolean') {
            writeValueKinds.push(ROT_VALUE_BOOLEAN)
            writeNumericValues.push(value ? 1 : 0)
            writeStringIndexes.push(-1)
          } else if (typeof value === 'string') {
            writeValueKinds.push(ROT_VALUE_STRING)
            writeNumericValues.push(Number.NaN)
            writeStringIndexes.push(intern(stringValues, stringIndexes, value))
          } else {
            writeValueKinds.push(ROT_VALUE_DEFAULT)
            writeNumericValues.push(Number.NaN)
            writeStringIndexes.push(-1)
          }
        }
        writeCountByIndex[index] = node.changes.length
        continue
      }

      if (node.type === 'repeat') {
        if (typeof node.times === 'number') numericOperandByIndex[index] = node.times
        if (node.setup) compileBlock(node.setup)
        compileBlock(node.items)
        continue
      }

      if (node.type === 'uptime') {
        if (typeof node.ratio === 'number') numericOperandByIndex[index] = node.ratio
        if (node.setup) compileBlock(node.setup)
        compileBlock(node.items)
        continue
      }

      if (node.type !== 'loop' || node.kind !== 'start') continue

      const extracted = extractLoopExecutionBody(blockItems as RotationNode[], index)
      numericOperandByIndex[index] = Math.max(1, Math.floor(node.runs ?? 1))
      loopEndByIndex[index] = extracted.endIndex ?? -1
      if (!canLowerLoops || extracted.circular) continue
      const runs = Math.max(1, Math.floor(node.runs ?? 1))
      const forks = readPassForks(node)
      const passBlocks: CompiledRotationBlock[] = []
      for (let run = 1; run <= runs; run += 1) {
        passBlocks.push(compileBlock(resolveLoopPassBody(extracted.body, forks, run)))
      }
      loopsByIndex[index] = {
        endIndex: extracted.endIndex,
        circular: extracted.circular,
        template: extracted.body,
        passBlocks,
      }
    }

    Object.assign(block, {
      writeOpcodes: Uint8Array.from(writeOpcodes),
      writePathIndexes: Int32Array.from(writePathIndexes),
      writeResonatorIndexes: Int32Array.from(writeResonatorIndexes),
      writeValueKinds: Uint8Array.from(writeValueKinds),
      writeNumericValues: Float64Array.from(writeNumericValues),
      writeStringIndexes: Int32Array.from(writeStringIndexes),
    })

    return block
  }

  const root = compileBlock(items)
  return {
    root,
    blockByItems,
    featureIds,
    runtimePaths,
    resonatorIds,
    stringValues,
    get nodeCount() { return nodeCount },
  }
}
