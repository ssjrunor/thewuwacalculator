/*
  Author: Runor Ewhro
  Description: Protects the reading that decides how a loop drawn in two pieces
               is drawn, which only document order can tell apart.
*/

import { describe, expect, it } from 'vitest'
import type {
  EditorBlock,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  computeLoopCrossings,
  DEFAULT_STAT_KEYS,
  EMPTY_STATS,
  factorAt,
  formatDamage,
  fmtStat,
  fmtStatHeading,
  loopBodyItems,
  stepCount,
} from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'

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

function segment(
  id: string,
  wrap: 'head' | 'middle' | 'tail' | undefined,
  children: EditorBlock['children'],
): EditorBlock {
  return {
    type: 'loop',
    id,
    loopId: 'loop-a',
    ...(wrap ? { wrap } : {}),
    ...(wrap === 'head' || wrap === 'middle' ? { wrapOf: 'loop-start' } : {}),
    owner: { kind: 'member', memberId: 'res-a' },
    label: 'Loop',
    runs: 2,
    nodeCount: children.length,
    children,
  }
}

function repeat(id: string, children: EditorBlock['children']): EditorBlock {
  return {
    type: 'repeat',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: 'Repeat',
    runs: 3,
    nodeCount: children.length,
    children,
  }
}

function section(children: EditorSection['children']): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children }]
}

describe('skill register factors', () => {
  it('reads the resolved skill multiplier instead of the rotation action count', () => {
    const row: EditorStep = {
      ...step('factor'),
      multiplier: 4,
      multiplierByRun: { 1: 4 },
      statsByRun: {
        1: { ...EMPTY_STATS, multiplier: 2.75 },
      },
    }

    expect(factorAt(row, 1, 'multiplier')).toBe(2.75)
  })
})

describe('telling a crossing loop from one that comes back around', () => {
  it('reads a loop closing inside a later block as a crossing, one level in', () => {
    const crossings = computeLoopCrossings(section([
      segment('loop-start', 'tail', [step('inside')]),
      repeat('repeat', [
        segment('loop-start:segment:1', 'head', [step('nested')]),
        step('after'),
      ]),
    ]))

    expect(crossings.get('loop-start:segment:1')).toBe(1)
    // the piece holding the start is in too: it has to leave its foot open
    expect(crossings.get('loop-start')).toBe(0)
  })

  it('counts a level for every block the loop closes down through', () => {
    const crossings = computeLoopCrossings(section([
      segment('loop-start', 'tail', [step('inside')]),
      repeat('outer', [
        segment('loop-start:segment:1', 'middle', [step('mid')]),
        repeat('inner', [segment('loop-start:segment:2', 'head', [step('deep')])]),
      ]),
    ]))

    expect(crossings.get('loop-start:segment:1')).toBe(1)
    expect(crossings.get('loop-start:segment:2')).toBe(2)
  })

  /*
    a loop that runs back to its own start reaches its continuation before it
    reaches its start, because the continuation is the tail of the body sat
    above the marker. that shape keeps the wrap drawing, seams and all.
  */
  it('leaves a loop that runs back around alone', () => {
    const crossings = computeLoopCrossings(section([
      segment('loop-start:wrap', 'head', [step('above')]),
      segment('loop-start', 'tail', [step('below')]),
    ]))

    expect(crossings.size).toBe(0)
  })

  it('leaves a plain nested loop alone', () => {
    const crossings = computeLoopCrossings(section([
      repeat('repeat', [segment('loop-start', undefined, [step('inside')])]),
    ]))

    expect(crossings.size).toBe(0)
  })
})

function otherLoop(id: string, children: EditorBlock['children']): EditorBlock {
  return {
    type: 'loop',
    id,
    loopId: 'loop-b',
    owner: { kind: 'member', memberId: 'res-a' },
    label: 'Loop B',
    runs: 3,
    nodeCount: children.length,
    children,
  }
}

