/*
  Author: Runor Ewhro
  description: the board's keys and formats: packed snapshots round-trip field for field (key order too), q and
               buckets cover every score, and the id formats parse only what they print.
*/

import { describe, expect, it } from 'vitest'
import type { BuildSnapshot } from '@lb/contract/snapshot'
import { packSnapshot, snapshotEchoSets, unpackSnapshot } from '../../src/lib/snapshotPack.ts'
import { BUCKETS, bucketHigh, bucketLow, bucketOf, fromQ, toQ } from '../../src/lib/score.ts'
import { cardShardOf, formatBuildId, formatCardId, fromGbid, isSeedUid, LOCAL_SPAN, parseBuildId, parseCardId,
  SEED_LOCAL_FLOOR, toGbid, uidToInt, uidToText } from '../../src/lib/ids.ts'

const card: BuildSnapshot = {
  v: 1, gameVer: '3.8/beta', uid: '512345678', name: 'Rover',
  resonator: { id: '1512', level: 90, sequence: 2, skillLevels: { normalAttack: 1, resonanceLiberation: 10, forteCircuit: 7, introSkill: 6, resonanceSkill: 1 } },
  weapon: { id: '21030024', level: 90 },
  echoes: [
    { slot: 0, id: '6000060', set: 7, mainEcho: true, main: { primary: { key: 'critDmg', value: 44 }, secondary: { key: 'atkFlat', value: 150 } },
      substats: { hpFlat: 320, critDmg: 13.8, energyRegen: 10.8, resonanceLiberation: 7.9, defPercent: 10.9 } },
    { slot: 1, id: '390077024', set: 7, mainEcho: false, main: { primary: { key: 'energyRegen', value: 32 }, secondary: { key: 'atkFlat', value: 100 } },
      substats: { critRate: 10.5, atkPercent: 11.6 } },
  ],
}

// a deterministic random snapshot with odd shapes mixed in: unknown keys, text ids, nulls, floats, empty parts
function randomSnapshot(seed: number): BuildSnapshot {
  let state = seed >>> 0 || 1
  const next = () => (state = (state * 1_103_515_245 + 12_345) >>> 0) / 2 ** 32
  const pick = <T,>(items: T[]) => items[Math.floor(next() * items.length)]
  const value = () => pick([Math.round(next() * 500) / 10, Math.round(next() * 3000), next() * 100, 0, -1.5, 1e-7])
  const key = () => pick(['critRate', 'critDmg', 'atkFlat', 'healingBonus', 'havoc', 'someNewStat', 'élan'])
  const id = () => pick(['6000060', '390077024', '1', '0123', 'EchoX', '99999999999999'])
  return {
    v: 1, gameVer: pick(['3.8/beta', 'seed', '']), uid: pick(['512345678', '012345678', '000000001']), name: pick([null, '', 'Ünï 名前']),
    resonator: { id: pick(['1512', '1102', 'R-9']), level: pick([null, 90, 1, 0]), sequence: Math.floor(next() * 7),
      skillLevels: Object.fromEntries(pick([[], ['normalAttack'], ['introSkill', 'forteCircuit', 'newSkill']]).map((name) => [name, pick([null, 1, 10])])) },
    weapon: { id: id(), level: pick([null, 90, 2.5]) },
    echoes: Array.from({ length: Math.floor(next() * 6) }, (_, slot) => ({
      slot, id: id(), set: Math.floor(next() * 40), mainEcho: next() < 0.5,
      main: { primary: { key: key(), value: value() }, secondary: { key: key(), value: value() } },
      substats: Object.fromEntries(Array.from({ length: Math.floor(next() * 6) }, () => [key(), value()])),
    })),
  }
}

