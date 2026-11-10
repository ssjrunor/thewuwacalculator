/*
  Author: Runor Ewhro
  description: verifies cleanup classification and canonical removal across
               containers, loop passes, attachments, and unavailable sources.
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
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import type { DataSrcRef } from '@/domain/gameData/contracts.ts'
import type { RtChng } from '@/domain/gameData/contracts.ts'
import {
  applyRotationCleanup,
  cleanupCounts,
  planRotationCleanup,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/cleanup.ts'
import { resolveEditorPassBody } from '@/modules/simulation/surfaces/rotation/program-editor/model/passCheckout.ts'
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

function duplicateSetterPair(id: string, paths = ['realm.a', 'realm.b']): EditorNode[] {
  const changes: RtChng[] = paths.map((path) => ({
    type: 'set', path, value: false, resonatorId: 'res-a',
  }))
  const attached = changes.map((change, index) => ({
    id: `${id}:attached:${index}`,
    type: 'condition' as const,
    resonatorId: 'res-a',
    changes: [change],
  }))
  const feature = {
    ...step(id),
    changes,
    sourceNode: {
      id,
      type: 'feature' as const,
      resonatorId: 'res-a',
      featureId: id,
      attached: { conditions: attached, features: [] },
    },
  }
  const persistent = changes.map((change, index) => ({
    ...condition(`${id}:persistent:${index}`),
    path: change.path,
    change,
    sourceNode: {
      id: `${id}:persistent:${index}`,
      type: 'condition' as const,
      resonatorId: 'res-a',
      changes: [change],
    },
  }))
  return [feature, ...persistent.reverse()]
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
    expect(cleanupCounts(plan)).toEqual({ inert: 2, dead: 2, redundant: 0, reordered: 0, detached: 0, total: 4 })
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

  it('keeps rows in switched-off blocks and removes those in switched-off loop markers', () => {
    const parked = planRotationCleanup(section([
      block('off', 'repeat', [step('inner', { kind: 'dead' })], { disabled: true }),
    ]))
    // a loop marker has no structural relation to the following body rows.
    const looped = planRotationCleanup(section([
      block('off-loop', 'loop', [step('inner', { kind: 'dead' })], { disabled: true }),
    ]))

    expect(parked.targets).toHaveLength(0)
    expect(looped.targets).toEqual([{ id: 'inner', reason: 'dead' }])
  })

  it('finds nothing in a tree the last run said nothing about', () => {
    const plan = planRotationCleanup(section([step('fresh'), condition('fresh-write')]))

    expect(plan.targets).toEqual([])
    expect(cleanupCounts(plan)).toEqual({ inert: 0, dead: 0, redundant: 0, reordered: 0, detached: 0, total: 0 })
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

  it('hoists matching persistent setters and removes the attached copies', () => {
    const sections = section(duplicateSetterPair('outro'))
    const inert = sections[0]?.children[1]
    if (inert?.type === 'condition') {
      sections[0]!.children[1] = { ...inert, gate: { kind: 'inert' } }
    }
    const plan = planRotationCleanup(sections)

    /* the setters move in front and the attached copies are dropped. a setter
       whose own write was a no-op is kept because it is the persistent condition. */
    expect(plan.targets).toEqual([
      { id: 'outro:persistent:1', reason: 'reordered', moveBeforeId: 'outro', detachFromIds: ['outro'] },
      { id: 'outro:persistent:0', reason: 'reordered', moveBeforeId: 'outro', detachFromIds: ['outro'] },
    ])
    const swept = applyRotationCleanup(sections, plan)[0]!.children
    expect(swept.map((node) => node.id)).toEqual([
      'outro:persistent:1', 'outro:persistent:0', 'outro',
    ])
    const feature = swept[2]
    expect(feature?.type === 'step' ? feature.changes : null).toBeUndefined()
    expect(feature?.type === 'step' ? feature.changesEdited : null).toBe(true)
    expect(sections[0]?.children.map((node) => node.id)).toEqual([
      'outro', 'outro:persistent:1', 'outro:persistent:0',
    ])
  })

  it('keeps local setters when the following writes differ or another node intervenes', () => {
    const unmatched = duplicateSetterPair('different')
    const altered = unmatched[1]
    if (altered?.type === 'condition') {
      const change: RtChng = { type: 'set', path: 'other', value: false, resonatorId: 'res-a' }
      unmatched[1] = {
        ...altered,
        change,
        sourceNode: { id: altered.id, type: 'condition', resonatorId: 'res-a', changes: [change] },
      }
    }
    /* the whole set no longer matches, so nothing is hoisted as a set. the
       setter that still repeats one attached copy moves in front on its own. */
    expect(planRotationCleanup(section(unmatched)).targets).toEqual([{
      id: 'different:persistent:0',
      reason: 'reordered',
      moveBeforeId: 'different',
      detachFromIds: ['different'],
    }])

    const interrupted = duplicateSetterPair('interrupted')
    interrupted.splice(1, 0, step('another-skill'))
    expect(planRotationCleanup(section(interrupted)).targets).toEqual([])
  })

  it('removes attached copies when matching persistent setters already precede the skill', () => {
    const [feature, ...setters] = duplicateSetterPair('pre-set')
    const sections = section([...setters, feature])
    const plan = planRotationCleanup(sections)
    expect(plan.targets).toEqual([{
      id: 'pre-set', reason: 'redundant',
      precedingConditionIds: ['pre-set:persistent:1', 'pre-set:persistent:0'],
    }])
    const swept = applyRotationCleanup(sections, plan)[0]!.children
    expect(swept.map((node) => node.id)).toEqual([
      'pre-set:persistent:1', 'pre-set:persistent:0', 'pre-set',
    ])
    expect(swept[2]?.type === 'step' ? swept[2].changes : null).toBeUndefined()
  })

  it('hoists duplicate setters in only the loop pass that contains them', () => {
    const runOne = duplicateSetterPair('outro')
    const runTwo = [runOne[0]!, step('other'), ...runOne.slice(1)]
    const loop = block('loop', 'loop', runOne, {
      loopId: 'loop-a', runs: 2, passTemplate: runOne, passForks: { 2: runTwo },
    })
    const plan = planRotationCleanup(section([loop]))
    const moved = (id: string) => ({
      id, reason: 'reordered', loopId: 'loop-a', run: 1, moveBeforeId: 'outro', detachFromIds: ['outro'],
    })
    expect(plan.targets).toEqual([moved('outro:persistent:1'), moved('outro:persistent:0')])
    const result = applyRotationCleanup(section([loop]), plan)[0]!.children[0]
    expect(result?.type).toBe('loop')
    if (result?.type !== 'loop') return
    const template = result.passTemplate ?? result.children
    expect(resolveEditorPassBody(template, result.passForks, 1).map((node) => node.id))
      .toEqual(['outro:persistent:1', 'outro:persistent:0', 'outro'])
    expect(resolveEditorPassBody(template, result.passForks, 2).map((node) => node.id))
      .toEqual(['outro', 'other', 'outro:persistent:1', 'outro:persistent:0'])
  })

  it('moves each setter below the skills that undo it and drops their attached copies', () => {
    /* snowforged 0, mist off, DMG-1 [snowforged 2, mist on], DMG-2 [snowforged 2] */
    const blade: RtChng = { type: 'set', path: 'blade', value: 0, resonatorId: 'res-a' }
    const mist: RtChng = { type: 'set', path: 'mist', value: false, resonatorId: 'res-a' }
    const setter = (id: string, change: RtChng, prior: boolean | number): EditorCondition => ({
      ...condition(id),
      path: change.path,
      change,
      prior: { value: prior },
      sourceNode: { id, type: 'condition', resonatorId: 'res-a', changes: [change] },
    })
    const skill = (id: string, changes: RtChng[]): EditorStep => ({
      ...step(id),
      changes,
      sourceNode: {
        id,
        type: 'feature',
        resonatorId: 'res-a',
        featureId: id,
        attached: {
          conditions: changes.map((change, index) => ({
            id: `${id}:attached:${index}`, type: 'condition' as const, resonatorId: 'res-a', changes: [change],
          })),
          features: [],
        },
      },
    })
    const sections = section([
      setter('blade-0', blade, 2),
      setter('mist-off', mist, true),
      skill('dmg-1', [{ ...blade, value: 2 }, { ...mist, value: true }]),
      skill('dmg-2', [{ ...blade, value: 2 }]),
      step('reads-both'),
    ])

    const plan = planRotationCleanup(sections)
    expect(plan.targets).toEqual([
      { id: 'blade-0', reason: 'reordered', moveAfterId: 'dmg-2', detachFromIds: ['dmg-1', 'dmg-2'] },
      { id: 'mist-off', reason: 'reordered', moveAfterId: 'dmg-1', detachFromIds: ['dmg-1'] },
    ])
    expect(cleanupCounts(plan)).toMatchObject({ reordered: 2, detached: 3 })

    const swept = applyRotationCleanup(sections, plan)[0]!.children
    expect(swept.map((node) => node.id)).toEqual(['dmg-1', 'mist-off', 'dmg-2', 'blade-0', 'reads-both'])
    for (const node of swept) {
      if (node.type === 'step') expect(node.changes).toBeUndefined()
    }
  })

  it('keeps a setter in place when the value it replaced is unknown', () => {
    const blade: RtChng = { type: 'set', path: 'blade', value: 0, resonatorId: 'res-a' }
    const setter: EditorCondition = {
      ...condition('blade-0'),
      path: 'blade',
      change: blade,
      sourceNode: { id: 'blade-0', type: 'condition', resonatorId: 'res-a', changes: [blade] },
    }
    const attached = { ...blade, value: 2 }
    const skill: EditorStep = {
      ...step('dmg-1'),
      changes: [attached],
      sourceNode: {
        id: 'dmg-1', type: 'feature', resonatorId: 'res-a', featureId: 'dmg-1',
        attached: { conditions: [{ id: 'a', type: 'condition', resonatorId: 'res-a', changes: [attached] }], features: [] },
      },
    }
    expect(planRotationCleanup(section([setter, skill])).targets).toEqual([])
  })

  it('retains distinct pass node ids when equivalent pass bodies are cleaned', () => {
    const first = duplicateSetterPair('outro-one')
    const second = duplicateSetterPair('outro-two')
    const loop = block('loop', 'loop', first, {
      loopId: 'loop-a', runs: 2, passTemplate: first, passForks: { 2: second },
    })
    const result = applyRotationCleanup(section([loop]), planRotationCleanup(section([loop])))
    const swept = result[0]?.children[0]
    expect(swept?.type).toBe('loop')
    if (swept?.type !== 'loop') return
    expect(Object.keys(swept.passForks ?? {})).toEqual(['2'])
    const template = swept.passTemplate ?? swept.children
    expect(resolveEditorPassBody(template, swept.passForks, 1).at(-1)?.id).toBe('outro-one')
    expect(resolveEditorPassBody(template, swept.passForks, 2).at(-1)?.id).toBe('outro-two')
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
