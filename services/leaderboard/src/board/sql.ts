/*
  Author: Runor Ewhro
  description: the SQLite interface the board store uses, which runs the same
               store in a Durable Object (ctx.storage.sql, transactionSync) and
               on node:sqlite in tests and benches. values are numbers,
               strings, null and Uint8Array in both directions (Durable Object
               blobs arrive as ArrayBuffer and are converted here). no node
               imports or syntax node's type stripping cannot run.
*/

export type SqlValue = number | string | null | Uint8Array

export interface SqlLike {
  /** runs a statement for its effect. */
  run(query: string, ...binds: SqlValue[]): void
  /** every row of a query. */
  all<T>(query: string, ...binds: SqlValue[]): T[]
  /** the first row of a query, or null. */
  first<T>(query: string, ...binds: SqlValue[]): T | null
  /** runs `work` in one transaction, all or nothing; not nestable. */
  transaction<T>(work: () => T): T
}

type Row = Record<string, unknown>

const blobsIn = (binds: SqlValue[]) => binds.map((value) => (value instanceof Uint8Array ? value.slice().buffer : value))

function blobsOut<T>(row: Row): T {
  for (const key in row) if (row[key] instanceof ArrayBuffer) row[key] = new Uint8Array(row[key] as ArrayBuffer)
  return row as T
}

/** the subset of DurableObjectStorage the adapter uses. */
export interface DurableSqlStorage {
  sql: { exec(query: string, ...binds: unknown[]): Iterable<Row> & { toArray(): Row[] } }
  transactionSync<T>(work: () => T): T
}

/** a Durable Object's SQLite. */
export function durableSql(storage: DurableSqlStorage): SqlLike {
  return {
    run(query, ...binds) {
      storage.sql.exec(query, ...blobsIn(binds)).toArray()
    },
    all<T>(query: string, ...binds: SqlValue[]) {
      return storage.sql.exec(query, ...blobsIn(binds)).toArray().map((row) => blobsOut<T>(row))
    },
    first<T>(query: string, ...binds: SqlValue[]) {
      for (const row of storage.sql.exec(query, ...blobsIn(binds))) return blobsOut<T>(row)
      return null
    },
    transaction: (work) => storage.transactionSync(work),
  }
}

/** the subset of node:sqlite's DatabaseSync the adapter uses. */
export interface NodeSqlDatabase {
  prepare(query: string): { all(...binds: unknown[]): unknown[]; get(...binds: unknown[]): unknown; run(...binds: unknown[]): unknown }
  exec(query: string): void
}

/** a node:sqlite database (tests, benches, tools), preparing each statement text once. */
export function nodeSql(db: NodeSqlDatabase): SqlLike {
  const prepared = new Map<string, ReturnType<NodeSqlDatabase['prepare']>>()
  const statement = (query: string) => {
    let found = prepared.get(query)
    if (!found) prepared.set(query, (found = db.prepare(query)))
    return found
  }
  let open = false
  return {
    run(query, ...binds) {
      statement(query).run(...binds)
    },
    all<T>(query: string, ...binds: SqlValue[]) {
      return statement(query).all(...binds) as T[]
    },
    first<T>(query: string, ...binds: SqlValue[]) {
      return (statement(query).get(...binds) as T | undefined) ?? null
    },
    transaction<T>(work: () => T): T {
      if (open) throw new Error('sql: transactions do not nest')
      open = true
      db.exec('BEGIN')
      try {
        const result = work()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      } finally {
        open = false
      }
    },
  }
}
