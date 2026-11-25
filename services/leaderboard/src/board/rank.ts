/*
  Author: Runor Ewhro
  description: board ranks without counting rows. every facet entry is counted
               in one of BUCKETS score buckets per seq+region key
               (sr = seq * 8 + region key) in c<rs>; a facet's counts load on
               first use, stay in memory and update with every entry write. a
               rank is the sum of the buckets above plus a count inside one
               bucket (a few thousand rows at most on a 1.4M board), and a page
               at any offset starts from its bucket. a filter (sequence, server,
               or both) sums the matching sr counts once and then updates like
               the rest.
*/

import { BUCKETS, bucketHigh, bucketOf } from '../lib/score.ts'
import type { SqlLike, SqlValue } from './sql.ts'

/** a sequence and a server (region key 1-5), each optional. */
export interface SrFilter {
  seq: number | null
  region: number | null
}

/** an entry's key value, -q with 0 for zero; SQLite binds -0 as a float. */
export const nsOf = (q: number): number => (q === 0 ? 0 : -q)

export const NO_FILTER: SrFilter = { seq: null, region: null }

/** seq+region key: a player whose server is hidden has region key 0, which no server filter matches. */
export const srOf = (seq: number, regionKey: number): number => seq * 8 + regionKey

export function srMatches(sr: number, filter: SrFilter): boolean {
  return (filter.seq === null || Math.floor(sr / 8) === filter.seq) && (filter.region === null || sr % 8 === filter.region)
}

/** the sql condition (on column `sr`) a filter adds, and its binds. */
export function srSql(filter: SrFilter): { sql: string; binds: SqlValue[] } {
  if (filter.seq !== null && filter.region !== null) return { sql: ' AND sr = ?', binds: [srOf(filter.seq, filter.region)] }
  if (filter.seq !== null) return { sql: ' AND sr BETWEEN ? AND ?', binds: [filter.seq * 8, filter.seq * 8 + 7] }
  if (filter.region !== null) return { sql: ' AND sr % 8 = ?', binds: [filter.region] }
  return { sql: '', binds: [] }
}

const filterKey = (filter: SrFilter) => `${filter.seq ?? '*'}:${filter.region ?? '*'}`

interface Variant {
  filter: SrFilter
  counts: Int32Array
  total: number
}

interface FacetCounts {
  fine: Map<number, Int32Array>
  variants: Map<string, Variant>
}

/** the ns bound that starts a bucket in rank order: every entry of `bucket` or lower has ns >= this. */
export function bucketStartNs(bucket: number): number {
  const high = bucketHigh(bucket)
  return high === Number.POSITIVE_INFINITY ? Number.MIN_SAFE_INTEGER : -high
}

export class RankIndex {
  private readonly facets = new Map<number, FacetCounts>()
  private readonly sql: SqlLike
  private readonly rs: number

  constructor(sql: SqlLike, rs: number) {
    this.sql = sql
    this.rs = rs
  }

  private load(facet: number): FacetCounts {
    let found = this.facets.get(facet)
    if (found) return found
    found = { fine: new Map(), variants: new Map() }
    for (const row of this.sql.all<{ sr: number; bucket: number; n: number }>(
      `SELECT sr, bucket, n FROM c${this.rs} WHERE facet = ? AND n <> 0`, facet)) {
      let counts = found.fine.get(row.sr)
      if (!counts) found.fine.set(row.sr, (counts = new Int32Array(BUCKETS)))
      counts[row.bucket] += row.n
    }
    this.facets.set(facet, found)
    return found
  }

  /** counts one entry in (delta 1) or out (delta -1), in c<rs> and in memory. */
  add(facet: number, sr: number, q: number, delta: 1 | -1): void {
    const bucket = bucketOf(q)
    this.sql.run(`INSERT INTO c${this.rs} (facet, sr, bucket, n) VALUES (?, ?, ?, ?)
      ON CONFLICT (facet, sr, bucket) DO UPDATE SET n = n + excluded.n`, facet, sr, bucket, delta)
    const loaded = this.facets.get(facet)
    if (!loaded) return
    let counts = loaded.fine.get(sr)
    if (!counts) loaded.fine.set(sr, (counts = new Int32Array(BUCKETS)))
    counts[bucket] += delta
    for (const variant of loaded.variants.values()) {
      if (!srMatches(sr, variant.filter)) continue
      variant.counts[bucket] += delta
      variant.total += delta
    }
  }

  /** forgets what is in memory (after a rollback, the counts in memory may be ahead of the table). */
  reset(): void {
    this.facets.clear()
  }

  private variant(facet: number, filter: SrFilter): Variant {
    const counts = this.load(facet)
    const key = filterKey(filter)
    let found = counts.variants.get(key)
    if (found) return found
    const summed = new Int32Array(BUCKETS)
    let total = 0
    for (const [sr, fine] of counts.fine) {
      if (!srMatches(sr, filter)) continue
      for (let bucket = 0; bucket < BUCKETS; bucket += 1) summed[bucket] += fine[bucket]
    }
    for (let bucket = 0; bucket < BUCKETS; bucket += 1) total += summed[bucket]
    counts.variants.set(key, (found = { filter, counts: summed, total }))
    return found
  }

  /** entry count of a facet under a filter. */
  total(facet: number, filter: SrFilter = NO_FILTER): number {
    return this.variant(facet, filter).total
  }

  /** how many entries sit in buckets above `bucket` (higher scores). */
  above(facet: number, filter: SrFilter, bucket: number): number {
    const { counts } = this.variant(facet, filter)
    let sum = 0
    for (let at = BUCKETS - 1; at > bucket; at -= 1) sum += counts[at]
    return sum
  }

  /** the rank RANK() gives a score: one more than the entries scoring higher. */
  rank(facet: number, filter: SrFilter, q: number): number {
    const bucket = bucketOf(q)
    const sr = srSql(filter)
    const inside = this.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM e${this.rs}
      WHERE facet = ? AND ns >= ? AND ns < ?${sr.sql}`, facet, bucketStartNs(bucket), nsOf(q), ...sr.binds)?.n ?? 0
    return 1 + this.above(facet, filter, bucket) + inside
  }

  /** locates the entry at 0-based `offset` in rank order: its bucket and the matching entries of that bucket before
        it; null past the end. */
  locate(facet: number, filter: SrFilter, offset: number): { bucket: number; skip: number } | null {
    const { counts, total } = this.variant(facet, filter)
    if (offset < 0 || offset >= total) return null
    let before = 0
    for (let bucket = BUCKETS - 1; bucket >= 0; bucket -= 1) {
      const n = counts[bucket]
      if (before + n > offset) return { bucket, skip: offset - before }
      before += n
    }
    return null
  }

  /** the per-bucket counts of a facet under a filter, top bucket last (read only). */
  counts(facet: number, filter: SrFilter = NO_FILTER): Int32Array {
    return this.variant(facet, filter).counts
  }
}
