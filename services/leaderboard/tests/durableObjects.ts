/*
  Author: Runor Ewhro
  description: in-process Durable Objects for vitest: one instance per name,
               storage as a node sqlite database behind the objects' sql api
               (exec, transactionSync, alarms), and a stub that copies arguments
               and results like an RPC call, which keeps objects from sharing
               values with callers. `runAlarms` fires alarms due soon, like the
               runtime.
*/

import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { resetPace } from '../src/board/pace.ts'

type Row = Record<string, unknown>

/** sqlite values in runtime form, with blobs as ArrayBuffers. */
const out = (row: Row): Row => {
  const copy: Row = {}
  for (const [key, value] of Object.entries(row)) copy[key] = value instanceof Uint8Array ? value.slice().buffer : value
  return copy
}
const into = (value: unknown): SQLInputValue =>
  value instanceof ArrayBuffer ? new Uint8Array(value) : value === undefined ? null : value as SQLInputValue

class MemoryStorage {
  readonly db = new DatabaseSync(':memory:')
  alarm: number | null = null
  private depth = 0

  readonly sql = {
    exec: (query: string, ...binds: unknown[]) => {
      const statement = this.db.prepare(query)
      const rows = statement.columns().length ? (statement.all(...binds.map(into)) as Row[]).map(out) : (statement.run(...binds.map(into)), [])
      return Object.assign(rows[Symbol.iterator](), { toArray: () => rows, one: () => rows[0] })
    },
    get databaseSize() { return 0 },
  }

  /** a transaction; a nested one is a savepoint, as the runtime makes it. */
  transactionSync<T>(work: () => T): T {
    const name = `t${this.depth}`
    this.db.exec(this.depth ? `SAVEPOINT ${name}` : 'BEGIN')
    this.depth += 1
    try {
      const result = work()
      this.depth -= 1
      this.db.exec(this.depth ? `RELEASE ${name}` : 'COMMIT')
      return result
    } catch (error) {
      this.depth -= 1
      this.db.exec(this.depth ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK')
      throw error
    }
  }

  async getAlarm() { return this.alarm }
  async setAlarm(at: number | Date) { this.alarm = typeof at === 'number' ? at : at.getTime() }
  async deleteAlarm() { this.alarm = null }
}

interface Instance {
  object: Record<string, unknown> & { alarm?: () => Promise<void> }
  storage: MemoryStorage
}

export interface MemoryNamespace<T> extends DurableObjectNamespace<T & Rpc.DurableObjectBranded> {
  instances: Map<string, Instance>
}

/** a namespace of `Class`, its objects made with `env` (read when an object is first made, so env may be filled later). */
export function memoryNamespace<T>(Class: new (ctx: DurableObjectState, env: never) => T, env: () => unknown): MemoryNamespace<T> {
  const instances = new Map<string, Instance>()
  const instanceOf = (name: string): Instance => {
    let found = instances.get(name)
    if (!found) {
      const storage = new MemoryStorage()
      const ctx = { storage, id: { name, toString: () => name }, blockConcurrencyWhile: <R>(work: () => Promise<R>) => work(),
        waitUntil() {} } as unknown as DurableObjectState
      found = { object: new Class(ctx, env() as never) as unknown as Instance['object'], storage }
      instances.set(name, found)
    }
    return found
  }
  const namespace = {
    instances,
    idFromName: (name: string) => ({ name, toString: () => name }),
    get: (id: { name: string }) => new Proxy({}, {
      get: (_, method: string) => {
        if (method === 'then') return undefined
        return async (...args: unknown[]) => {
          const { object } = instanceOf(id.name)
          const fn = object[method] as ((...a: unknown[]) => Promise<unknown>) | undefined
          if (typeof fn !== 'function') throw new Error(`no rpc method ${method}`)
          return structuredClone(await fn.apply(object, structuredClone(args)))
        }
      },
    }),
  }
  return namespace as unknown as MemoryNamespace<T>
}

/** fire every alarm due within `soonMs`, again while new ones come due, at most `rounds` times. */
export async function runAlarms(namespaces: Array<MemoryNamespace<unknown>>, { soonMs = 1000, rounds = 20 } = {}): Promise<number> {
  let fired = 0
  for (let round = 0; round < rounds; round += 1) {
    const due = namespaces.flatMap((namespace) => [...namespace.instances.values()])
      .filter((instance) => instance.storage.alarm != null && instance.storage.alarm <= Date.now() + soonMs)
    if (!due.length) return fired
    for (const instance of due) {
      instance.storage.alarm = null
      // an alarm fired early stands for the time until it was due: the thread's gap after a heavy step has passed.
      resetPace()
      await instance.object.alarm?.()
      fired += 1
    }
  }
  return fired
}
