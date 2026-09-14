/*
  Author: Runor Ewhro
  Description: Verifies the compiler.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  compileRotationPlan,
  ROT_FLAG_ATTACHMENTS,
  ROT_FLAG_DYNAMIC_OPERAND,
  ROT_FLAG_ENABLED,
  ROT_OP_CONDITION,
  ROT_OP_FEATURE,
  ROT_OP_LOOP_END,
  ROT_OP_LOOP_START,
  ROT_VALUE_BOOLEAN,
  ROT_VALUE_NUMBER,
  ROT_WRITE_ADD,
  ROT_WRITE_SET,
} from '@/engine/rotation/compiler.ts'

describe('rotation numeric compiler', () => {
  it('lowers inherited loop forks into every following compiled pass', () => {
    const forkHit: RotationNode = { id: 'fork-hit', type: 'feature', featureId: 'damage:fork' }
    const items: RotationNode[] = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'cycle',
        runs: 3,
        passForks: { '2': [forkHit] },
      },
      { id: 'hit', type: 'feature', featureId: 'damage:base' },
      { id: 'loop-end', type: 'loop', kind: 'end', loopId: 'cycle' },
    ]

    const plan = compileRotationPlan(items)
    const loop = plan.root.loopsByIndex[0]

    expect([...plan.root.opcodes]).toEqual([
      ROT_OP_LOOP_START,
      ROT_OP_FEATURE,
      ROT_OP_LOOP_END,
    ])
    expect(plan.root.loopEndByIndex[0]).toBe(2)
    expect(loop?.passBlocks).toHaveLength(3)
    expect(loop?.passBlocks[0]?.items[0]?.id).toBe('hit')
    expect(loop?.passBlocks[1]?.items[0]?.id).toBe('fork-hit')
    expect(loop?.passBlocks[2]?.items[0]?.id).toBe('fork-hit')
    expect(plan.featureIds).toEqual(['damage:base', 'damage:fork'])
  })

  it('interns state paths and leaves crossing loops on the parity fallback', () => {
    const items: RotationNode[] = [
      { id: 'a-start', type: 'loop', kind: 'start', loopId: 'a', runs: 1 },
      { id: 'b-start', type: 'loop', kind: 'start', loopId: 'b', runs: 1 },
      { id: 'a-end', type: 'loop', kind: 'end', loopId: 'a' },
      {
        id: 'write',
        type: 'condition',
        changes: [{ type: 'set', path: 'runtime.state.controls.test', value: true }],
      },
      { id: 'b-end', type: 'loop', kind: 'end', loopId: 'b' },
    ]

    const plan = compileRotationPlan(items)

    expect(plan.root.loopsByIndex[0]).toBeNull()
    expect(plan.root.loopsByIndex[1]).toBeNull()
    expect(plan.root.opcodes[3]).toBe(ROT_OP_CONDITION)
    expect(plan.runtimePaths).toEqual(['runtime.state.controls.test'])
    expect([...plan.root.writeOpcodes]).toEqual([ROT_WRITE_SET])
    expect([...plan.root.writePathIndexes]).toEqual([0])
    expect([...plan.root.writeValueKinds]).toEqual([ROT_VALUE_BOOLEAN])
    expect([...plan.root.writeNumericValues]).toEqual([1])
  })

  it('packs feature ownership, numeric literals, and condition values into aligned operands', () => {
    const items: RotationNode[] = [
      {
        id: 'write',
        type: 'condition',
        resonatorId: 'owner',
        changes: [{
          type: 'add',
          path: 'runtime.state.combat.spectroFrazzle',
          value: 3,
          resonatorId: 'owner',
        }],
      },
      {
        id: 'feature',
        type: 'feature',
        resonatorId: 'owner',
        featureId: 'damage:skill',
      },
      {
        id: 'repeat',
        type: 'repeat',
        times: 4,
        items: [],
      },
    ]

    const plan = compileRotationPlan(items)
    // the intern table holds write targets; node ownership is read off the node
    expect(plan.resonatorIds).toEqual(['owner'])
    expect([...plan.root.writeResonatorIndexes]).toEqual([0])
    expect(plan.featureIds).toEqual(['damage:skill'])
    expect([...plan.root.featureIndexByIndex]).toEqual([-1, 0, -1])
    expect(plan.root.flagsByIndex[1] & ROT_FLAG_ENABLED).toBe(ROT_FLAG_ENABLED)
    expect(plan.root.numericOperandByIndex[2]).toBe(4)
    expect([...plan.root.writeOpcodes]).toEqual([ROT_WRITE_ADD])
    expect([...plan.root.writeValueKinds]).toEqual([ROT_VALUE_NUMBER])
    expect([...plan.root.writeNumericValues]).toEqual([3])
  })

  it('packs local-scope and dynamic-control gates into one byte per node', () => {
    const plan = compileRotationPlan([
      {
        id: 'attached',
        type: 'feature',
        featureId: 'damage:skill',
        attached: { conditions: [], features: [] },
        changes: [{ type: 'set', path: 'runtime.state.controls.test', value: true }],
      },
      { id: 'dynamic', type: 'repeat', times: { type: 'const', value: 2 }, items: [] },
    ])

    expect(plan.root.flagsByIndex[0] & ROT_FLAG_ATTACHMENTS).toBe(ROT_FLAG_ATTACHMENTS)
    expect(plan.root.flagsByIndex[1] & ROT_FLAG_DYNAMIC_OPERAND).toBe(ROT_FLAG_DYNAMIC_OPERAND)
  })
})
