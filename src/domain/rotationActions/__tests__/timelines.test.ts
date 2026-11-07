/*
  Author: Runor Ewhro
  description: checks timeline frame deltas, string indices, and shared references.
*/

import { describe, expect, it } from 'vitest'
import { packTimeline, readTimeline, unpackTimeline } from '../timelines'
import type { ActionTimeline } from '../types'

const timeline: ActionTimeline = { seconds: 12.5, events: [
  [0, 'section', 0],
  [0, 'swap', 1],
  [4, 'cast', 1, 'Basic - Press 1', -1],
  [4, 'state', 1, 'Kit: Stance', 2, -1],
  [30, 'status', 1, 'glacioChafe', 3],
  [30, 'tick', 1, 'glacioChafe'],
  [31, 'heal', 0],
  [40, 'control', 'enemy.status.tuneStrain', 1],
  [40, 'cast', 1, 'Basic - Press 1', 0],
  [41, 'cast', 1, 'Basic - Press 1', 1, 0.25],
] }

describe('stored timelines', () => {
  it('pack to frame gaps and one string table, and read back unchanged', () => {
    const names: string[] = [], index = new Map<string, number>()
    const packed = packTimeline(timeline, names, index)
    expect(packed.events.every((event) => event.every((value) => typeof value === 'number'))).toBe(true)
    expect(packed.events.map((event) => event[0])).toEqual([0, 0, 4, 0, 26, 0, 1, 9, 0, 1])
    expect(names.filter((name) => name === 'Basic - Press 1')).toHaveLength(1)
    expect(unpackTimeline(packed, names)).toEqual(timeline)
  })

  it('follow a key that names another seat and sequence', () => {
    const names: string[] = []
    const runs = { '0:2': packTimeline(timeline, names, new Map()), '0:3': '0:2' }
    expect(readTimeline({ owns: {}, names, runs }, 0, 3)).toEqual(timeline)
    expect(readTimeline({ owns: {}, names, runs }, 0, 4)).toBeNull()
    expect(readTimeline(undefined, 0, 2)).toBeNull()
  })

  it('preserves the consumed resource identity and its source cast', () => {
    const names: string[] = []
    const source: ActionTimeline = { seconds: 1, events: [
      [5, 'consume', 0, 'Kit: Fuel', 40, 'Basic - Press 1'],
      [5, 'cast', 0, 'Basic - Press 1', -1],
    ] }
    expect(unpackTimeline(packTimeline(source, names, new Map()), names)).toEqual(source)
  })

  it('preserves per-hit control owners, exact event ordinals and typed values', () => {
    const names: string[] = []
    const source: ActionTimeline = { seconds: 1, events: [
      [5, 'hitControl', 1, 'Skill - Split', 2, 0, 'runtime.state.controls.team:1110:active', 'true'],
      [5, 'hitControl', 1, 'Skill - Split', 4, 1, 'runtime.state.controls.resonator:1410:wan_light:stacks', '0'],
      [5, 'cast', 1, 'Skill - Split', 2, null, [2, 4]],
    ] }
    expect(unpackTimeline(packTimeline(source, names, new Map()), names)).toEqual(source)
  })

  it('refuse a kind or string the table does not hold', () => {
    expect(() => unpackTimeline({ seconds: 1, events: [[0, 5, 0]] }, ['section'])).toThrow(/names no string/)
    expect(() => unpackTimeline({ seconds: 1, events: [[0, 0, 0]] }, ['dance'])).toThrow(/Unknown timeline event/)
  })
})
