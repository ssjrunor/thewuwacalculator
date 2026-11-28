/*
  Author: Runor Ewhro
  description: the ruleset catalog: published rulesets, their scenarios
               numbered into each resonator's cells, and the live ruleset.
               boards read it to install a ruleset (board/BoardDO.ts), and the
               api reads it for a cell's scenario.
*/

import type { ScenarioSummary } from '@lb/contract/api'
import type { RulesetManifest, ScenarioDef } from '@lb/contract/ruleset'

export interface RulesetRow {
  id: string
  no: number
  game_ver: string
  engine_ver: string
  rotation_ver: string
  manifest_key: string
  manifest_sha256: string
  status: 'building' | 'live' | 'archived'
  created_at: number
  live_at: number | null
  archived_at: number | null
  // tools/lib/fingerprint.mjs: the scorer bundle and ruleset data it was built from
  fingerprint?: string | null
  // the scorer bundle's hash it was published with
  scorer?: string | null
  // the scorer's hash in parts: its generator (src/engine/rotationGen) and everything else it scores with
  generator_fp?: string | null
  evaluation_fp?: string | null
}

export interface ScenarioRow {
  id: string
  rs: number
  ruleset_id: string
  resonator_id: string
  cell: number
  team_id: string
  recipe_sha256: string
  team_key: string
  team_rank: number
  weapon_id: string
  weapon_rank: number
  weapon_role: ScenarioDef['weapon']['role']
  // json: member resonator ids in slot order
  members: string
  fingerprint: string | null
  data_fingerprint: string | null
}

export const LIVE_RULESET = 'live_ruleset'

export async function liveRulesetId(db: D1Database): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(LIVE_RULESET).first<{ value: string }>()
  return row?.value ?? null
}

export const getRuleset = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM rulesets WHERE id = ?').bind(id).first<RulesetRow>()

export const rulesetKey = (id: string, path: string) => `rulesets/${id}/${path}`

// the key of a scenario within its ruleset: '<resonator>:<team>:<weapon>'
export const scenarioKey = (row: Pick<ScenarioRow, 'id' | 'ruleset_id'>) => row.id.slice(row.ruleset_id.length + 1)

export function summaryOf(row: ScenarioRow): ScenarioSummary {
  return { id: row.id, resonatorId: row.resonator_id, teamKey: row.team_key, teamRank: row.team_rank,
    members: JSON.parse(row.members) as string[], weaponId: row.weapon_id, weaponRole: row.weapon_role }
}

export async function rulesetScenarios(db: D1Database, rulesetId: string): Promise<ScenarioRow[]> {
  const { results } = await db.prepare('SELECT * FROM scenarios WHERE ruleset_id = ? ORDER BY resonator_id, cell')
    .bind(rulesetId).all<ScenarioRow>()
  return results
}

// a ruleset's scenarios by id, read once per isolate and ruleset because published rulesets do not change
const catalogs = new Map<string, Promise<Map<string, ScenarioRow>>>()
export function scenarioCatalog(db: D1Database, rulesetId: string): Promise<Map<string, ScenarioRow>> {
  let found = catalogs.get(rulesetId)
  if (!found) {
    found = rulesetScenarios(db, rulesetId).then((rows) => new Map(rows.map((row) => [row.id, row])))
    found.catch(() => catalogs.delete(rulesetId))
    // an empty result may be a ruleset still publishing, so it is not cached
    found.then((rows) => { if (!rows.size) catalogs.delete(rulesetId) }, () => undefined)
    catalogs.set(rulesetId, found)
  }
  return found
}

