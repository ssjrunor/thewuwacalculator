/*
  Author: Runor Ewhro
  Description: Verifies the cleanup.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type {
  EditorBlock,
  EditorCondition,
  EditorHandoff,
  EditorNode,
  EditorNote,
  EditorSection,
  EditorStep,
  NodeGate,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import type { DataSrcRef } from '@/domain/gameData/contracts.ts'
import {
  applyRotationCleanup,
  cleanupCounts,
  describeRotationCleanup,
  planRotationCleanup,
} from '@/modules/simulation/features/rotation/program-editor/model/cleanup.ts'
import { resolveEditorPassBody } from '@/modules/simulation/features/rotation/program-editor/model/passCheckout.ts'
import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'

function step(id: string, gate?: NodeGate): EditorStep {
  return {
    type: 'step',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    index: 0,
    featureId: id,
    multiplier: 1,
    damageByRun: {},
    statsByRun: {},
    memberId: 'res-a',
    kindLabel: 'Skill',
    buffCount: 0,
    gate,
  }
}

function condition(id: string, gate?: NodeGate, source?: DataSrcRef): EditorCondition {
  return {
    type: 'condition',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    path: `runtime.${id}`,
    from: 'on',
    to: 'on',
    writeValue: true,
    rising: false,
    gate,
    ...(source ? {
      state: {
        id,
        label: id,
        source,
        ownerKey: `${source.type}:${source.id}`,
        controlKey: id,
        path: `runtime.${id}`,
        kind: 'toggle' as const,
      },
    } : {}),
  }
}

function handoff(id: string, gate?: NodeGate): EditorHandoff {
  return {
    type: 'swap',
    id,
    from: 'res-a',
    to: 'res-a',
    gate,
  }
}

function note(id: string): EditorNote {
  return { type: 'note', id, text: 'kept' }
}

function block(
  id: string,
  type: EditorBlock['type'],
  children: EditorNode[],
  extra: Partial<EditorBlock> = {},
): EditorBlock {
  return {
    type,
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    runs: 1,
    nodeCount: children.length,
    children,
    ...extra,
  }
}

function section(children: EditorNode[]): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children }]
}

function ids(sections: EditorSection[]): string[] {
  const out: string[] = []
  const visit = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      out.push(node.id)
      if ('children' in node) visit(node.children)
    }
  }
  for (const entry of sections) visit(entry.children)
  return out
}

describe('planning a rotation sweep', () => {
  it('takes the rows the last run left doing nothing, and nothing else', () => {
    const sections = section([
      step('ran'),
      step('never-ran', { kind: 'dead' }),
      condition('wrote-something'),
      condition('wrote-nothing', { kind: 'inert' }),
      condition('unresolved', { kind: 'dead' }),
      handoff('handed-over'),
      handoff('handed-to-itself', { kind: 'inert' }),
      note('display-only'),
    ])

    const plan = planRotationCleanup(sections)

    expect(plan.targets).toEqual([
      { id: 'never-ran', reason: 'dead' },
      { id: 'wrote-nothing', reason: 'inert' },
      { id: 'unresolved', reason: 'dead' },
      { id: 'handed-to-itself', reason: 'inert' },
    ])
    expect(cleanupCounts(plan)).toEqual({ inert: 2, dead: 2, total: 4 })
  })

  it('reads rows inside blocks, and never the blocks themselves', () => {
    const sections = section([
      block('empty-loop', 'loop', []),
      block('repeat', 'repeat', [
        step('inner-dead', { kind: 'dead' }),
        step('inner-ran'),
      ]),
    ])

    const plan = planRotationCleanup(sections)

    expect(plan.targets).toEqual([{ id: 'inner-dead', reason: 'dead' }])
  })

  it('keeps a switched-off row, which never runs by the author\'s own hand', () => {
    const sections = section([
      { ...step('parked', { kind: 'dead' }), disabled: true },
      { ...condition('parked-write', { kind: 'inert' }), disabled: true },
    ])

    expect(planRotationCleanup(sections).targets).toHaveLength(0)
  })

  it('removes a handoff whose authored destination member is missing', () => {
    const staleHandoff: EditorHandoff = {
      type: 'swap',
      id: 'stale-handoff',
      from: 'res-a',
      to: 'res-a',
      sourceNode: {
        type: 'condition',
        id: 'stale-handoff',
        changes: [{ type: 'set', path: ACTIVE_RESONATOR_PATH, value: 'missing-member' }],
      },
    }

    const plan = planRotationCleanup(section([staleHandoff]), {
      availableSources: new Set(['resonator:res-a']),
    })

    expect(plan.targets).toEqual([{ id: 'stale-handoff', reason: 'dead' }])
  })

  it('keeps rows inside a switched-off block, but not inside a switched-off loop marker', () => {
    const parked = planRotationCleanup(section([
      block('off', 'repeat', [step('inner', { kind: 'dead' })], { disabled: true }),
    ]))
    /* a loop marker carries no body of its own, so switching it off does not
       switch off what stands inside it */
    const looped = planRotationCleanup(section([
      block('off-loop', 'loop', [step('inner', { kind: 'dead' })], { disabled: true }),
    ]))

    expect(parked.targets).toHaveLength(0)
    expect(looped.targets).toEqual([{ id: 'inner', reason: 'dead' }])
  })

  it('finds nothing in a tree the last run said nothing about', () => {
    const plan = planRotationCleanup(section([step('fresh'), condition('fresh-write')]))

    expect(plan.targets).toEqual([])
    expect(cleanupCounts(plan)).toEqual({ inert: 0, dead: 0, total: 0 })
  })

  it('reads attached rows and every stored loop pass once', () => {
    const attached = step('attached-dead', { kind: 'dead' })
    const loop = block('loop', 'loop', [
      step('template-dead', { kind: 'dead' }),
    ], {
      runs: 2,
      passTemplate: [step('template-dead', { kind: 'dead' })],
      passForks: {
        2: [step('fork-dead', { kind: 'dead' })],
      },
    })
    const sections = section([
      { ...step('host'), attached: [attached] },
      loop,
    ])

    const plan = planRotationCleanup(sections)
    expect(plan.targets).toEqual([
      { id: 'attached-dead', reason: 'dead' },
      { id: 'template-dead', reason: 'dead' },
      { id: 'fork-dead', reason: 'dead' },
    ])

    const swept = applyRotationCleanup(sections, plan)
    const host = swept[0]?.children[0]
    const sweptLoop = swept[0]?.children[1]
    expect(host?.type === 'step' ? host.attached : undefined).toEqual([])
    expect(sweptLoop?.type === 'loop' ? sweptLoop.children : undefined).toEqual([])
    expect(sweptLoop?.type === 'loop' ? sweptLoop.passTemplate : undefined).toEqual([])
    expect(sweptLoop?.type === 'loop' ? sweptLoop.passForks?.[2] : undefined).toEqual([])
  })

  it('sweeps only the loop passes whose condition history was inert', () => {
    const write = {
      ...condition('write'),
      gateByRun: {
        2: { kind: 'inert' as const },
        4: { kind: 'inert' as const },
      },
    }
    const loop = block('loop', 'loop', [write], {
      runs: 4,
      loopId: 'loop-a',
      checkedOutRun: 1,
      passTemplate: [write],
    })
    const sections = section([loop])

    const plan = planRotationCleanup(sections)
    expect(plan.targets).toEqual([
      { id: 'write', reason: 'inert', loopId: 'loop-a', run: 2 },
      { id: 'write', reason: 'inert', loopId: 'loop-a', run: 4 },
    ])

    const swept = applyRotationCleanup(sections, plan)
    const sweptLoop = swept[0]?.children[0]
    expect(sweptLoop?.type).toBe('loop')
    if (sweptLoop?.type !== 'loop') return
    const template = sweptLoop.passTemplate ?? sweptLoop.children
    expect(resolveEditorPassBody(template, sweptLoop.passForks, 1).map((node) => node.id)).toEqual(['write'])
    expect(resolveEditorPassBody(template, sweptLoop.passForks, 2).map((node) => node.id)).toEqual([])
    expect(resolveEditorPassBody(template, sweptLoop.passForks, 3).map((node) => node.id)).toEqual(['write'])
    expect(resolveEditorPassBody(template, sweptLoop.passForks, 4).map((node) => node.id)).toEqual([])
  })

  it('takes rows whose live source is no longer available', () => {
    const sections = section([
      {
        ...step('missing-resonator'),
        owner: { kind: 'member', memberId: 'res-gone' },
      },
      condition('missing-weapon', undefined, { type: 'weapon', id: 'weapon-gone' }),
      condition('valid-enemy', undefined, { type: 'enemy', id: 'target' }),
      condition('valid-resonator', undefined, { type: 'resonator', id: 'res-live' }),
    ])

    const plan = planRotationCleanup(sections, {
      availableSources: new Set(['resonator:res-live', 'enemy:target']),
    })

    expect(plan.targets).toEqual([
      { id: 'missing-resonator', reason: 'dead' },
      { id: 'missing-weapon', reason: 'dead' },
    ])
  })
})

