/*
  Author: Runor Ewhro
  description: boards on node:sqlite for tests: a store over an in-memory
               database, a small ruleset (three teams, two weapons), and a
               deterministic random source.
*/

import { DatabaseSync } from 'node:sqlite'
import { nodeSql } from '../../src/board/sql.ts'
import { BoardStore } from '../../src/board/store.ts'
import type { CellDef, PlayerFacts, RulesetInstall } from '../../src/board/types.ts'
import { packSnapshot } from '../../src/lib/snapshotPack.ts'
import type { BuildSnapshot } from '@lb/contract/snapshot'

export const RESONATOR = 1506

export function memoryBoard(resonator = RESONATOR) {
  const db = new DatabaseSync(':memory:')
  const sql = nodeSql(db)
  return { db, sql, store: new BoardStore(sql, resonator) }
}

/** a ruleset of every team with every weapon: cells numbered team-major. */
export function rulesetDef(rs: number, { teams = ['a', 'b', 'c'], weapons = [21010011, 21010012] } = {}): RulesetInstall {
  const cells: CellDef[] = []
  teams.forEach((team, teamRank) => weapons.forEach((weapon, weaponRank) => {
    cells.push({ cell: cells.length, key: `${RESONATOR}:${team}:${weapon}`, teamId: team, teamKey: team, teamRank, weaponId: weapon,
      weaponRank, weaponRole: weaponRank ? 'alt' : 'signature', members: [String(RESONATOR), '1102', '1205'] })
  }))
  return { rs, id: `rs-${rs}`, cells }
}

export function random(seed: number) {
  let state = seed >>> 0 || 1
  const next = () => (state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0) / 2 ** 32
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)],
  }
}

export function facts(uid: number, patch: Partial<PlayerFacts> = {}): PlayerFacts {
  return { uid, name: `p${uid}`, region: 5 + (uid % 5), hideUid: false, masked: false, unlisted: false, ver: 1, ...patch }
}

export function snapOf(uid: number, seq: number, salt: number): Uint8Array {
  const snapshot: BuildSnapshot = {
    v: 1, gameVer: 'test', uid: String(uid).padStart(9, '0'), name: null,
    resonator: { id: String(RESONATOR), level: 90, sequence: seq, skillLevels: {} },
    weapon: { id: '21010011', level: 90 },
    echoes: [0, 1, 2, 3, 4].map((slot) => ({ slot, id: String(6000000 + slot + salt * 10), set: (salt + (slot < 3 ? 0 : 1)) % 4,
      mainEcho: slot === 0, main: { primary: { key: 'critDmg', value: 44 }, secondary: { key: 'atkFlat', value: 150 } }, substats: {} })),
  }
  return packSnapshot(snapshot)
}
