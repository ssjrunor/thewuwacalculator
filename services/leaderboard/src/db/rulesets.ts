/*
  Author: Runor Ewhro
  description: stores published rulesets, scenario membership, reference values, and the live-version selection.
*/

import type { RulesetManifest, ScenarioDef, ScenarioRefs } from '@/domain/leaderboard/ruleset'

export interface RulesetRow {
  id: string
  game_ver: string
  engine_ver: string
  rotation_ver: string
  manifest_key: string
  manifest_sha256: string
  status: 'building' | 'live' | 'archived'
  created_at: number
  live_at: number | null
  archived_at: number | null
}

export interface ScenarioRow {
  id: string
  ruleset_id: string
  resonator_id: string
  team_id: string
  recipe_sha256: string
  team_key: string
  weapon_id: string
  weapon_rank: number
  weapon_role: ScenarioDef['weapon']['role']
  team_rank: number
}

export const LIVE_RULESET = 'live_ruleset'

export async function liveRulesetId(db: D1Database): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(LIVE_RULESET).first<{ value: string }>()
  return row?.value ?? null
}

export const getRuleset = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM rulesets WHERE id = ?').bind(id).first<RulesetRow>()

export const rulesetKey = (id: string, path: string) => `rulesets/${id}/${path}`

/** every scenario of a resonator in a ruleset, best team first. */
export async function scenariosFor(db: D1Database, rulesetId: string, resonatorId: string): Promise<ScenarioRow[]> {
  const { results } = await db.prepare(`SELECT * FROM scenarios WHERE ruleset_id = ? AND resonator_id = ?
    ORDER BY team_rank, id`).bind(rulesetId, resonatorId).all<ScenarioRow>()
  return results
}

// deduplicate requested ids and bound each SQL IN list to 50 parameters.
export async function scenariosByIds(db: D1Database, ids: string[]): Promise<ScenarioRow[]> {
  const rows: ScenarioRow[] = []
  const unique = [...new Set(ids)]
  for (let start = 0; start < unique.length; start += 50) {
    const chunk = unique.slice(start, start + 50)
    const { results } = await db.prepare(`SELECT * FROM scenarios WHERE id IN (${chunk.map(() => '?').join(', ')})`)
      .bind(...chunk).all<ScenarioRow>()
    rows.push(...results)
  }
  return rows
}

export async function rulesetScenarios(db: D1Database, rulesetId: string): Promise<ScenarioRow[]> {
  const { results } = await db.prepare('SELECT * FROM scenarios WHERE ruleset_id = ? ORDER BY resonator_id, team_rank, id')
    .bind(rulesetId).all<ScenarioRow>()
  return results
}

export async function scenarioMembers(db: D1Database, scenarioIds: string[]): Promise<Map<string, string[]>> {
  const members = new Map<string, string[]>()
  // d1 caps bound parameters per statement, so look scenarios up in chunks.
  for (let start = 0; start < scenarioIds.length; start += 50) {
    const chunk = scenarioIds.slice(start, start + 50)
    const { results } = await db.prepare(`SELECT scenario_id, resonator_id FROM scenario_members
      WHERE scenario_id IN (${chunk.map(() => '?').join(', ')}) ORDER BY scenario_id, slot`).bind(...chunk)
      .all<{ scenario_id: string; resonator_id: string }>()
    for (const row of results) members.set(row.scenario_id, [...members.get(row.scenario_id) ?? [], row.resonator_id])
  }
  return members
}

/** the statements that publish a ruleset as `building`. run them in batches. */
export function publishStatements(db: D1Database, manifest: RulesetManifest, manifestSha256: string,
  refs: ScenarioRefs[], now: number): D1PreparedStatement[] {
  const statements = [db.prepare(`INSERT INTO rulesets (id, game_ver, engine_ver, rotation_ver, manifest_key, manifest_sha256,
      status, created_at, live_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, 'building', ?, NULL, NULL)`)
    .bind(manifest.id, manifest.gameVer, manifest.engineVer, manifest.rotationVer, rulesetKey(manifest.id, 'manifest.json'),
      manifestSha256, now)]
  for (const def of manifest.scenarios) {
    statements.push(db.prepare(`INSERT INTO scenarios (id, ruleset_id, resonator_id, team_id, recipe_sha256, team_key,
        weapon_id, weapon_rank, weapon_role, team_rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(def.id, manifest.id, def.resonatorId, def.teamId, def.recipeSha256, def.teamKey, def.weapon.id,
        def.weapon.rank, def.weapon.role, def.teamRank))
    for (const member of def.members) {
      statements.push(db.prepare(`INSERT INTO scenario_members (scenario_id, slot, resonator_id, mode, team_slot, is_context)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(def.id, member.slot, member.resonatorId, member.mode, member.teamSlot, member.isContext ? 1 : 0))
    }
  }
  for (const entry of refs) {
    statements.push(db.prepare(`INSERT INTO scenario_refs (scenario_id, sequence, baseline_dps, bench_dps, perfect_dps, programs, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(entry.scenarioId, entry.sequence, entry.baselineDps, entry.benchDps, entry.perfectDps,
      JSON.stringify(entry.programs), entry.status))
  }
  return statements
}

/** make `id` live and archive the one before it, in one batch. */
// execute these statements in one batch so the archived version, new live version, and settings pointer change together.
export function goLiveStatements(db: D1Database, id: string, now: number): D1PreparedStatement[] {
  return [
    db.prepare(`UPDATE rulesets SET status = 'archived', archived_at = ? WHERE status = 'live' AND id <> ?`).bind(now, id),
    db.prepare(`UPDATE rulesets SET status = 'live', live_at = ? WHERE id = ? AND status = 'building'`).bind(now, id),
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(LIVE_RULESET, id, now),
  ]
}

/** archived rulesets keep their board and drop per-scenario scores. */
export const dropArchivedScoresStatement = (db: D1Database, id: string) =>
  db.prepare(`DELETE FROM build_scores WHERE scenario_id IN (SELECT id FROM scenarios WHERE ruleset_id = ?)
    AND EXISTS (SELECT 1 FROM rulesets WHERE id = ? AND status = 'archived')`).bind(id, id)

/** active builds of every resonator a ruleset scores (the rescore set). */
export async function activeBuildIdsFor(db: D1Database, rulesetId: string): Promise<string[]> {
  const { results } = await db.prepare(`SELECT b.id FROM builds b WHERE b.state = 'active'
    AND b.resonator_id IN (SELECT DISTINCT resonator_id FROM scenarios WHERE ruleset_id = ?) ORDER BY b.id`)
    .bind(rulesetId).all<{ id: string }>()
  return results.map((row) => row.id)
}

/** building rulesets whose rescore has started: new active builds are scored into them too. */
export async function rescoringRulesetIds(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(`SELECT r.id FROM rulesets r WHERE r.status = 'building'
    AND EXISTS (SELECT 1 FROM score_jobs j WHERE j.ruleset_id = r.id) ORDER BY r.id`).all<{ id: string }>()
  return results.map((row) => row.id)
}