// each resonator's scenarios numbered into cells: best team first, then the weapon's rank, then the id
export function numberCells(scenarios: ScenarioDef[]): Map<string, number> {
  const byResonator = new Map<string, ScenarioDef[]>()
  for (const def of scenarios) byResonator.set(def.resonatorId, [...byResonator.get(def.resonatorId) ?? [], def])
  const cells = new Map<string, number>()
  for (const defs of byResonator.values()) {
    defs.sort((a, b) => a.teamRank - b.teamRank || a.weapon.rank - b.weapon.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .forEach((def, cell) => cells.set(def.id, cell))
  }
  return cells
}

// the next ruleset number, one past every number issued, so board table names stay unique
export async function nextRulesetNo(db: D1Database): Promise<number> {
  return ((await db.prepare('SELECT MAX(no) AS no FROM rulesets').first<{ no: number | null }>())?.no ?? 0) + 1
}

// the statements that publish a ruleset as `building`, run in batches
export function publishStatements(db: D1Database, manifest: RulesetManifest, manifestSha256: string, no: number, now: number): D1PreparedStatement[] {
  const statements = [db.prepare(`INSERT INTO rulesets (id, no, game_ver, engine_ver, rotation_ver, manifest_key, manifest_sha256,
      status, created_at, live_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'building', ?, NULL, NULL)`)
    .bind(manifest.id, no, manifest.gameVer, manifest.engineVer, manifest.rotationVer, rulesetKey(manifest.id, 'manifest.json'),
      manifestSha256, now)]
  const cells = numberCells(manifest.scenarios)
  for (const def of manifest.scenarios) {
    const members = [...def.members].sort((a, b) => a.slot - b.slot).map((member) => member.resonatorId)
    statements.push(db.prepare(`INSERT INTO scenarios (id, rs, ruleset_id, resonator_id, cell, team_id, recipe_sha256, team_key, team_rank,
        weapon_id, weapon_rank, weapon_role, members) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(def.id, no, manifest.id, def.resonatorId, cells.get(def.id)!, def.teamId, def.recipeSha256, def.teamKey, def.teamRank,
        def.weapon.id, def.weapon.rank, def.weapon.role, JSON.stringify(members)))
  }
  return statements
}

// makes `id` live and archives the previous ruleset in one batch; each board applies it on its next catalog sync
export function goLiveStatements(db: D1Database, id: string, now: number): D1PreparedStatement[] {
  return [
    db.prepare(`UPDATE rulesets SET status = 'archived', archived_at = ? WHERE status = 'live' AND id <> ?`).bind(now, id),
    db.prepare(`UPDATE rulesets SET status = 'live', live_at = ? WHERE id = ? AND status = 'building'`).bind(now, id),
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(LIVE_RULESET, id, now),
  ]
}

// the resonators a ruleset scores
export async function rulesetResonators(db: D1Database, rulesetId: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT DISTINCT resonator_id FROM scenarios WHERE ruleset_id = ? ORDER BY resonator_id')
    .bind(rulesetId).all<{ resonator_id: string }>()
  return results.map((row) => row.resonator_id)
}

// a body with every scenario's fingerprint: about 90 bytes each
export const FINGERPRINT_BODY_BYTES = 2_000_000

// a sha256 hex string, or null
export const hexOr = (value: unknown): string | null => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null

// a scenario's fingerprint is 64 hex characters, keyed by its id without the ruleset ('<resonator>:<team>:<weapon>')
export function validScenarioFingerprints(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  return entries.every(([key, fp]) => /^[^:]+:[^:]+:[^:]+$/.test(key) && typeof fp === 'string' && /^[0-9a-f]{64}$/.test(fp))
    ? Object.fromEntries(entries) as Record<string, string> : null
}

// which of a scenario's fingerprints: with the scorer, or of its data alone
export type ScenarioFingerprintColumn = 'fingerprint' | 'data_fingerprint'

// records scenario fingerprints on a ruleset's scenarios, leaving existing values unchanged
export const scenarioFingerprintsStatement = (db: D1Database, rulesetId: string, fingerprints: Record<string, string>,
  column: ScenarioFingerprintColumn = 'fingerprint', { replace = false } = {}) =>
  db.prepare(`UPDATE scenarios SET ${column} = (SELECT value FROM json_each(?2) WHERE key = substr(scenarios.id, length(?1) + 2))
    WHERE ruleset_id = ?1${replace ? '' : ` AND ${column} IS NULL`} AND substr(id, length(?1) + 2) IN (SELECT key FROM json_each(?2))`)
    .bind(rulesetId, JSON.stringify(fingerprints))

// a ruleset's recorded fingerprint counts: with the scorer, and of data alone
export async function fingerprintCounts(db: D1Database, rulesetId: string): Promise<{ scenarios: number; data: number }> {
  const row = await db.prepare('SELECT COUNT(fingerprint) AS scenarios, COUNT(data_fingerprint) AS data FROM scenarios WHERE ruleset_id = ?')
    .bind(rulesetId).first<{ scenarios: number; data: number }>()
  return { scenarios: row?.scenarios ?? 0, data: row?.data ?? 0 }
}
