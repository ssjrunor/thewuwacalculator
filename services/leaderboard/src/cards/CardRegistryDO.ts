/*
  Author: Runor Ewhro
  description: a card registry shard as a Durable Object (idFromName of its hex
               digit). each method is one call into registry.ts, and every call
               passes the shard number, which the object reads on its first call.
*/

import { DurableObject } from 'cloudflare:workers'
import { durableSql } from '../board/sql.ts'
import { RegistryStore, type CardStatusCode, type NewCard, type ReadSummary } from './registry.ts'

export class CardRegistryDO extends DurableObject {
  private store: RegistryStore | null = null

  private shard(shard: number): RegistryStore {
    if (!this.store) this.store = new RegistryStore(durableSql(this.ctx.storage), shard)
    else if (this.store.shard !== shard) throw new Error(`registry: this is shard ${this.store.shard}, not ${shard}`)
    return this.store
  }

  async get(shard: number, no: number) { return this.shard(shard).get(no) }
  async byLink(shard: number, linkHash: string) { return this.shard(shard).byLink(linkHash) }
  async record(shard: number, card: NewCard) { return this.shard(shard).record(card, Date.now()) }
  async setStatus(shard: number, no: number, status: CardStatusCode, reason: string | null, actor: string | null = null) {
    this.shard(shard).setStatus(no, status, reason, Date.now(), actor)
    return this.shard(shard).get(no)
  }
  async restoreImage(shard: number, no: number) { this.shard(shard).restoreImage(no, Date.now()) }
  async markErased(shard: number, nos: number[], now = Date.now()) { this.shard(shard).markErased(nos, now) }
  async recordRead(shard: number, no: number, read: ReadSummary) { this.shard(shard).recordRead(no, read, Date.now()) }
  async setPlaced(shard: number, no: number, uid: number, resonator: number, build: string) {
    this.shard(shard).setPlaced(no, uid, resonator, build, Date.now())
  }
  async block(shard: number, no: number, actor: string) { return this.shard(shard).block(no, actor, Date.now()) }
  async readUid(shard: number, no: number) { return this.shard(shard).readUid(no) }
  async cardsOfUid(shard: number, uid: number) { return this.shard(shard).cardsOfUid(uid) }
  async refusedImages(shard: number, before: number, limit: number, reasons: readonly string[]) {
    return this.shard(shard).refusedImages(before, limit, reasons)
  }
  async stuckPending(shard: number, before: number, limit: number) { return this.shard(shard).stuckPending(before, limit) }
  async refusals(shard: number, since: number, reasons: readonly string[], limit: number) {
    return this.shard(shard).refusals(since, reasons, limit)
  }
  async history(shard: number, no: number) { return { events: this.shard(shard).events(no), reads: this.shard(shard).reads(no) } }
}
