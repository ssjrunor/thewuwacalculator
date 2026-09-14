/*
  Author: Runor Ewhro
  Description: Verifies the selection.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type {
  EditorBlock,
  EditorCondition,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  buildEditorSelectionModel,
  buildFlatEditorSelectionModel,
  collectEditorVisualFoldIds,
} from '@/modules/simulation/features/rotation/program-editor/interaction/selection.ts'

function step(id: string): EditorStep {
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
  }
}

function condition(id: string): EditorCondition {
  return {
    type: 'condition',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    from: 'off',
    to: 'on',
    rising: true,
  }
}

function block(
  type: EditorBlock['type'],
  id: string,
  children: EditorBlock['children'],
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

function section(children: EditorSection['children']): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children }]
}

describe('rotation editor selection model', () => {
  it('collects every visual tree fold under its rendered fold id', () => {
    const conditions = [
      { ...condition('condition-a'), sourceIcon: '/source.webp', sourceName: 'Source' },
      { ...condition('condition-b'), sourceIcon: '/source.webp', sourceName: 'Source' },
    ]
    const repeated = block('repeat', 'repeat', [step('repeat-a'), step('repeat-b')])
    const wrapHead = block('loop', 'loop-wrap', [step('wrapped-child')], {
      loopId: 'loop-a',
      wrap: 'head',
      wrapOf: 'loop-tail',
    })
    const wrapTail = block('loop', 'loop-tail', [], {
      loopId: 'loop-a',
      wrap: 'tail',
    })

    expect([...collectEditorVisualFoldIds(section([
      ...conditions,
      repeated,
      wrapHead,
      wrapTail,
      step('owner-a'),
      step('owner-b'),
    ]))]).toEqual([
      'main',
      'repeat',
      'loop-tail',
      'condition-a',
      'repeat-a',
      'owner-a',
    ])
  })

  it('selects loop bodies but lets owning blocks represent their descendants', () => {
    const setup = block('setup', 'setup', [condition('setup-condition')])
    const uptime = block('uptime', 'uptime', [setup], { ratio: 1 })
    const repeat = block('repeat', 'repeat', [step('repeat-child')])
    const wrapHead = block('loop', 'loop-wrap', [step('head-child')], {
      loopId: 'loop-a',
      wrap: 'head',
      wrapOf: 'loop-tail',
    })
    const wrapTail = block('loop', 'loop-tail', [step('tail-child')], {
      loopId: 'loop-a',
      wrap: 'tail',
    })
    const model = buildEditorSelectionModel(
      section([uptime, repeat, wrapHead, wrapTail, step('root-step')]),
      new Set(),
    )

    expect(model.availableIds).toEqual([
      'uptime',
      'setup-condition',
      'repeat',
      'repeat-child',
      'head-child',
      'loop-tail',
      'tail-child',
      'root-step',
    ])
    expect(model.selectAllIds).toEqual([
      'uptime',
      'repeat',
      'head-child',
      'loop-tail',
      'tail-child',
      'root-step',
    ])
  })

  it('uses the rendered order and excludes rows hidden by either kind of fold', () => {
    const repeat = block('repeat', 'repeat', [step('repeat-child')])
    const sections = section([step('a'), step('b'), repeat])

    expect(buildEditorSelectionModel(
      sections,
      new Set(['a', 'repeat']),
    ).visibleIds).toEqual(['a', 'repeat'])

    expect(buildEditorSelectionModel(
      sections,
      new Set(['main']),
    ).visibleIds).toEqual([])
  })

  it('makes every traced block child selectable without selecting containers', () => {
    const repeat = block('repeat', 'repeat', [step('repeat-child')])
    const loop = block('loop', 'loop', [step('current-pass')], {
      runs: 2,
      checkedOutRun: 1,
      passTemplate: [step('current-pass')],
      passForks: { 2: [condition('fork-condition'), step('fork-step')] },
    })
    const model = buildFlatEditorSelectionModel(
      section([repeat, loop, step('root-step')]),
      ['repeat-child', 'fork-condition', 'fork-step', 'root-step'],
    )

    expect(model.availableIds).toEqual([
      'repeat-child',
      'fork-condition',
      'fork-step',
      'root-step',
    ])
    expect(model.selectAllIds).toEqual(model.availableIds)
    expect(model.availableIds).not.toContain('repeat')
    expect(model.availableIds).not.toContain('loop')
  })
})
