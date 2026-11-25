/*
  Author: Runor Ewhro
  description: Durable Object stubs for the api and scorer: one board per
               resonator, and one registry shard per hex digit of a card's link
               hash. every call passes its board or shard name, which the object
               reads on its first call.
*/

import type { BoardDO } from '../board/BoardDO.ts'
import type { CardRegistryDO } from '../cards/CardRegistryDO.ts'
import { CARD_SHARDS, cardShardOf, parseCardId } from '../lib/ids.ts'

export interface ObjectBindings {
  BOARDS: DurableObjectNamespace<BoardDO>
  CARD_REGISTRY: DurableObjectNamespace<CardRegistryDO>
}

/** a resonator's board. */
export function boardOf(env: Pick<ObjectBindings, 'BOARDS'>, resonator: number | string): DurableObjectStub<BoardDO> {
  return env.BOARDS.get(env.BOARDS.idFromName(String(Number(resonator))))
}

/** the registry shard for a hex link hash. */
export function shardOfLink(env: Pick<ObjectBindings, 'CARD_REGISTRY'>, linkHash: string) {
  const shard = cardShardOf(linkHash)
  return { shard, stub: shardStub(env, shard) }
}

export function shardStub(env: Pick<ObjectBindings, 'CARD_REGISTRY'>, shard: number): DurableObjectStub<CardRegistryDO> {
  return env.CARD_REGISTRY.get(env.CARD_REGISTRY.idFromName(shard.toString(16)))
}

/** a card by its public id: its shard's stub and its number there, or null for an id that is not one. */
export function cardRef(env: Pick<ObjectBindings, 'CARD_REGISTRY'>, cardId: string) {
  const key = parseCardId(cardId)
  return key ? { ...key, stub: shardStub(env, key.shard) } : null
}

export const ALL_SHARDS = Array.from({ length: CARD_SHARDS }, (_, shard) => shard)
