/*
  Author: Runor Ewhro
  description: the build diff matches echoes by what they are, not where they
               sit: a move is no change, a retune shows its stats, a different
               echo is a swap.
*/

import { describe, expect, it } from 'vitest'
import { diffBuilds } from '../buildDiff'
import type { BuildSnapshot, SnapshotEcho } from '../snapshot'

const echo = (slot: number, id: string, substats: Record<string, number>, over: Partial<SnapshotEcho> = {}): SnapshotEcho => ({
  slot, id, set: 1, mainEcho: slot === 0,
  main: { primary: { key: 'critRate', value: 22 }, secondary: { key: 'atkFlat', value: 150 } }, substats, ...over,
})

const build = (echoes: SnapshotEcho[], over: Partial<BuildSnapshot['resonator']> = {}, weapon = { id: 'w1', level: 90 }): BuildSnapshot => ({
  v: 1, gameVer: 't', uid: '1', name: null, resonator: { id: '1108', level: 90, sequence: 0, skillLevels: { normal: 10 }, ...over }, weapon, echoes,
})

describe('diffBuilds', () => {
  it('finds nothing between equal builds, or when echoes only change places', () => {
    const a = build([echo(0, 'e1', { critDmg: 14 }), echo(1, 'e2', { atkPercent: 9 })])
    const b = build([echo(0, 'e2', { atkPercent: 9 }, { mainEcho: false }), echo(1, 'e1', { critDmg: 14 }, { mainEcho: true })])
    expect(diffBuilds(a, a)).toEqual([])
    expect(diffBuilds(a, b)).toEqual([])
  })

  it('reports the resonator, the weapon and the skills first', () => {
    const a = build([])
    const b = build([], { sequence: 2, level: 80, skillLevels: { normal: 9, liberation: 10 } }, { id: 'w2', level: 90 })
    expect(diffBuilds(a, b)).toEqual([
      { kind: 'sequence', from: 0, to: 2 }, { kind: 'level', from: 90, to: 80 },
      { kind: 'weapon', from: { id: 'w1', level: 90 }, to: { id: 'w2', level: 90 } },
      { kind: 'skill', key: 'liberation', from: null, to: 10 }, { kind: 'skill', key: 'normal', from: 10, to: 9 },
    ])
  })

  it('tells a retuned echo from a swapped, an added and a removed one', () => {
    const a = build([echo(0, 'e1', { critDmg: 14 }), echo(1, 'e2', { atkPercent: 9 }), echo(2, 'e3', {})])
    const b = build([echo(0, 'e1', { critDmg: 21, critRate: 6.3 }), echo(1, 'e9', { atkPercent: 9 }), echo(3, 'e4', {}), echo(4, 'e5', {})])
    const changes = diffBuilds(a, b)
    expect(changes.map((change) => change.kind)).toEqual(['echo_tuned', 'echo_swapped', 'echo_swapped', 'echo_added'])
    expect(changes[0]).toMatchObject({ slot: 0, main: [], mainEcho: null,
      substats: [{ key: 'critDmg', from: 14, to: 21 }, { key: 'critRate', from: null, to: 6.3 }] })
    expect(changes[1]).toMatchObject({ slot: 1, from: { id: 'e2' }, to: { id: 'e9' } })
    expect(changes[2]).toMatchObject({ slot: 3, from: { id: 'e3' }, to: { id: 'e4' } })
    expect(diffBuilds(b, a).at(-1)).toMatchObject({ kind: 'echo_removed', echo: { id: 'e5' } })
  })

  it('treats a new main stat as a different echo', () => {
    const a = build([echo(0, 'e1', {})])
    const b = build([echo(0, 'e1', {}, { main: { primary: { key: 'critDmg', value: 44 }, secondary: { key: 'atkFlat', value: 150 } } })])
    expect(diffBuilds(a, b)).toMatchObject([{ kind: 'echo_swapped', slot: 0 }])
  })
})