describe('applying a rotation sweep', () => {
  it('removes exactly the planned rows and leaves the rest in place', () => {
    const sections = section([
      step('keep'),
      condition('inert', { kind: 'inert' }),
      block('repeat', 'repeat', [
        step('dead', { kind: 'dead' }),
        note('note'),
      ]),
    ])

    const swept = applyRotationCleanup(sections, planRotationCleanup(sections))

    expect(ids(swept)).toEqual(['keep', 'repeat', 'note'])
  })

  it('returns the same tree when there is nothing to sweep', () => {
    const sections = section([step('keep')])

    expect(applyRotationCleanup(sections, planRotationCleanup(sections))).toBe(sections)
  })
})

describe('describing a rotation sweep', () => {
  it('states each kind it found, and only those', () => {
    const inertOnly = describeRotationCleanup({
      targets: [{ id: 'inert', reason: 'inert' }],
    })
    const deadOnly = describeRotationCleanup({
      targets: [
        { id: 'dead-1', reason: 'dead' },
        { id: 'dead-2', reason: 'dead' },
        { id: 'dead-3', reason: 'dead' },
        { id: 'dead-4', reason: 'dead' },
      ],
    })
    const both = describeRotationCleanup({
      targets: [
        { id: 'inert-1', reason: 'inert' },
        { id: 'inert-2', reason: 'inert' },
        { id: 'dead', reason: 'dead' },
      ],
    })

    expect(both).toBe("2 nodes that didn't actually change, and 1 node the last run never used.")
    expect(inertOnly).toBe("1 node that didn't actually change.")
    expect(deadOnly).toBe('4 nodes the last run never used.')
  })
})
