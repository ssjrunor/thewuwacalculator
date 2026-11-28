/*
  Author: Runor Ewhro
  description: checks that unknown gear retains readable stat lines without aliasing a known Sonata through the packed
               evaluation representation.
*/

import { describe, expect, it } from 'vitest'
import { encEchoRows } from '@/engine/search/encode/echoes'
import { utilityPlanFor } from '../echoDiscovery'
import type { EchoInstance } from '@/domain/entities/runtime'

const echo = (id: string, set: number): EchoInstance => ({ id, uid: id, set, mainEcho: false,
  mainStats: { primary: { key: 'atkPercent', value: 18 }, secondary: { key: 'hpFlat', value: 2280 } },
  substats: { critRate: 8.1 } })

describe('unknown evaluation gear', () => {
  it('does not reinterpret an unknown Sonata id as a known id after byte truncation', () => {
    const equipped = Array.from({ length: 5 }, (_, index) => echo(`unknown:${index}`, 263))
    expect(utilityPlanFor(equipped)).toEqual([])
    const encoded = encEchoRows(equipped, null as never)
    expect([...encoded.sets]).toEqual([0, 0, 0, 0, 0])
    expect([...encoded.stats].some(value => value > 0)).toBe(true)
  })

  it('leaves supported sets active while an unknown fifth piece contributes only its stats', () => {
    const equipped = Array.from({ length: 5 }, (_, index) => echo(String(index), index === 4 ? 263 : 7))
    expect(utilityPlanFor(equipped)).toEqual([])
    equipped[4].set = 7
    expect(utilityPlanFor(equipped)).toEqual([{ setId: 7, pieces: 5 }])
    expect([...encEchoRows(equipped, null as never).sets]).toEqual([7, 7, 7, 7, 7])
  })
})
