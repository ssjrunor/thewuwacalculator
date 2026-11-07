/*
  Author: Runor Ewhro
  description: in-process stand-ins for the worker bindings, so the real
               routes, consumers and sql run in vitest: d1 on node's sqlite with
               the real migrations, r2 and queues in memory, an always-allow
               rate limiter, and a signer for cloudflare access tokens.
*/

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

const MIGRATIONS = join(__dirname, '../migrations')

class Statement {
  constructor(private readonly db: DatabaseSync, readonly sql: string, private readonly params: SQLInputValue[] = []) {}

  bind(...params: unknown[]): Statement {
    return new Statement(this.db, this.sql, params.map((value) => (value === undefined ? null : value)) as SQLInputValue[])
  }

  private prepared() { return this.db.prepare(this.sql) }

  returnsRows(): boolean { return this.prepared().columns().length > 0 }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.prepared().get(...this.params) as Record<string, unknown> | undefined
    if (!row) return null
    return (column ? row[column] : { ...row }) as T
  }

  async all<T>() {
    const results = (this.prepared().all(...this.params) as Record<string, unknown>[]).map((row) => ({ ...row })) as T[]
    return { results, success: true, meta: { changes: 0 } }
  }

  async run() {
    const outcome = this.prepared().run(...this.params)
    return { results: [], success: true, meta: { changes: Number(outcome.changes), last_row_id: Number(outcome.lastInsertRowid) } }
  }
}

/** a D1Database over an in-memory sqlite, migrations applied. batches are transactions, as on d1. */
export function memoryD1(): D1Database & { sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
  const db = {
    sqlite,
    prepare: (sql: string) => new Statement(sqlite, sql),
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN')
      try {
        const out = []
        for (const statement of statements) out.push(statement.returnsRows() ? await statement.all() : await statement.run())
        sqlite.exec('COMMIT')
        return out
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
    async exec(sql: string) { sqlite.exec(sql); return { count: 1, duration: 0 } },
  }
  return db as unknown as D1Database & { sqlite: DatabaseSync }
}

/** an R2Bucket in memory (the calls the service makes). */
export function memoryR2(): R2Bucket & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>()
  const body = (key: string) => {
    const bytes = objects.get(key)!
    return {
      key, size: bytes.byteLength,
      body: new Response(bytes).body,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    }
  }
  const bucket = {
    objects,
    async head(key: string) { return objects.has(key) ? { key, size: objects.get(key)!.byteLength } : null },
    async get(key: string) { return objects.has(key) ? body(key) : null },
    async put(key: string, value: string | ArrayBuffer | Uint8Array) {
      objects.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBuffer))
      return { key }
    },
    async delete(keys: string | string[]) { for (const key of [keys].flat()) objects.delete(key) },
  }
  return bucket as unknown as R2Bucket & { objects: Map<string, Uint8Array> }
}

/** a Queue that keeps what was sent, for the test to deliver. */
export function memoryQueue<T>(): Queue<T> & { sent: T[]; take(): T[] } {
  const sent: T[] = []
  const queue = {
    sent,
    async send(body: T) { sent.push(structuredClone(body)) },
    async sendBatch(messages: Iterable<{ body: T }>) { for (const message of messages) sent.push(structuredClone(message.body)) },
    take() { return sent.splice(0, sent.length) },
  }
  return queue as unknown as Queue<T> & { sent: T[]; take(): T[] }
}

export const allowAll = { limit: async () => ({ success: true }) } as unknown as RateLimit

/** a MessageBatch of `bodies` that records acks and retries. */
export function batchOf<T>(bodies: T[]) {
  const acked: T[] = []
  const retried: T[] = []
  const batch = {
    queue: 'test', messages: bodies.map((body, index) => ({
      id: String(index), timestamp: new Date(), attempts: 1, body,
      ack: () => { acked.push(body) }, retry: () => { retried.push(body) },
    })),
    ackAll() {}, retryAll() {},
  }
  return { batch: batch as unknown as MessageBatch<T>, acked, retried }
}

const base64Url = (bytes: Uint8Array | string) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** a cloudflare access issuer: its certs endpoint and tokens signed by it. */
export async function accessIssuer(team: string, audience: string) {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return {
    certs: { keys: [{ kid: 'test-key', kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256' }] },
    async token(claims: Record<string, unknown> = {}) {
      const header = base64Url(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' }))
      const payload = base64Url(JSON.stringify({ aud: [audience], iss: `https://${team}`, sub: 'admin-1',
        email: 'admin@example.test', exp: Math.floor(Date.now() / 1000) + 600, ...claims }))
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${payload}`))
      return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`
    },
  }
}