describe('packed snapshots', () => {
  it('round-trips a card exactly, in a fraction of the json size', () => {
    const packed = packSnapshot(card)
    expect(unpackSnapshot(packed)).toEqual(card)
    expect(JSON.stringify(unpackSnapshot(packed))).toBe(JSON.stringify(card))
    expect(packed.length).toBeLessThan(JSON.stringify(card).length / 4)
  })

  it('round-trips odd shapes through the escapes, key order included', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const snapshot = randomSnapshot(seed)
      expect(JSON.stringify(unpackSnapshot(packSnapshot(snapshot)))).toBe(JSON.stringify(snapshot))
    }
  })

  it('refuses truncated, padded and unknown input', () => {
    const packed = packSnapshot(card)
    expect(() => unpackSnapshot(packed.slice(0, -3))).toThrow(/truncated/)
    expect(() => unpackSnapshot(Uint8Array.from([...packed, 0]))).toThrow(/trailing/)
    expect(() => unpackSnapshot(Uint8Array.from([9, ...packed.slice(1)]))).toThrow(/format 9/)
  })

  it('lists echo ids and sets in card order', () => {
    expect(snapshotEchoSets(card)).toEqual([{ id: '6000060', set: 7 }, { id: '390077024', set: 7 }])
  })
})

describe('scores as q', () => {
  it('preserves the shown precision, so shown ties are q ties', () => {
    expect(toQ(99.76)).toBe(997_600)
    expect(fromQ(toQ(157.1234))).toBe(157.1234)
    expect(toQ(88.12344)).toBe(toQ(88.12341))
    // cut toward zero, never rounded up
    expect(toQ(99.99996)).toBe(999_999)
    expect(toQ(-1.23456)).toBe(-12_345)
    expect(() => toQ(Number.NaN)).toThrow()
  })

  it('puts every q in a bucket whose bounds contain it, with open-ended edges', () => {
    for (const q of [-5e9, -1_000_001, -1_000_000, -1, 0, 1, 997_600, 1_571_234, 3_193_343, 3_194_304, 9e9]) {
      const bucket = bucketOf(q)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(BUCKETS)
      expect(q).toBeGreaterThanOrEqual(bucketLow(bucket))
      expect(q).toBeLessThanOrEqual(bucketHigh(bucket))
    }
    for (let bucket = 1; bucket < BUCKETS; bucket += 1) expect(bucketLow(bucket)).toBe(bucketHigh(bucket - 1) + 1)
  })
})

describe('ids', () => {
  it('packs resonator and local into one safe integer and back', () => {
    for (const key of [{ resonator: 1102, local: 1 }, { resonator: 9999, local: LOCAL_SPAN - 1 }, { resonator: 1512, local: SEED_LOCAL_FLOOR + 5 }]) {
      const gbid = toGbid(key)
      expect(Number.isSafeInteger(gbid)).toBe(true)
      expect(fromGbid(gbid)).toEqual(key)
    }
    expect(() => toGbid({ resonator: 1102, local: 0 })).toThrow()
    expect(() => toGbid({ resonator: 10_000, local: 1 })).toThrow()
  })

  it('parses only the build and card ids it prints', () => {
    expect(formatBuildId({ resonator: 1506, local: 190_521 })).toBe('1506-4309')
    expect(parseBuildId('1506-4309')).toEqual({ resonator: 1506, local: 190_521 })
    for (const bad of ['1506-04309', '0506-1', '1506-0', '1506-', '1506-ABC', 'x-1', '1506-1-2', '15060-1']) expect(parseBuildId(bad)).toBeNull()
    expect(formatCardId({ shard: 10, no: 1234 })).toBe('a-ya')
    expect(parseCardId('a-ya')).toEqual({ shard: 10, no: 1234 })
    for (const bad of ['g-1', 'a-0', 'a-01', 'A-1', 'a1']) expect(parseCardId(bad)).toBeNull()
    expect(cardShardOf('f00d')).toBe(15)
  })

  it('stores uids as integers and prints them as 9 digits, seeds below the ceiling', () => {
    expect(uidToInt('512345678')).toBe(512_345_678)
    expect(uidToInt('012345678')).toBe(12_345_678)
    expect(uidToInt('12345678')).toBeNull()
    expect(uidToText(12_345_678)).toBe('012345678')
    expect(isSeedUid(12_345_678)).toBe(true)
    expect(isSeedUid(512_345_678)).toBe(false)
  })
})
