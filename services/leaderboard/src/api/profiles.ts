/*
  Author: Runor Ewhro
  description: GET /profiles, the profiles index: one page of the uids with a
               profile anyone may open (listed, not anonymous or setup, with a
               build on a board), in one of four orders, by server or a name or
               uid search. each row is the uid itself (its in-game name,
               server, counts and dates) in the look of the account it is
               linked to. the order and the count read partial indexes over
               the listed set (migration 0014), and pages are edge-cached for a
               short window.
*/

import type { ProfileListRow, ProfileSort, ProfilesResponse, RowLook } from '@lb/contract/api'
import type { ProfileDoc } from '@lb/contract/documents'
import { HttpError } from '../lib/http.ts'
import { clockJson } from '../lib/cache.ts'
import { profilesOf } from './people.ts'
import type { RouteContext } from './router.ts'

const PAGE = 50
const MAX_PAGE = 100
const PROFILES_CACHE_S = 30
const PROFILES_WINDOW_MS = 30_000

// the listed set, word for word as the 0014 partial indexes state it, then the ban check they cannot hold
const LISTED = `p.anonymous = 0 AND p.setup_at IS NULL AND p.opted_out_at IS NULL AND p.listed_boards > 0
  AND p.uid NOT IN (SELECT uid FROM banned_uids)`

// each order's columns and natural direction; reversing flips every column
const ORDERS: Record<ProfileSort, { columns: string[]; desc: boolean }> = {
  upload: { columns: ['p.last_seen_at', 'p.uid'], desc: true },
  age: { columns: ['p.first_seen_at', 'p.uid'], desc: false },
  builds: { columns: ['p.builds', 'p.last_seen_at', 'p.uid'], desc: true },
  name: { columns: ['p.last_name COLLATE NOCASE', 'p.uid'], desc: false },
}

export interface ProfileFilter {
  sort: ProfileSort
  reverse: boolean
  region: string | null
  q: string
  offset: number
  limit: number
}

export function parseProfilesQuery(params: URLSearchParams): ProfileFilter {
  const sort = params.get('sort') ?? 'upload'
  if (!(sort in ORDERS)) throw new HttpError('bad_request', 'sort is upload, age, builds or name')
  const region = params.get('region') || null
  if (region != null && !/^[1-9]$/.test(region)) throw new HttpError('bad_request', "region is a uid's first digit")
  const offset = Number(params.get('offset') ?? 0)
  const limit = Number(params.get('limit') ?? PAGE)
  if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError('bad_request', 'offset is 0 or more')
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new HttpError('bad_request', `limit is 1 to ${MAX_PAGE}`)
  return { sort: sort as ProfileSort, reverse: params.get('reverse') === '1', region, q: (params.get('q') ?? '').trim().slice(0, 40), offset, limit }
}

const likeText = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

// the where clause past the listed set, and its bindings
function filterOf(filter: ProfileFilter): { sql: string; binds: unknown[] } {
  const parts: string[] = []
  const binds: unknown[] = []
  // a server shows only with the uid, so filtering by one leaves hidden uids out
  // (+region: players_region contains every uid of the server, filler included; the order's partial index is smaller)
  if (filter.region) { parts.push('+p.region = ? AND p.hide_uid = 0'); binds.push(filter.region) }
  const digits = filter.q.replace(/\s/g, '')
  if (/^\d+$/.test(digits)) {
    // digits find the start of a shown uid; a hidden uid is never found by its digits
    parts.push(`p.hide_uid = 0 AND p.uid LIKE ? ESCAPE '\\'`)
    binds.push(`${digits}%`)
  } else if (filter.q) {
    const like = `%${likeText(filter.q)}%`
    // the uid's own name, or the display name of the account it is linked to
    parts.push(`(p.last_name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM account_uids a JOIN documents d ON d.kind = 'profile' AND d.owner_id = a.account_id
      WHERE a.uid = p.uid AND json_extract(d.body, '$.displayName') LIKE ? ESCAPE '\\'))`)
    binds.push(like, like)
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', binds }
}

// the account profile's look on a row: present whenever the account has a profile
function lookOf(doc: ProfileDoc | undefined): RowLook | null {
  if (!doc) return null
  return { displayName: doc.displayName ?? null, accent: doc.accent ?? null, avatar: doc.avatar ?? null, banner: doc.banner ?? null,
    avatarFrame: doc.avatarFrame ?? null, bannerFrame: doc.bannerFrame ?? null }
}

type ListedRow = {
  uid: string; last_name: string | null; region: string | null; hide_uid: 0 | 1; builds: number
  first_seen_at: number; last_seen_at: number; listed: string
}

export async function profiles(db: D1Database, filter: ProfileFilter): Promise<ProfilesResponse> {
  const where = filterOf(filter)
  const order = ORDERS[filter.sort]
  const dir = order.desc !== filter.reverse ? 'DESC' : 'ASC'
  const [counted, page] = await db.batch<{ n: number } | ListedRow>([
    db.prepare(`SELECT COUNT(*) AS n FROM players p WHERE ${LISTED}${where.sql}`).bind(...where.binds),
    // the uid's newest listed builds name its resonators and give a hidden uid its link
    db.prepare(`SELECT p.uid, p.last_name, p.region, p.hide_uid, p.builds, p.first_seen_at, p.last_seen_at,
        (SELECT json_group_array(json_array(b.resonator_id, b.listed)) FROM (SELECT resonator_id, listed FROM player_boards
          WHERE uid = p.uid AND listed IS NOT NULL ORDER BY listed_at DESC LIMIT 3) b) AS listed
      FROM players p WHERE ${LISTED}${where.sql}
      ORDER BY ${order.columns.map((column) => `${column} ${dir}`).join(', ')} LIMIT ? OFFSET ?`)
      .bind(...where.binds, filter.limit, filter.offset),
  ])
  const rows = page.results as ListedRow[]
  const profile = await profilesOf(db, rows.map((row) => row.uid))
  return {
    total: (counted.results[0] as { n: number } | undefined)?.n ?? 0,
    offset: filter.offset,
    rows: rows.map((row): ProfileListRow => {
      const listed = JSON.parse(row.listed) as Array<[string, string]>
      const doc = profile(row.uid)
      const shown = row.hide_uid === 0
      return {
        uid: shown ? row.uid : null, buildId: listed[0]?.[1] ?? '', name: row.last_name, region: shown ? row.region : null,
        builds: row.builds, resonators: listed.map(([resonatorId]) => resonatorId), firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
        look: lookOf(doc), bio: doc?.bio ?? null,
      }
    }),
  }
}

// how many uids the index lists, for the channel's count
export async function profileCount(db: D1Database): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM players p WHERE ${LISTED}`).first<{ n: number }>())?.n ?? 0
}

export async function getProfiles(context: RouteContext): Promise<Response> {
  const filter = parseProfilesQuery(context.url.searchParams)
  return clockJson(context, PROFILES_WINDOW_MS, PROFILES_CACHE_S, () => profiles(context.env.LB, filter))
}
