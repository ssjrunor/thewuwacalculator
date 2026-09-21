/*
  Author: Runor Ewhro
  Description: Protects the duplication both surfaces share, which stands a
               copy of every named node directly after it.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { dupRotTms } from '../transforms.ts'

const row = (id: string): RotationNode => ({ id, type: 'feature', featureId: 'damage:test' })

const loopStart = (id: string, loopId: string): RotationNode =>
  ({ id, type: 'loop', kind: 'start', loopId, runs: 2 })

const loopEnd = (id: string, loopId: string): RotationNode =>
  ({ id, type: 'loop', kind: 'end', loopId })

describe('duplicating rotation nodes', () => {
  it('stands the copy directly after the node it came from', () => {
    const items = dupRotTms([row('a'), row('b')], new Set(['a']))

    expect(items).toHaveLength(3)
    expect(items[0].id).toBe('a')
    expect(items[1].id).not.toBe('a')
    expect(items[1]).toMatchObject({ type: 'feature', featureId: 'damage:test' })
    expect(items[2].id).toBe('b')
  })

  /* one node and a whole selection are the same call */
  it('takes as many as it is given, each after its own', () => {
    const items = dupRotTms([row('a'), row('b'), row('c')], new Set(['a', 'c']))

    expect(items.map((node) => node.id).filter((id) => ['a', 'b', 'c'].includes(id)))
      .toEqual(['a', 'b', 'c'])
    expect(items).toHaveLength(5)
    expect(items[1].id).not.toBe('a')
    expect(items[4].id).not.toBe('c')
  })

  it('reaches nodes held inside a block', () => {
    const repeat: RotationNode = {
      id: 'rep',
      type: 'repeat',
      times: 2,
      items: [row('inside')],
    }
    const [block] = dupRotTms([repeat], new Set(['inside']))

    expect(block.type === 'repeat' ? block.items.map((node) => node.id)[0] : null)
      .toBe('inside')
    expect(block.type === 'repeat' ? block.items : []).toHaveLength(2)
  })

  /*
    a loop's two markers share an identity. copied in one pass they are given
    one new name between them, so the copy is a loop of its own rather than a
    second pair of markers claiming the first loop's identity.
  */
  it('keeps a copied loop a pair, with an identity of its own', () => {
    const items = dupRotTms(
      [loopStart('start', 'loop-a'), row('inside'), loopEnd('end', 'loop-a')],
      new Set(['start', 'end']),
    )
    const loops = items.filter((node) => node.type === 'loop')

    expect(loops).toHaveLength(4)
    const copiedIds = new Set(loops.map((node) => node.type === 'loop' ? node.loopId : ''))
    expect(copiedIds.size).toBe(2)
    const copiedStart = loops[1]
    const copiedEnd = loops[3]
    expect(copiedStart.type === 'loop' ? copiedStart.loopId : null)
      .toBe(copiedEnd.type === 'loop' ? copiedEnd.loopId : undefined)
    expect(copiedStart.type === 'loop' ? copiedStart.loopId : null).not.toBe('loop-a')
  })

  it('deep-clones canonical pass forks with the copied loop', () => {
    const start: RotationNode = {
      id: 'start',
      type: 'loop',
      kind: 'start',
      loopId: 'loop-a',
      runs: 2,
      passForks: { '2': [{
        id: 'gated',
        type: 'feature',
        featureId: 'damage:test',
      }] },
    }
    const items = dupRotTms(
      [start, loopEnd('end', 'loop-a')],
      new Set(['start', 'end']),
    )
    const copiedStart = items.filter((node): node is Extract<
      RotationNode,
      { type: 'loop'; kind: 'start' }
    > => node.type === 'loop' && node.kind === 'start')[1]
    const copiedRow = copiedStart?.passForks?.['2']?.[0]

    expect(copiedStart?.loopId).not.toBe('loop-a')
    expect(copiedRow).toMatchObject({
      type: 'feature',
      featureId: 'damage:test',
    })
    expect(copiedRow?.id).not.toBe('gated')
  })

  it('leaves the list alone when nothing is named', () => {
    const items = [row('a'), row('b')]

    expect(dupRotTms(items, new Set())).toBe(items)
    expect(dupRotTms(items, new Set(['missing']))).toBe(items)
  })
})
