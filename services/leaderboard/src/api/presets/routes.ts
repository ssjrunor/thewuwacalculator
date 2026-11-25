/*
  Author: Runor Ewhro
  description: showcase card presets, named card styles an account saves and
               can share. GET /presets lists the account's presets; POST /presets
               creates one; PATCH and DELETE /presets/:id update or delete it;
               GET /presets/:id opens an own or shared preset (another account's
               images show once approved). styles are checked by the card schema
               and may reference only the writer's own uploads.
*/

import * as z from 'zod/mini'
import type { CardPreset, CardPresetRequest, CardPresetsResponse } from '@lb/contract/api'
import { DOCUMENTS, documentMedia, withApprovedMedia, type CardDoc, type CardStyle } from '@lb/contract/documents'
import { auditStatement } from '../../lib/audit.ts'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import { uuidv7 } from '../../lib/ids.ts'
import { approvedOf } from '../../db/media.ts'
import type { RouteContext } from '../router.ts'
import { optionalSession, requireAccount } from '../auth/sessions.ts'
import { assertNotMuted } from '../auth/writers.ts'
import { checkMedia } from '../documents/routes.ts'

const PRESET_CAP = 50

interface PresetRow {
  id: string
  account_id: string
  name: string
  style: string
  shared: number
  created_at: number
  updated_at: number
}

const getPreset = (db: D1Database, id: string) => db.prepare('SELECT * FROM card_presets WHERE id = ?').bind(id).first<PresetRow>()

const preset = (row: PresetRow, viewer: string | null, style: CardStyle = JSON.parse(row.style)): CardPreset => ({
  id: row.id, name: row.name, style, shared: row.shared === 1, own: row.account_id === viewer, createdAt: row.created_at, updatedAt: row.updated_at,
})

function cleanName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > 40) throw new HttpError('bad_request', 'a name is 1 to 40 characters')
  return name
}

/** parses a style with the card schema and drops hidden parts, which presets do not store. */
async function cleanStyle(db: D1Database, accountId: string, value: unknown): Promise<CardStyle> {
  const result = DOCUMENTS.card.schema.safeParse({ style: value, hidden: {} })
  if (!result.success) throw new HttpError('bad_request', z.prettifyError(result.error))
  await checkMedia(db, accountId, documentMedia('card', result.data))
  return result.data.style
}

async function ownPreset(context: RouteContext, accountId: string): Promise<PresetRow> {
  const row = await getPreset(context.env.LB, context.params.id)
  if (!row || row.account_id !== accountId) throw new HttpError('not_found', 'no such preset')
  return row
}

const writeAudit = (db: D1Database, accountId: string, action: 'preset.write' | 'preset.delete', presetId: string, now: number) =>
  auditStatement(db, { actorKind: 'account', actorId: accountId, action, subjectKind: 'account', subjectId: accountId, data: { presetId } }, now)

/** GET /presets. */
export async function listPresets(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const { results } = await context.env.LB.prepare('SELECT * FROM card_presets WHERE account_id = ? ORDER BY updated_at DESC')
    .bind(session.accountId).all<PresetRow>()
  const body: CardPresetsResponse = { presets: results.map((row) => preset(row, session.accountId)) }
  return json(body)
}

/** GET /presets/:id: an own or shared preset. */
export async function getSharedPreset(context: RouteContext): Promise<Response> {
  const viewer = (await optionalSession(context))?.accountId ?? null
  const db = context.env.LB
  const row = await getPreset(db, context.params.id)
  if (!row || (row.account_id !== viewer && row.shared !== 1)) throw new HttpError('not_found', 'no such preset')
  if (row.account_id === viewer) return json(preset(row, viewer))
  const card = { style: JSON.parse(row.style), hidden: {} } as CardDoc
  const shown = withApprovedMedia('card', card, await approvedOf(db, documentMedia('card', card)))
  return json(preset(row, viewer, shown.style))
}

/** POST /presets { name, style, shared? }. */
export async function createPreset(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  await assertNotMuted(db, session, context.now)
  const count = (await db.prepare('SELECT COUNT(*) AS n FROM card_presets WHERE account_id = ?').bind(session.accountId).first<{ n: number }>())?.n ?? 0
  if (count >= PRESET_CAP) throw new HttpError('rate_limited', `you can keep ${PRESET_CAP} presets`)
  const request = await readJsonBody<Partial<CardPresetRequest>>(context.request)
  const name = cleanName(request.name)
  const style = await cleanStyle(db, session.accountId, request.style)
  const id = uuidv7(context.now)
  await db.batch([db.prepare(`INSERT INTO card_presets (id, account_id, name, style, shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, session.accountId, name, JSON.stringify(style), request.shared ? 1 : 0, context.now, context.now),
    writeAudit(db, session.accountId, 'preset.write', id, context.now)])
  return json(preset((await getPreset(db, id))!, session.accountId), { status: 201 })
}

/** PATCH /presets/:id { name?, style?, shared? }. */
export async function updatePreset(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  await assertNotMuted(db, session, context.now)
  const row = await ownPreset(context, session.accountId)
  const request = await readJsonBody<Partial<CardPresetRequest>>(context.request)
  const name = request.name === undefined ? row.name : cleanName(request.name)
  const style = request.style === undefined ? row.style : JSON.stringify(await cleanStyle(db, session.accountId, request.style))
  const shared = request.shared === undefined ? row.shared : request.shared ? 1 : 0
  await db.batch([db.prepare('UPDATE card_presets SET name = ?, style = ?, shared = ?, updated_at = ? WHERE id = ?')
    .bind(name, style, shared, context.now, row.id), writeAudit(db, session.accountId, 'preset.write', row.id, context.now)])
  return json(preset((await getPreset(db, row.id))!, session.accountId))
}

/** DELETE /presets/:id. */
export async function deletePreset(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  const row = await ownPreset(context, session.accountId)
  await db.batch([db.prepare('DELETE FROM card_presets WHERE id = ?').bind(row.id),
    writeAudit(db, session.accountId, 'preset.delete', row.id, context.now)])
  return json({ ok: true })
}