describe('what a loop runs', () => {

  it('reads a loop crossing into another loop as call and return', () => {
    const body = loopBodyItems(section([
      segment('a-start', 'tail', [step('a-row')]),
      otherLoop('b-start', [
        segment('a-start:segment:1', 'head', [step('b-row')]),
        step('b-after'),
      ]),
      step('root-after'),
    ]), 'loop-a')

    expect(body.map((node) => node.id)).toEqual(['a-row', 'b-start', 'b-row'])
    // The crossing counts A once, B's two entries, and B once on return.
    expect(stepCount(body)).toBe(4)
  })

  it('reads a loop crossing into a block the same way', () => {
    const body = loopBodyItems(section([
      segment('a-start', 'tail', [step('a-row')]),
      repeat('rep', [
        segment('a-start:segment:1', 'head', [step('r-row')]),
        step('r-after'),
      ]),
    ]), 'loop-a')

    expect(body.map((node) => node.id)).toEqual(['a-row', 'rep', 'r-row'])
  })

  it('reads a loop that runs back around from its start, not from the top', () => {
    const body = loopBodyItems(section([
      segment('a-start:wrap', 'head', [step('above')]),
      segment('a-start', 'tail', [step('below')]),
    ]), 'loop-a')

    expect(body.map((node) => node.id)).toEqual(['below', 'above'])
  })

  it('leaves a loop drawn in one piece with the rows it holds', () => {
    const body = loopBodyItems(section([
      segment('a-start', undefined, [step('one'), step('two')]),
      step('outside'),
    ]), 'loop-a')

    expect(body.map((node) => node.id)).toEqual(['one', 'two'])
  })
})

describe('formatDamage', () => {
  it('uses the requested fixed precision instead of cutting a value short', () => {
    expect(formatDamage(12345.6789, 3)).toBe('12,345.679')
    expect(formatDamage(12345.6789, 0)).toBe('12,346')
    expect(formatDamage(12345.6789, 1)).toBe('12,345.7')
    expect(formatDamage(12345.6789, 4)).toBe('12,345.6789')
  })

  it('keeps zeroes through the configured decimal place', () => {
    expect(formatDamage(12345, 3)).toBe('12,345.000')
    expect(formatDamage(12345.5, 3)).toBe('12,345.500')
    expect(formatDamage(12345.0004, 3)).toBe('12,345.000')
  })

  it('rounds the final requested place', () => {
    expect(formatDamage(8.115, 2)).toBe('8.12')
    expect(formatDamage(1.005, 2)).toBe('1.01')
    expect(formatDamage(-12345.6789, 2)).toBe('-12,345.68')
  })
})

describe('fmtStat', () => {
  it('opens with twelve columns', () => {
    expect(DEFAULT_STAT_KEYS).toEqual([
      'normal',
      'crit',
      'skillType',
      'talentNode',
      'multiplier',
      'atk',
      'hp',
      'def',
      'critRate',
      'critDmg',
      'bonus',
      'amplify',
    ])
  })

  it('reads evaluated damage and skill metadata columns from the row', () => {
    const row = {
      ...step('damage'),
      normalDamageByRun: { 1: 125.5 },
      critDamageByRun: { 1: 250.25 },
      skillTypeLabel: 'Basic Attack',
      talentNodeLabel: 'Normal Attack',
      element: 'fusion' as const,
    }

    expect(factorAt(row, 1, 'normal')).toBe(125.5)
    expect(factorAt(row, 1, 'crit')).toBe(250.25)
    expect(factorAt(row, 1, 'skillType')).toBe('Basic Attack')
    expect(factorAt(row, 1, 'talentNode')).toBe('Normal Attack')
    expect(factorAt(row, 1, 'attribute')).toBe('Fusion')
    expect(fmtStat('Basic Attack', 'skillType', 2, 'percent')).toBe('Basic Attack')
    expect(factorAt({ ...row, aggregationType: 'healing' }, 1, 'attribute')).toBe('-')
  })

  it('uses the same configured precision as damage cells for absolute stats', () => {
    expect(fmtStat(12345, 'atk', 3, 'percent')).toBe('12,345.000')
    expect(fmtStat(7.1259, 'flatDmg', 2, 'factor')).toBe('7.13')
    expect(fmtStat(null, 'hp', 3, 'percent')).toBe('-')
  })

  it('states every multiplicative stat in the selected unit', () => {
    expect(fmtStat(0.42, 'multiplier', 3, 'percent')).toBe('42.000')
    expect(fmtStat(0.42, 'multiplier', 3, 'factor')).toBe('0.420')

    const percentagePointKeys = [
      'critRate',
      'critDmg',
      'bonus',
      'amplify',
      'energyRegen',
      'defIgnore',
      'defShred',
      'resistance',
      'dmgVuln',
      'tuneBreakBoost',
      'finalDmg',
    ] as const

    for (const key of percentagePointKeys) {
      expect(fmtStat(150, key, 3, 'percent')).toBe('150.000')
      expect(fmtStat(150, key, 3, 'factor')).toBe('1.500')
    }
  })

  it('states percentage units on the column header rather than every cell', () => {
    expect(fmtStatHeading('multiplier', 'percent')).toBe('MV%')
    expect(fmtStatHeading('critDmg', 'percent')).toBe('CD%')
    expect(fmtStatHeading('critDmg', 'factor')).toBe('CD')
    expect(fmtStatHeading('atk', 'percent')).toBe('ATK')
  })
})
