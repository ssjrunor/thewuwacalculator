/*
  Author: Runor Ewhro
  description: the card registry's refusal summary for the health report: cards
               refused at their read in a window, counted per reason, the
               newest named with the uid read and where the read evidence is.
*/

import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { nodeSql } from '../src/board/sql.ts'
import { RegistryStore } from '../src/cards/registry.ts'

const READ_REFUSALS = ['uid_unreadable', 'unreadable', 'incomplete_build', 'read_failed']

function card(store: RegistryStore, n: number, now: number) {
  return store.record({ linkHash: `link-${n}`, contentType: 'image/jpeg', byteSize: 10, imageSha256: `sha-${n}`, lastModified: 1 }, now).card
}

describe('card registry refusals', () => {
  it('counts refused reads per reason since a time and names the newest', () => {
    const store = new RegistryStore(nodeSql(new DatabaseSync(':memory:')), 3)
    const old = card(store, 1, 10)
    store.setStatus(old.no, 'rejected', 'unreadable', 10)
    const misread = card(store, 2, 100)
    store.recordRead(misread.no, { parserVer: 'p1', outcome: 'uid_unreadable', uid: 500000001, resonator: null }, 100)
    store.setStatus(misread.no, 'rejected', 'uid_unreadable', 101)
    const failed = card(store, 3, 120)
    store.setStatus(failed.no, 'rejected', 'read_failed', 130)
    // refused for something other than its read, and a card that was read: neither is counted
    const suspended = card(store, 4, 140)
    store.setStatus(suspended.no, 'rejected', 'suspended', 140)
    const read = card(store, 5, 150)
    store.setPlaced(read.no, 500000002, 1108, '1108-1', 150)
    // an earlier refusal read again and refused again counts at its newest refusal
    store.setStatus(old.no, 'pending', null, 160)
    store.setStatus(old.no, 'rejected', 'unreadable', 170)

    const { counts, recent } = store.refusals(100, READ_REFUSALS, 2)
    expect(counts).toEqual({ unreadable: 1, uid_unreadable: 1, read_failed: 1 })
    expect(recent).toEqual([
      { id: old.id, reason: 'unreadable', at: 170, uid: null, evidence: null, imageKept: true },
      { id: failed.id, reason: 'read_failed', at: 130, uid: null, evidence: null, imageKept: true },
    ])
    expect(store.refusals(101, READ_REFUSALS, 5).recent.find((row) => row.id === misread.id))
      .toEqual({ id: misread.id, reason: 'uid_unreadable', at: 101, uid: 500000001, evidence: `reads/${misread.id}/p1.json`, imageKept: true })
  })
})
