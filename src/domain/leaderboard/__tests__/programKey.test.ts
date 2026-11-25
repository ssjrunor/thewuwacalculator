/*
  Author: Runor Ewhro
  description: the program key of a scored seat's echoes, and the board's
               grouping text built on it: the main echo (flagged, else the
               first slot's), distinct pieces per set, and the summed tune
               break boost; nothing else about the echoes.
*/

import { describe, expect, it } from 'vitest'
import { programEchoKey, snapshotProgramKey, type KeyEcho } from '@/domain/leaderboard/programKey'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'

const echo = (id: string, set: number, patch: Partial<KeyEcho> = {}): KeyEcho => ({ id, set, mainEcho: false,
  stats: [{ key: 'critDmg', value: 44 }, { key: 'atkFlat', value: 150 }], substats: { critRate: 8.1 }, ...patch })

function snapshot(patch: (snap: BuildSnapshot) => void = () => undefined): BuildSnapshot {
  const snap: BuildSnapshot = { v: 1, gameVer: 'test', uid: '600000001', name: null,
    resonator: { id: '1506', level: 90, sequence: 0, skillLevels: {} }, weapon: { id: '21050046', level: 90 },
    echoes: [0, 1, 2, 3, 4].map((slot) => ({ slot, id: String(6000040 + slot), set: slot < 3 ? 7 : 9, mainEcho: slot === 0,
      main: { primary: { key: 'critDmg', value: 44 }, secondary: { key: 'atkFlat', value: 150 } }, substats: { critRate: 6.3 + slot } })) }
  patch(snap)
  return snap
}

describe('program keys', () => {
  it('reads the main echo, distinct pieces per set and tune break boost', () => {
    expect(programEchoKey([echo('1', 7, { mainEcho: true }), echo('2', 7), echo('2', 7), null, echo('3', 9,
      { stats: [{ key: 'tuneBreakBoost', value: 2 }, null], substats: { tuneBreakBoost: 1.5 } })]))
      .toEqual({ main: { id: '1', flagged: true }, sets: [['7', 2], ['9', 1]], tuneBreakBoost: 3.5 })
    // no flagged echo: the first slot's, marked as a fallback; an empty first slot falls to the first equipped.
    expect(programEchoKey([echo('5', 7), echo('6', 7)]).main).toEqual({ id: '5', flagged: false })
    expect(programEchoKey([null, echo('6', 7)]).main).toEqual({ id: '6', flagged: false })
    expect(programEchoKey([null, null]).main).toBeNull()
  })

  it('groups snapshots by form, sequence and echo key, and keeps an unshared one whole', () => {
    const base = snapshotProgramKey(snapshot(), true)
    expect(base).toBe('1506|0|6000040|7x3,9x2|0')
    expect(snapshotProgramKey(snapshot((snap) => { snap.echoes[2].substats = { critDmg: 21 }; snap.uid = '600000002' }), true)).toBe(base)
    expect(snapshotProgramKey(snapshot((snap) => { snap.resonator.sequence = 2 }), true)).not.toBe(base)
    expect(snapshotProgramKey(snapshot((snap) => { snap.echoes[0].mainEcho = false }), true)).toBe('1506|0|6000040?|7x3,9x2|0')
    expect(snapshotProgramKey(snapshot((snap) => { snap.echoes[4].substats = { tuneBreakBoost: 3 } }), true)).toBe('1506|0|6000040|7x3,9x2|3')
    // unshared: any echo change is another group, in whatever order the snapshot lists its slots.
    const whole = snapshotProgramKey(snapshot(), false)
    expect(snapshotProgramKey(snapshot((snap) => { snap.echoes.reverse() }), false)).toBe(whole)
    expect(snapshotProgramKey(snapshot((snap) => { snap.echoes[2].substats = { critDmg: 21 } }), false)).not.toBe(whole)
  })
})
