/*
  Author: Runor Ewhro
  description: a board's SQLite schema. base tables store the board's builds,
               their players and the scored rulesets; each ruleset has its own
               small set of tables named by its number, which makes retiring or
               cancelling one a DROP TABLE with no delete across millions of
               rows.
                 s<rs>  a build's scores, one blob per build (scorePack.ts; detail is in R2)
                 x<rs>  scores for health reports: failed cells, scores above perfect
                 w<rs>  the scored seat's stats per scenario weapon
                 j<rs>  a build's job: progress, best cell, listing
                 d<rs>  detail staged until its R2 object is written
                 n<rs>  bulk cells waiting to be sent, grouped by scenario and program key
                 e<rs>  board entries: one per listed build per facet, in rank order
                 c<rs>  entry counts per (facet, seq+region, bucket)
               only e<rs>'s key is ordered by score, and only listed builds have
               entries; ranks and totals are read from c<rs>.
*/

import type { SqlLike } from './sql.ts'

/** the base schema's version; a board below it is migrated when it wakes. */
export const SCHEMA_VERSION = 7

/** the oldest schema a board can be migrated from; every board was made at or moved to it. */
const OLDEST_SCHEMA = 7

/**
 * statements per version, applied to a board at the previous version. a migration changes only structure (tables,
 * indexes, columns) and meta, and row work is a backfill the alarm runs a slice at a time (BoardDO BACKGROUND), since
 * migrations run while the board loads (tests/board/bounded.test.ts checks this).
 */
export const MIGRATIONS: Record<number, string[]> = {}

/** per-version changes to the tables of every ruleset already on a board. */
export const RULESET_MIGRATIONS: Record<number, (sql: SqlLike, rs: number) => void> = {}

