/*
  Author: Runor Ewhro
  Description: Verifies standing condition values across scopes, loop passes,
               handoffs, authored writes, and runtime fallbacks.
*/

import { describe, expect, it } from 'vitest'
import type { RuntimeValue, SourceState } from '@/domain/gameData/contracts.ts'
import type {
  EditorCondition,
  EditorNode,
  EditorSection,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import {
  seedCondValueFor,
  standingCondValue,
  type CondSeedContext,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/priorState.ts'
import type { CondChoice } from '@/modules/simulation/surfaces/rotation/shared/authoringTypes.ts'
import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'

const STACKS: SourceState = {
  id: 'stacks',
  label: 'Wind Zone',
  source: { type: 'weapon', id: '21010013' },
  ownerKey: 'weapon:21010013:passive',
  controlKey: 'weapon:21010013:passive:stacks',
  path: 'runtime.state.controls.weapon:21010013:passive:stacks',
  kind: 'stack',
  defaultValue: 0,
  min: 0,
  max: 5,
}

const TOGGLE: SourceState = {
  id: 'buff',
  label: 'ATK Buff',
  source: { type: 'weapon', id: '21010013' },
  ownerKey: 'weapon:21010013:passive',
  controlKey: 'weapon:21010013:passive:active',
  path: 'runtime.state.controls.weapon:21010013:passive:active',
  kind: 'toggle',
  defaultValue: false,
}

const MODE: SourceState = {
  id: 'mode',
  label: 'Resonance Mode',
  source: { type: 'resonator', id: '1109' },
  ownerKey: 'resonator:1109:mode',
  controlKey: 'resonator:1109:mode:value',
  path: 'runtime.state.controls.resonator:1109:mode:value',
  kind: 'select',
  defaultValue: 'aero',
  maxValue: 'glacio',
  options: [
    { id: 'aero', label: 'Aero' },
    { id: 'glacio', label: 'Glacio' },
  ],
}

const ACTIVE: SourceState = {
  id: 'rotation:active-resonator',
  label: 'Active Resonator',
  source: { type: 'resonator', id: 'res-a' },
  ownerKey: 'rotation:active',
  controlKey: 'rotation.activeResonatorId',
  path: ACTIVE_RESONATOR_PATH,
  kind: 'select',
  defaultValue: 'res-a',
  options: [
    { id: 'res-a', label: 'Resonator A' },
    { id: 'res-b', label: 'Resonator B' },
    { id: 'res-c', label: 'Resonator C' },
  ],
}

function activeChoice(): CondChoice {
  return {
    id: 'rotation:active-resonator',
    resonatorId: 'rotation',
    resName: 'Rotation',
    sourceName: 'Overrides',
    label: 'Active Resonator',
    state: ACTIVE,
    changeTarget: 'rotation',
  }
}

function handoff(id: string, from: string, to: string): EditorNode {
  return { type: 'swap', id, from, to }
}

function choiceFor(state: SourceState, resonatorId = 'res-a'): CondChoice {
  return {
    id: `${resonatorId}:${state.controlKey}`,
    resonatorId,
    resName: 'Resonator A',
    sourceName: 'Weapon',
    label: state.label,
    state,
  }
}

function condition(
  id: string,
  state: SourceState,
  memberId: string,
  writeValue: RuntimeValue,
  writeAction: 'set' | 'add' = 'set',
): EditorCondition {
  return {
    type: 'condition',
    id,
    owner: { kind: 'member', memberId },
    label: state.label,
    path: state.path,
    state,
    to: String(writeValue),
    writeValue,
    writeAction,
    rising: true,
  }
}

function step(id: string, memberId: string): EditorNode {
  return {
    type: 'step',
    id,
    owner: { kind: 'member', memberId },
    label: 'Heavy Attack',
    index: 0,
    memberId,
    kindLabel: 'skill',
    multiplier: 1,
    damageByRun: {},
    statsByRun: {},
    buffCount: 0,
  }
}

function sections(children: EditorNode[]): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children }]
}

function context(children: EditorNode[], anchor: CondSeedContext['anchor']): CondSeedContext {
  return { sections: sections(children), anchor }
}

