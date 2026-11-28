/*
  Author: Runor Ewhro
  description: resolves the person behind a uid. a uid linked to an account is
               one of that person's uids, and their profile shows the builds of
               all of them; a uid on no account is its own person. profiles and card
               looks belong to the account. public views leave out
               uids nobody may see (unlisted, anonymous or setup), so a profile
               never reveals them.
*/

import type { PlayerRef } from '@lb/contract/api'
import type { ProfileDoc } from '@lb/contract/documents'
import { accountsOf } from '../db/accounts.ts'
import { maskedSql } from '../db/identity.ts'
import { refColumns, toRef, type RefColumns } from '../db/social.ts'
import { shownDocuments } from './documents/routes.ts'

export interface Person {
  // the account the uids are linked to; null for a uid on no account
  accountId: string | null
  // the uids whose builds the person's profile shows, oldest link first
  uids: string[]
}

// the person a uid belongs to; with `own` (the viewer has the uid) it includes every uid of the account, otherwise
// the uid itself and its publicly visible siblings
export async function personOf(db: D1Database, uid: string, { own = false }: { own?: boolean } = {}): Promise<Person> {
  const { results } = await db.prepare(`SELECT s.account_id, s.uid, ${maskedSql('p')} AS masked,
      EXISTS (SELECT 1 FROM listed_players lp WHERE lp.uid = s.uid) AS listed
    FROM account_uids l JOIN account_uids s ON s.account_id = l.account_id JOIN players p ON p.uid = s.uid
    WHERE l.uid = ? ORDER BY s.linked_at, s.uid`).bind(uid)
    .all<{ account_id: string; uid: string; masked: 0 | 1; listed: 0 | 1 }>()
  if (!results.length) return { accountId: null, uids: [uid] }
  return { accountId: results[0].account_id,
    uids: results.filter((row) => row.uid === uid || own || (row.listed === 1 && row.masked === 0)).map((row) => row.uid) }
}

// public profile documents of the accounts linked to these uids, by uid
export async function profilesOf(db: D1Database, uids: string[]): Promise<(uid: string) => ProfileDoc | undefined> {
  const owners = await accountsOf(db, uids)
  const docs = owners.size ? await shownDocuments(db, ['profile'], [...new Set(owners.values())], false) : new Map()
  return (uid) => {
    const owner = owners.get(uid)
    return owner ? docs.get(`profile:${owner}`) as ProfileDoc | undefined : undefined
  }
}

// account names for social responses (a blocked person): the profile display name, linked through the account's
// newest publicly visible uid as a player ref; accounts without one get a name and no link
export async function accountRefs(db: D1Database, accountIds: Array<string | null>): Promise<(accountId: string | null) => PlayerRef> {
  const ids = [...new Set(accountIds.filter((id): id is string => id != null))]
  if (!ids.length) return () => ({ uid: null, buildId: null, name: null })
  const [docs, { results }] = await Promise.all([shownDocuments(db, ['profile'], ids, false),
    db.prepare(`SELECT l.account_id, ${refColumns('l.uid')} FROM account_uids l JOIN listed_players p ON p.uid = l.uid
      WHERE l.account_id IN (SELECT value FROM json_each(?)) AND NOT ${maskedSql('p')} ORDER BY l.linked_at DESC`)
      .bind(JSON.stringify(ids)).all<RefColumns & { account_id: string }>()])
  const faces = new Map<string, RefColumns>()
  for (const row of results) if (!faces.has(row.account_id)) faces.set(row.account_id, row)
  return (accountId) => {
    if (accountId == null) return { uid: null, buildId: null, name: null }
    const name = (docs.get(`profile:${accountId}`) as ProfileDoc | undefined)?.displayName ?? null
    const face = faces.get(accountId)
    return face ? { ...toRef(face), name: name ?? face.ref_name } : { uid: null, buildId: null, name }
  }
}
