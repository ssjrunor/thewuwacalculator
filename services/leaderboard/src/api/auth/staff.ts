/*
  Author: Runor Ewhro
  description: authorizes staff routes by checking the caller's role for a
               permission. a cloudflare access token is an admin; any other
               caller is a signed-in account with its role. in local dev, the
               `lb` tool is an admin through DEV_ADMIN_TOKEN in .dev.vars on a
               request to this machine. the result is the actor in the audit log.
*/

import { can, type Permission, type Role } from '@lb/contract/permissions'
import { verifyAccess } from '../../lib/access.ts'
import { auditStatement, type Actor, type AuditEntry } from '../../lib/audit.ts'
import { HttpError } from '../../lib/http.ts'
import { getAccount } from '../../db/accounts.ts'
import type { RouteContext } from '../router.ts'
import { optionalSession } from './sessions.ts'

export interface Staff extends Actor {
  actorKind: 'admin' | 'account'
  actorId: string
  role: Role
}

/** returns the staff member for the request when their role grants `permission`; throws a 403 otherwise. */
export async function authorize(context: RouteContext, permission: Permission): Promise<Staff> {
  const staff = await staffWith(context, permission)
  if (!staff) throw new HttpError('forbidden', 'you may not do this')
  return staff
}

/** returns the staff member when their role grants `permission`, else null; used by responses with extra staff fields. */
export async function staffWith(context: RouteContext, permission: Permission): Promise<Staff | null> {
  const staff = await staffOf(context)
  return staff && can(staff.role, permission) ? staff : null
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** local dev only: a request to this machine with the .dev.vars token; deployed workers have no token. */
export const isLocalDevAdmin = (context: RouteContext): boolean => devAdmin(context)

function devAdmin(context: RouteContext): boolean {
  const token = context.env.DEV_ADMIN_TOKEN
  const sent = context.request.headers.get('x-lb-dev-admin')
  return !!token && token.length >= 32 && sent === token && LOOPBACK.has(context.url.hostname)
}

async function staffOf(context: RouteContext): Promise<Staff | null> {
  if (devAdmin(context)) return { actorKind: 'admin', actorId: 'local-dev', role: 'admin' }
  if (context.request.headers.has('cf-access-jwt-assertion')) {
    const who = await verifyAccess(context.request, { team: context.env.ACCESS_TEAM_DOMAIN, audience: context.env.ACCESS_AUD })
    return { actorKind: 'admin', actorId: who.email ?? who.subject, role: 'admin' }
  }
  const session = await optionalSession(context)
  const account = session?.accountId ? await getAccount(context.env.LB, session.accountId) : null
  return account && account.role !== 'user' ? { actorKind: 'account', actorId: account.id, role: account.role } : null
}

/** how the audit log and moderation records name a staff member. */
export const staffName = (staff: Staff): string => `${staff.actorKind}:${staff.actorId}`

/** an audit entry in a staff member's name. */
export const staffAudit = (context: RouteContext, who: Staff, entry: Omit<AuditEntry, 'actorKind' | 'actorId'>) =>
  auditStatement(context.env.LB, { actorKind: who.actorKind, actorId: who.actorId, ...entry }, context.now)