describe('standing state at the point a condition is added', () => {
  it('reads the authored default when nothing has written the state', () => {
    expect(standingCondValue(
      choiceFor(STACKS),
      context([step('s1', 'res-a')], { kind: 'end' }),
    )).toBe(0)
  })

  it('carries the last write before the anchor', () => {
    const children = [
      condition('c1', STACKS, 'res-a', 2),
      step('s1', 'res-a'),
    ]

    expect(standingCondValue(
      choiceFor(STACKS),
      context(children, { kind: 'after', id: 's1' }),
    )).toBe(2)
  })

  it('ignores writes that come after the anchor', () => {
    const children = [
      step('s1', 'res-a'),
      condition('c1', STACKS, 'res-a', 4),
    ]

    expect(standingCondValue(
      choiceFor(STACKS),
      context(children, { kind: 'after', id: 's1' }),
    )).toBe(0)
  })

  it('stops before the anchor node on a before-edge drop', () => {
    const children = [
      condition('c1', STACKS, 'res-a', 3),
      step('s1', 'res-a'),
    ]

    expect(standingCondValue(
      choiceFor(STACKS),
      context(children, { kind: 'before', id: 'c1' }),
    )).toBe(0)
  })

  it('accumulates an add on top of the standing value', () => {
    const children = [
      condition('c1', STACKS, 'res-a', 1),
      condition('c2', STACKS, 'res-a', 2, 'add'),
    ]

    expect(standingCondValue(
      choiceFor(STACKS),
      context(children, { kind: 'end' }),
    )).toBe(3)
  })

  it('walks into blocks in document order', () => {
    const children: EditorNode[] = [
      {
        type: 'repeat',
        id: 'b1',
        owner: { kind: 'member', memberId: 'res-a' },
        label: 'Repeat',
        runs: 2,
        nodeCount: 1,
        children: [condition('c1', STACKS, 'res-a', 4)],
      },
      step('s1', 'res-a'),
    ]

    expect(standingCondValue(
      choiceFor(STACKS),
      context(children, { kind: 'after', id: 's1' }),
    )).toBe(4)
  })

  it('does not read a teammate write on a shared weapon path', () => {
    const children = [condition('c1', STACKS, 'res-b', 5)]

    expect(standingCondValue(
      choiceFor(STACKS),
      context(children, { kind: 'end' }),
    )).toBe(0)
  })

  it('prefers the last run recorded by simulation over the authored write', () => {
    const children = [condition('c1', STACKS, 'res-a', 2, 'add')]

    expect(standingCondValue(choiceFor(STACKS), {
      ...context(children, { kind: 'end' }),
      // the loop ran the add twice and the engine clamped it
      history: new Map([[STACKS.path, [
        { nodeId: 'c1', run: 1, to: '2' },
        { nodeId: 'c1', run: 2, to: '5' },
      ]]]),
    })).toBe(5)
  })
})

describe('the write a newly added condition opens on', () => {
  it('turns a toggle on when it is off', () => {
    expect(seedCondValueFor(
      choiceFor(TOGGLE),
      context([], { kind: 'end' }),
    )).toBe(true)
  })

  it('sends a stack at zero to its max', () => {
    expect(seedCondValueFor(
      choiceFor(STACKS),
      context([], { kind: 'end' }),
    )).toBe(5)
  })

  it('carries a standing stack value forward instead of the default', () => {
    const children = [condition('c1', STACKS, 'res-a', 3)]

    expect(seedCondValueFor(
      choiceFor(STACKS),
      context(children, { kind: 'end' }),
    )).toBe(3)
  })

  it('sends a stack back to max once something zeroed it', () => {
    const children = [
      condition('c1', STACKS, 'res-a', 3),
      condition('c2', STACKS, 'res-a', 0),
    ]

    expect(seedCondValueFor(
      choiceFor(STACKS),
      context(children, { kind: 'end' }),
    )).toBe(5)
  })

  it('opens a select on the named max only while it is unset', () => {
    expect(seedCondValueFor(
      choiceFor({ ...MODE, defaultValue: '' }),
      context([], { kind: 'end' }),
    )).toBe('glacio')

    expect(seedCondValueFor(
      choiceFor(MODE),
      context([], { kind: 'end' }),
    )).toBe('aero')
  })

  it('leaves a toggle that is already on to the authored default', () => {
    const children = [condition('c1', TOGGLE, 'res-a', true)]

    expect(seedCondValueFor(
      choiceFor(TOGGLE),
      context(children, { kind: 'end' }),
    )).toBe(false)
  })
})

describe('the member a newly added handoff takes the field for', () => {
  it('steps back off whoever the rotation opens on', () => {
    expect(seedCondValueFor(
      activeChoice(),
      context([step('s1', 'res-a')], { kind: 'end' }),
    )).toBe('res-c')
  })

  it('steps back off the last handoff before the anchor', () => {
    const children = [
      handoff('h1', 'res-a', 'res-c'),
      step('s1', 'res-c'),
    ]

    expect(seedCondValueFor(
      activeChoice(),
      context(children, { kind: 'after', id: 's1' }),
    )).toBe('res-b')
  })

  it('wraps past the first member back to the last', () => {
    const children = [
      handoff('h1', 'res-a', 'res-c'),
      handoff('h2', 'res-c', 'res-b'),
      handoff('h3', 'res-b', 'res-a'),
    ]

    expect(seedCondValueFor(
      activeChoice(),
      context(children, { kind: 'end' }),
    )).toBe('res-c')
  })

  it('does not read a handoff that comes after the anchor', () => {
    const children = [
      step('s1', 'res-a'),
      handoff('h1', 'res-a', 'res-b'),
    ]

    expect(seedCondValueFor(
      activeChoice(),
      context(children, { kind: 'after', id: 's1' }),
    )).toBe('res-c')
  })

  it('normalizes a missing handoff member to the current rotation owner', () => {
    expect(standingCondValue(
      activeChoice(),
      context([handoff('stale', 'res-a', 'missing-member')], { kind: 'end' }),
    )).toBe('res-a')
  })

  it('reads a handoff still authored as a plain condition', () => {
    const children = [condition('c1', ACTIVE, 'res-a', 'res-b')]

    expect(seedCondValueFor(
      activeChoice(),
      context(children, { kind: 'end' }),
    )).toBe('res-a')
  })
})
