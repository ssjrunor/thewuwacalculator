/*
  Author: Runor Ewhro
  description: the signed-in account's inbox: its builds scored or knocked off
               #1, uids moved, and moderation outcomes (sanctions, appeals,
               image reviews), newest first and marked read one at a time or all
               at once.
*/

import type { NotificationItem, NotificationsResponse } from '@lb/contract/api'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import { markReadStatement, notificationsOf, unreadCount, type NotificationRow } from '../../db/notifications.ts'
import { toRef } from '../../db/social.ts'
import type { RouteContext } from '../router.ts'
import { requireAccount } from '../auth/sessions.ts'

const PAGE = 50

// a page cursor: `<created_at>.<id>`
const cursorOf = (row: { created_at: number; id: string }) => `${row.created_at}.${row.id}`
function parseCursor(value: string | null): { at: number; id: string } | null {
  if (!value) return null
  const dot = value.indexOf('.')
  const at = Number(value.slice(0, dot))
  if (dot < 1 || !Number.isSafeInteger(at)) throw new HttpError('bad_request', "oopsies... we couldn't load that page of results. refresh the list and try again.")
  return { at, id: value.slice(dot + 1) }
}

const item = (row: NotificationRow): NotificationItem => ({
  id: row.id, kind: row.kind, at: row.created_at, read: row.read_at != null, count: row.count, buildId: row.build_id,
  resonatorId: row.resonator_id, actor: row.ref_uid ? toRef(row) : null, data: row.data ? JSON.parse(row.data) : null,
})

// GET /notifications?before=
export async function listNotifications(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context, { stopped: true })
  const db = context.env.LB
  const [rows, unread] = await Promise.all([notificationsOf(db, session.accountId, parseCursor(context.url.searchParams.get('before')), PAGE),
    unreadCount(db, session.accountId)])
  const body: NotificationsResponse = { notifications: rows.map(item), unread, next: rows.length === PAGE ? cursorOf(rows.at(-1)!) : null }
  return json(body)
}

// POST /notifications/read { ids? }: the given ones, or all
export async function readNotifications(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context, { stopped: true })
  const { ids } = await readJsonBody<{ ids?: unknown }>(context.request)
  if (ids !== undefined && !(Array.isArray(ids) && ids.length <= 200 && ids.every((id) => typeof id === 'string'))) {
    throw new HttpError('bad_request', "oopsies... we could not mark those notifications as read. reopen your inbox and try again.")
  }
  await markReadStatement(context.env.LB, session.accountId, (ids as string[] | undefined) ?? null, context.now).run()
  return json({ unread: await unreadCount(context.env.LB, session.accountId) })
}
