/*
  Author: Runor Ewhro
  description: the signed-in account's inbox: comments and likes on its builds,
               replies to its comments, and moderation outcomes (sanctions,
               image reviews, removed comments), newest first and marked read
               one at a time or all at once.
*/

import type { NotificationItem, NotificationsResponse } from '@lb/contract/api'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import { markReadStatement, notificationsOf, unreadCount, type NotificationRow } from '../../db/notifications.ts'
import { toRef } from '../../db/social.ts'
import { accountRefs } from '../people.ts'
import type { RouteContext } from '../router.ts'
import { requireAccount } from '../auth/sessions.ts'
import { cursorOf, parseCursor } from './comments.ts'

const PAGE = 50

const written = (row: NotificationRow) => row.kind === 'comment' || row.kind === 'reply'

const item = (writers: Awaited<ReturnType<typeof accountRefs>>) => (row: NotificationRow): NotificationItem => ({
  id: row.id, kind: row.kind, at: row.created_at, read: row.read_at != null, count: row.count, buildId: row.build_id,
  resonatorId: row.resonator_id, commentId: written(row) || row.kind === 'comment_removed' ? row.subject_id : null,
  actor: written(row) && row.comment_account ? writers(row.comment_account) : row.ref_uid ? toRef(row) : null,
  excerpt: row.excerpt, data: row.data ? JSON.parse(row.data) : null,
})

/** GET /notifications?before=. */
export async function listNotifications(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context, { stopped: true })
  const db = context.env.LB
  const [rows, unread] = await Promise.all([notificationsOf(db, session.accountId, parseCursor(context.url.searchParams.get('before')), PAGE),
    unreadCount(db, session.accountId)])
  const writers = await accountRefs(db, rows.filter(written).map((row) => row.comment_account))
  const body: NotificationsResponse = { notifications: rows.map(item(writers)), unread, next: rows.length === PAGE ? cursorOf(rows.at(-1)!) : null }
  return json(body)
}

/** POST /notifications/read { ids? }: the given ones, or all. */
export async function readNotifications(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context, { stopped: true })
  const { ids } = await readJsonBody<{ ids?: unknown }>(context.request)
  if (ids !== undefined && !(Array.isArray(ids) && ids.length <= 200 && ids.every((id) => typeof id === 'string'))) {
    throw new HttpError('bad_request', "oopsies... we could not mark those notifications as read. reopen your inbox and try again.")
  }
  await markReadStatement(context.env.LB, session.accountId, (ids as string[] | undefined) ?? null, context.now).run()
  return json({ unread: await unreadCount(context.env.LB, session.accountId) })
}
