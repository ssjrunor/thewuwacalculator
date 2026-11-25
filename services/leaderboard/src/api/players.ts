/*
  Author: Runor Ewhro
  description: syncs player facts to the boards. D1 stores the player; each
               board stores a copy of the fields that affect how builds list
               (server, hidden uid, anonymous or setup, opted out or banned),
               ordered by players.ver. a change is written to D1 with a ver bump
               (db/identity.ts) and sent to every board with the player's builds,
               and boards ignore copies older than their own.
*/

import type { ApiEnv } from '../env.ts'
import { isMasked, type PlayerRow } from '../db/identity.ts'
import type { PlayerFacts } from '../board/types.ts'
import { cardImageKey, cardReadKey } from '../cards/registry.ts'
import { ALL_SHARDS, boardOf, shardStub } from './stubs.ts'

export async function playerFacts(db: D1Database, uid: string): Promise<PlayerFacts | null> {
  const row = await db.prepare(`SELECT p.*, EXISTS (SELECT 1 FROM banned_uids b WHERE b.uid = p.uid) AS banned
    FROM players p WHERE p.uid = ?`).bind(uid).first<PlayerRow & { banned: 0 | 1 }>()
  return row ? factsOf(row, row.banned === 1) : null
}

export function factsOf(row: PlayerRow, banned: boolean): PlayerFacts {
  return {
    uid: Number(row.uid), name: row.last_name, region: row.region == null ? null : Number(row.region),
    hideUid: row.hide_uid === 1, masked: isMasked(row), unlisted: row.opted_out_at != null || banned, ver: row.ver,
  }
}

/** the resonators a player has builds on. */
export async function playerResonators(db: D1Database, uid: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT resonator_id FROM player_boards WHERE uid = ?').bind(uid).all<{ resonator_id: string }>()
  return results.map((row) => row.resonator_id)
}

/** sends the player's current facts to every board they are on. */
export async function syncPlayerBoards(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, uid: string): Promise<void> {
  const facts = await playerFacts(env.LB, uid)
  if (!facts) return
  await Promise.all((await playerResonators(env.LB, uid)).map((resonator) => boardOf(env, resonator).syncPlayer(Number(resonator), facts)))
}

/** every card read as the uid, in every registry shard: refused for `reason`, its image and read evidence erased. */
export async function eraseUidCards(env: Pick<ApiEnv, 'CARDS' | 'CARD_REGISTRY'>, uid: string, reason: string): Promise<number> {
  const counts = await Promise.all(ALL_SHARDS.map(async (shard) => {
    const stub = shardStub(env, shard)
    const cards = await stub.cardsOfUid(shard, Number(uid))
    if (!cards.length) return 0
    for (const card of cards) await stub.setStatus(shard, card.no, 'rejected', reason)
    const keys = cards.map((card) => cardImageKey(card))
    for (const card of cards) {
      for (const read of (await stub.history(shard, card.no)).reads) keys.push(cardReadKey(card.id, read.parser_ver))
    }
    for (let start = 0; start < keys.length; start += 1000) await env.CARDS.delete(keys.slice(start, start + 1000))
    await stub.markErased(shard, cards.map((card) => card.no))
    return cards.length
  }))
  return counts.reduce((a, b) => a + b, 0)
}
