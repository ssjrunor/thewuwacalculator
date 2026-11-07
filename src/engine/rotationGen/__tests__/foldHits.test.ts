/*
  Author: Runor Ewhro
  description: checks feature grouping and hit-level condition preservation.
*/

import { describe, expect, it } from 'vitest'
import { foldHitRuns, foldRepeats } from '../editor/foldHits'
import type { RuntimeRecord } from '../types'

const sources = { '1': { source: {
  skills: [{ id: 's', hitTable: [{ count: 3 }, { count: 1 }] }],
  features: [
    { id: 'p', skillId: 's' },
    { id: 'p:hit:1', skillId: 's', variant: 'subHit', hitIndex: 0 },
    { id: 'p:hit:2', skillId: 's', variant: 'subHit', hitIndex: 1 },
  ],
} } }
const hit = (featureId: string, extra: RuntimeRecord = {}): RuntimeRecord => ({ type: 'feature', resonatorId: '1', enabled: true, multiplier: 1, featureId, ...extra })
const ids = (items: RuntimeRecord[]) => items.map(node => node.featureId ?? node.type)
const attached = (id: string, value = true) => ({ conditions: [{ id, type: 'condition', resonatorId: '1', enabled: true,
  changes: [{ type: 'set', path: 'runtime.state.controls.test:active', value, resonatorId: '1' }] }], features: [] })

describe('foldHitRuns', () => {
  it('shares identical scoped setters across all rows of one complete hit table', () => {
    const items = ['p:hit:1', 'p:hit:1', 'p:hit:1', 'p:hit:2'].map((id, index) => hit(id, { attached: attached(`local-${index}`) }))
    const result = foldHitRuns(items, sources)
    expect(ids(result.items)).toEqual(['p'])
    expect(result.items[0].attached).toEqual(items[0].attached)
    expect(items).toHaveLength(4)
  })

  it('keeps mixed hit states, attached attacks and authored annotations separate', () => {
    const items = ['p:hit:1', 'p:hit:1', 'p:hit:1', 'p:hit:2'].map((id, index) => hit(id, { attached: attached(`local-${index}`) }))
    expect(foldHitRuns(items.map((node, index) => index === 1 ? { ...node, attached: attached('different', false) } : node), sources).folded).toBe(0)
    const attack = { ...items[1], attached: { ...attached('child'), features: [hit('another')] } }
    expect(foldHitRuns([items[0], attack, ...items.slice(2)], sources).folded).toBe(0)
    const noted = structuredClone(items)
    Object.assign(noted[1].attached.conditions[0], { note: 'keep this explanation' })
    expect(foldHitRuns(noted, sources).folded).toBe(0)
    const plain = ['p:hit:1', 'p:hit:1', 'p:hit:1', 'p:hit:2'].map(id => hit(id))
    plain[1].label = 'Authored hit label'
    expect(foldHitRuns(plain, sources).folded).toBe(0)
  })
  it('folds an uninterrupted run that covers every hit into the parent', () => {
    const result = foldHitRuns([hit('p:hit:1'), hit('p:hit:1'), hit('p:hit:1'), hit('p:hit:2'), hit('p:hit:1')], sources)
    expect(ids(result.items)).toEqual(['p', 'p:hit:1'])
    expect(result.folded).toBe(3)
  })

  it('keeps explicit hits when the run is interrupted or partial', () => {
    const condition = { type: 'condition', changes: [] }
    expect(ids(foldHitRuns([hit('p:hit:1'), hit('p:hit:1'), condition, hit('p:hit:1'), hit('p:hit:2')], sources).items))
      .toEqual(['p:hit:1', 'p:hit:1', 'condition', 'p:hit:1', 'p:hit:2'])
    expect(ids(foldHitRuns([hit('p:hit:1'), hit('p:hit:1'), hit('p:hit:2'), hit('p:hit:2')], sources).items))
      .toEqual(['p:hit:1', 'p:hit:1', 'p:hit:2', 'p:hit:2'])
    expect(ids(foldHitRuns([hit('p:hit:1'), hit('p:hit:1', { multiplier: 0.5 }), hit('p:hit:1'), hit('p:hit:2')], sources).items))
      .toHaveLength(4)
  })
})

describe('foldRepeats', () => {
  it('combines repeated hits only when their local setter semantics match', () => {
    const result = foldRepeats([hit('a', { attached: attached('first') }), hit('a', { attached: attached('second') }),
      hit('a', { attached: attached('off', false) })])
    expect(result.items).toHaveLength(2)
    expect(result.items[0].multiplier).toBe(2)
    expect(result.items[0].attached.conditions[0].id).toBe('first')
  })
  const run = (items: Array<Record<string, unknown>>) => foldRepeats(items).items
    .map(node => node.type === 'feature' ? `${node.featureId}x${node.multiplier}` : String(node.type))

  it('folds back-to-back plays of one feature into its multiplier', () => {
    expect(run([hit('a'), hit('a'), hit('a', { multiplier: 0.5 }), hit('b'), hit('a')]))
      .toEqual(['ax2.5', 'bx1', 'ax1'])
  })

  it('stops at a condition, an owner change, a resume mark or an attachment', () => {
    const condition = { type: 'condition', changes: [] }
    expect(run([hit('a'), condition, hit('a')])).toEqual(['ax1', 'condition', 'ax1'])
    expect(run([hit('a'), hit('a', { resonatorId: '2' })])).toEqual(['ax1', 'ax1'])
    expect(run([hit('a'), hit('a', { offTuneResume: true }), hit('a')])).toEqual(['ax1', 'ax2'])
    expect(run([hit('a', { attached: {} }), hit('a')])).toEqual(['ax1', 'ax1'])
  })

  it('leaves the span after an unmarked Tune Break alone, where the seal counts nodes', () => {
    const tuneBreak = hit('damage:1:tune-break')
    expect(run([tuneBreak, hit('a'), hit('a')])).toEqual(['damage:1:tune-breakx1', 'ax1', 'ax1'])
    expect(run([tuneBreak, hit('a'), hit('a'), hit('b', { offTuneResume: true }), hit('b')]))
      .toEqual(['damage:1:tune-breakx1', 'ax2', 'bx2'])
  })
})