const BASE = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v) WITHOUT ROWID`,
  // state: 0 rolling, 1 live, 2 archived (tables dropped), 3 cancelled (dropped); reuse_from: the ruleset a rollout
  // may keep scores from (checked per score in scorer/reuse.ts), or null
  `CREATE TABLE IF NOT EXISTS rulesets (rs INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, state INTEGER NOT NULL,
    installed_at INTEGER NOT NULL, live_at INTEGER, ended_at INTEGER, cursor INTEGER NOT NULL DEFAULT 0, reuse_from INTEGER)`,
  `CREATE TABLE IF NOT EXISTS cells (rs INTEGER NOT NULL, cell INTEGER NOT NULL, key TEXT NOT NULL, team_id TEXT NOT NULL,
    team_key TEXT NOT NULL, team_rank INTEGER NOT NULL, weapon_id INTEGER NOT NULL, weapon_rank INTEGER NOT NULL,
    weapon_role TEXT NOT NULL, members TEXT NOT NULL, team_facet INTEGER NOT NULL, weapon_facet INTEGER NOT NULL,
    cell_facet INTEGER NOT NULL, reuse INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (rs, cell)) WITHOUT ROWID`,
  // flags: 1 hide_uid, 2 masked (anonymous or setup), 4 unlisted (opted out or banned)
  // sent: hash of the standing last sent to D1 (player_boards), which skips unchanged standings
  `CREATE TABLE IF NOT EXISTS players (uid INTEGER PRIMARY KEY, name TEXT, region INTEGER, flags INTEGER NOT NULL,
    ver INTEGER NOT NULL, sent INTEGER)`,
  // state: 0 active (kept, ranked and shown as itself), 2 deleted, 3 hidden by staff; upload_sent: whether D1's
  // recent_uploads last showed the upload (1) or not (0), null before the first send. boards made before schema 7 also
  // have activated_by, replaced_by and final_* columns, unused now and left in place because dropping them rewrites the table
  `CREATE TABLE IF NOT EXISTS builds (id INTEGER PRIMARY KEY, uid INTEGER NOT NULL, seq INTEGER NOT NULL,
    state INTEGER NOT NULL, owner_hidden_at INTEGER, card TEXT NOT NULL, snap_h TEXT NOT NULL, snap BLOB NOT NULL,
    card_stats BLOB, drawn_at INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
    ended_at INTEGER, scored_at INTEGER, upload_sent INTEGER)`,
  `CREATE INDEX IF NOT EXISTS builds_player ON builds (uid, snap_h)`,
  `CREATE INDEX IF NOT EXISTS builds_card ON builds (card)`,
  // kept builds are counted from this index, which skips the table and its snapshots
  `CREATE INDEX IF NOT EXISTS builds_state ON builds (state)`,
  `CREATE TABLE IF NOT EXISTS events (build INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, actor TEXT, data TEXT)`,
  `CREATE INDEX IF NOT EXISTS events_build ON events (build, at)`,
  // AUTOINCREMENT keeps seqs unique after the outbox drains; a reused seq would make D1's board_sync guard read a new
  // batch as a replay
  `CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reasons (code INTEGER PRIMARY KEY, text TEXT NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS timings (at INTEGER NOT NULL, rs INTEGER NOT NULL, cell INTEGER NOT NULL, lane TEXT NOT NULL,
    runner TEXT NOT NULL, status INTEGER NOT NULL, ms INTEGER NOT NULL, wall_ms INTEGER, stages TEXT, anchor TEXT)`,
  `CREATE INDEX IF NOT EXISTS timings_at ON timings (at)`,
]

/** the tables of one ruleset. */
export function rulesetTables(rs: number): string[] {
  if (!Number.isInteger(rs) || rs <= 0) throw new Error(`schema: ruleset number ${rs}`)
  return [
    // a build's scores, every cell in one blob (scorePack.ts): one row to read and write however many cells it scores.
    `CREATE TABLE IF NOT EXISTS s${rs} (build INTEGER PRIMARY KEY, cells BLOB NOT NULL)`,
    // the few scores health reports, out of the blobs: kind 0 a cell that could not score (status error), 1 a score past
    // the perfect build (flags bit 2, SCORE_FLAGS.overPerfect).
    `CREATE TABLE IF NOT EXISTS x${rs} (kind INTEGER NOT NULL, build INTEGER NOT NULL, cell INTEGER NOT NULL, q INTEGER,
      PRIMARY KEY (kind, build, cell)) WITHOUT ROWID`,
    `CREATE INDEX IF NOT EXISTS x${rs}_q ON x${rs} (kind, q)`,
    `CREATE TABLE IF NOT EXISTS w${rs} (build INTEGER NOT NULL, weapon INTEGER NOT NULL, stats BLOB NOT NULL,
      PRIMARY KEY (build, weapon)) WITHOUT ROWID`,
    // status: 0 scoring, 1 scored, 2 failed; lane: 0 interactive, 1 bulk; listed_sr: the seq+region key of the build's
    // entries, or null without entries; detail_from: the ruleset (rs) whose detail object this job reads when a rollout
    // kept every cell and wrote no object, null for the job's own object
    `CREATE TABLE IF NOT EXISTS j${rs} (build INTEGER PRIMARY KEY, gen INTEGER NOT NULL, expected INTEGER NOT NULL,
      done INTEGER NOT NULL, status INTEGER NOT NULL, best_cell INTEGER, best_q INTEGER, lane INTEGER NOT NULL,
      created_at INTEGER NOT NULL, progress_at INTEGER NOT NULL, sent_at INTEGER, finished_at INTEGER,
      resumes INTEGER NOT NULL DEFAULT 0, detail_at INTEGER, listed_sr INTEGER, detail_from INTEGER)`,
    `CREATE TABLE IF NOT EXISTS d${rs} (build INTEGER NOT NULL, cell INTEGER NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY (build, cell)) WITHOUT ROWID`,
    // ns is -q, so key order is rank order: highest score first, then the earlier build
    `CREATE TABLE IF NOT EXISTS e${rs} (facet INTEGER NOT NULL, ns INTEGER NOT NULL, build INTEGER NOT NULL,
      sr INTEGER NOT NULL, cell INTEGER NOT NULL, PRIMARY KEY (facet, ns, build)) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS c${rs} (facet INTEGER NOT NULL, sr INTEGER NOT NULL, bucket INTEGER NOT NULL,
      n INTEGER NOT NULL, PRIMARY KEY (facet, sr, bucket)) WITHOUT ROWID`,
    // bulk cells staged for group messages (store.cutGroups): pkey hashes the build's program key
    // (domain/leaderboard/programKey.ts), grouping builds with one program into one message; at: staging time;
    // cs: the scorer also measures the card's own stats with this cell
    `CREATE TABLE IF NOT EXISTS n${rs} (cell INTEGER NOT NULL, pkey INTEGER NOT NULL, build INTEGER NOT NULL, at INTEGER NOT NULL,
      cs INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (cell, pkey, build)) WITHOUT ROWID`,
    `CREATE INDEX IF NOT EXISTS n${rs}_build ON n${rs} (build)`,
    `CREATE INDEX IF NOT EXISTS j${rs}_open ON j${rs} (progress_at) WHERE status = 0`,
    `CREATE INDEX IF NOT EXISTS j${rs}_unsent ON j${rs} (build) WHERE status = 0 AND sent_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS j${rs}_detail ON j${rs} (build) WHERE status <> 0 AND detail_at IS NULL`,
    // the few jobs that read an earlier ruleset's object, for that ruleset's purge when this one ends.
    `CREATE INDEX IF NOT EXISTS j${rs}_from ON j${rs} (detail_from) WHERE detail_from IS NOT NULL`,
    // jobs per status, counted without reading the table
    `CREATE INDEX IF NOT EXISTS j${rs}_status ON j${rs} (status)`,
  ]
}

export const dropRulesetTables = (rs: number): string[] =>
  [...['s', 'x', 'w', 'j', 'd', 'e', 'c', 'n'].map((prefix) => `${prefix}${rs}`), `e${rs}_new`, `c${rs}_new`, `e${rs}_stage`]
    .map((table) => `DROP TABLE IF EXISTS ${table}`)

/** creates or migrates the base schema. */
export function ensureSchema(sql: SqlLike): void {
  const row = (() => {
    try {
      return sql.first<{ v: number }>(`SELECT v FROM meta WHERE k = 'schema'`)
    } catch {
      return null
    }
  })()
  if (row && row.v >= SCHEMA_VERSION) return
  if (row && row.v < OLDEST_SCHEMA) throw new Error(`board: schema ${row.v} is older than the oldest migratable schema ${OLDEST_SCHEMA}`)
  sql.transaction(() => {
    // a board that has the base tables takes each later version's changes; a new one gets them from BASE.
    if (row) {
      // the rulesets whose tables are here (archived and cancelled ones were dropped).
      const held = sql.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'j[0-9]*'`)
        .map((table) => Number(table.name.slice(1))).filter((rs) => Number.isInteger(rs) && rs > 0)
      for (let version = row.v + 1; version <= SCHEMA_VERSION; version += 1) {
        for (const statement of MIGRATIONS[version] ?? []) sql.run(statement)
        for (const rs of held) RULESET_MIGRATIONS[version]?.(sql, rs)
      }
    }
    for (const statement of BASE) sql.run(statement)
    sql.run(`INSERT INTO meta (k, v) VALUES ('schema', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, SCHEMA_VERSION)
  })
}
