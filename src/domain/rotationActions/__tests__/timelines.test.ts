/*
  Author: Runor Ewhro
  description: checks timeline frame deltas, string indices, and shared references.
*/

import { describe, expect, it } from 'vitest'
import { deduplicateTimelines, packTimeline, readTimeline, unpackTimeline } from '../timelines'
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
  it('preserves captured hit offsets alongside the exact landed event selection', () => {
    const names: string[] = []
    const source: ActionTimeline = { seconds: 4, events: [
      [5, 'cast', 1, 'Skill - Split', 2, null, [0, 2], [0, 186]],
    ] }
    expect(unpackTimeline(packTimeline(source, names, new Map()), names)).toEqual(source)
  })

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

  it('shares identical results across source sequences while preserving different clocks and event order', () => {
    const names: string[] = []
    const packed = packTimeline(timeline, names, new Map())
    const original = { owns: {}, names, runs: {
      '0:0': packed, '1:2': structuredClone(packed),
      '1:3': { ...packed, seconds: 13 },
      '1:4': { ...packed, events: [...packed.events].reverse() },
    } }
    const compacted = deduplicateTimelines(original)
    expect(compacted.runs['1:2']).toBe('0:0')
    expect(typeof compacted.runs['1:3']).toBe('object')
    expect(typeof compacted.runs['1:4']).toBe('object')
    for (const key of Object.keys(original.runs)) {
      const [seat, sequence] = key.split(':').map(Number)
      expect(readTimeline(compacted, seat, sequence)).toEqual(readTimeline(original, seat, sequence))
    }
    expect(typeof original.runs['1:2']).toBe('object')
  })

  it('flattens forward references when an existing concrete target becomes shared and stays idempotent', () => {
    const names: string[] = []
    const packed = packTimeline(timeline, names, new Map())
    const original = { owns: {}, names, runs: {
      '0:0': '0:2', '0:1': structuredClone(packed), '0:2': packed, '1:0': '0:2',
    } }
    const compacted = deduplicateTimelines(original)
    expect(compacted.runs).toEqual({ '0:0': packed, '0:1': '0:0', '0:2': '0:0', '1:0': '0:0' })
    for (const key of Object.keys(original.runs)) {
      const [seat, sequence] = key.split(':').map(Number)
      expect(readTimeline(compacted, seat, sequence)).toEqual(readTimeline(original, seat, sequence))
    }
    expect(deduplicateTimelines(compacted)).toEqual(compacted)
  })

  it('rejects missing or chained reference targets', () => {
    expect(() => deduplicateTimelines({ owns: {}, names: [], runs: { '0:0': 'missing' } })).toThrow('concrete target')
    expect(() => deduplicateTimelines({ owns: {}, names: [], runs: { '0:0': '0:1', '0:1': '0:2',
      '0:2': { seconds: 1, events: [] } } })).toThrow('concrete target')
  })

  it('preserves the consumed resource identity and its source cast', () => {
    const names: string[] = []
    const source: ActionTimeline = { seconds: 1, events: [
      [5, 'consume', 0, 'Kit: Fuel', 40, 'Basic - Press 1'],
      [5, 'cast', 0, 'Basic - Press 1', -1],
    ] }
    expect(unpackTimeline(packTimeline(source, names, new Map()), names)).toEqual(source)
  })

  it('preserves hit-local stack counts independently of persistent status updates', () => {
    const names: string[] = []
    const source: ActionTimeline = { seconds: 1, events: [
      [0, 'status', 0, 'spectroFrazzle', 0],
      [5, 'tick', 0, 'spectroFrazzle', 2], [5, 'tick', 0, 'spectroFrazzle', 1],
    ] }
    expect(unpackTimeline(packTimeline(source, names, new Map()), names)).toEqual(source)
  })

  it('preserves per-hit control owners, exact event ordinals and typed values', () => {
    const names: string[] = []
    const source: ActionTimeline = { seconds: 1, events: [
      [5, 'hitInfliction', 1, 'Skill - Split', 0, 1, 'aeroErosion', 4],
      [5, 'hitControl', 1, 'Skill - Split', 2, 0, 'runtime.state.controls.team:1110:active', 'true'],
      [5, 'hitControl', 1, 'Skill - Split', 4, 1, 'runtime.state.controls.resonator:1410:wan_light:stacks', '0'],
      [5, 'cast', 1, 'Skill - Split', 2, null, [2, 4]],
    ] }
    expect(unpackTimeline(packTimeline(source, names, new Map()), names)).toEqual(source)
  })

  it('refuse a kind or string the table does not contain', () => {
    expect(() => unpackTimeline({ seconds: 1, events: [[0, 5, 0]] }, ['section'])).toThrow(/names no string/)
    expect(() => unpackTimeline({ seconds: 1, events: [[0, 0, 0]] }, ['dance'])).toThrow(/Unknown timeline event/)
  })
})
