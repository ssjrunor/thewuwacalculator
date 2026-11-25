/*
  Author: Runor Ewhro
  description: local dev only: with SLOW_SQL_MS set (.dev.vars), logs every d1
               statement or batch slower than it with its request, which names
               the query behind a slow read on a large local database; unset, the
               binding is unchanged.
*/

type Timed = D1PreparedStatement & { real: D1PreparedStatement; sql: string }

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim().slice(0, 400)

/** env with its LB binding timed for `label` (the request), or env itself when SLOW_SQL_MS is unset. */
export function withSlowSql<E extends { LB: D1Database; SLOW_SQL_MS?: string }>(env: E, label: string): E {
  const limit = Number(env.SLOW_SQL_MS)
  if (!env.SLOW_SQL_MS || !Number.isFinite(limit)) return env
  const real = env.LB
  async function timed<T>(what: string, run: () => Promise<T>): Promise<T> {
    const started = Date.now()
    try {
      return await run()
    } finally {
      const ms = Date.now() - started
      if (ms >= limit) console.warn(`[slow sql] ${ms} ms  ${label}  ${what}`)
    }
  }
  const wrap = (statement: D1PreparedStatement, sql: string): Timed => ({
    real: statement,
    sql,
    bind: (...values: unknown[]) => wrap(statement.bind(...values), sql),
    first: (column?: string) => timed(flat(sql), () => statement.first(column as string)),
    all: () => timed(flat(sql), () => statement.all()),
    run: () => timed(flat(sql), () => statement.run()),
    raw: (options?: { columnNames?: boolean }) => timed(flat(sql), () => statement.raw(options as { columnNames: true })),
  }) as unknown as Timed
  const LB = {
    prepare: (sql: string) => wrap(real.prepare(sql), sql),
    batch: (statements: Timed[]) => timed(`batch of ${statements.length}: ${statements.map((s) => flat(s.sql).slice(0, 120)).join(' | ')}`,
      () => real.batch(statements.map((s) => s.real ?? s))),
    exec: (sql: string) => timed(flat(sql), () => real.exec(sql)),
    dump: () => real.dump(),
    withSession: (...args: Parameters<D1Database['withSession']>) => real.withSession(...args),
  } as unknown as D1Database
  return { ...env, LB }
}
