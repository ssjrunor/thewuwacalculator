/*
  Author: Runor Ewhro
  description: selects the boards a rollout carries over unchanged. a board is carried when every build on it would
               keep every score: it scores the same scenarios in the same cells (team, weapon and members alike), each
               scenario's fingerprint (scorer and data, tools/lib/fingerprint.mjs) is recorded and equal, its offline
               anchors hash alike, and every unit a build of it can read hashes alike: the scenario's own (definition,
               plan, selections, weapons, members and their forms) and every echo, set, enemy and shared unit, because
               a build may wear any echo. a carried board installs nothing while the rollout runs and takes the new
               ruleset at go-live by renaming its tables (BoardStore.carryLive); every other board installs the
               ruleset and fans out its builds. a missing manifest, unit file or fingerprint carries nothing.
*/

import { resonatorForms } from '@lb/scoring'
import type { RulesetManifest } from '@lb/contract/ruleset'
import type { ScenarioRow } from '../../db/rulesets.ts'
import { rulesetKey, rulesetScenarios, scenarioKey } from '../../db/rulesets.ts'
import type { ApiEnv } from '../../env.ts'

export interface CarrySide {
  manifest: RulesetManifest
  // units.json's unit hashes, or null for a ruleset without units
  units: Record<string, string> | null
  scenarios: ScenarioRow[]
}

// units every build of every board may read: the echoes and sets it wears, and the shared and enemy data
const GLOBAL_UNIT = /^(echo|set|enemy|shared):/

// the cell's place on its board, which must match for the board's entries and facets to stay as they are
const cellShape = (row: ScenarioRow) => JSON.stringify([row.cell, row.team_id, row.recipe_sha256, row.team_key, row.team_rank,
  row.weapon_id, row.weapon_rank, row.weapon_role, row.members])

const anchorHashes = (manifest: RulesetManifest, resonator: string): Map<string, string> => {
  const dir = manifest.files.anchors
  const out = new Map<string, string>()
  if (!dir) return out
  const prefix = `${dir}${resonator}/`
  for (const [path, entry] of Object.entries(manifest.hashes)) if (path.startsWith(prefix)) out.set(path, entry.sha256)
  return out
}

const sameMap = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>) =>
  a.size === b.size && [...a].every(([key, value]) => b.get(key) === value)

// the units a scenario reads whatever build it scores (scoreReads.ts scenarioReads, without the build's own gear;
// the teammates' gear is in the scenario's fingerprint)
function scenarioUnits(row: ScenarioRow): string[] {
  const units = [`def:${scenarioKey(row)}`, `plan:${row.team_id}`, `selection:${row.resonator_id}`, `selection-team:${row.team_id}`,
    `weapon:${row.weapon_id}`]
  for (const member of JSON.parse(row.members) as string[]) {
    for (const form of resonatorForms(member)) units.push(`resonator:${form}`, `teammates:${form}`)
  }
  return units
}

// the resonators whose boards the rollout from `from` to `to` leaves as they are
export function carriedResonators(from: CarrySide, to: CarrySide): string[] {
  if (!from.units || !to.units) return []
  const fromUnits = new Map(Object.entries(from.units))
  const toUnits = new Map(Object.entries(to.units))
  // a change to any unit every build may read affects every board
  const global = (units: Map<string, string>) => new Map([...units].filter(([key]) => GLOBAL_UNIT.test(key)))
  if (!sameMap(global(fromUnits), global(toUnits))) return []
  // a refs file feeds every scenario without offline anchors
  const refs = (manifest: RulesetManifest) => manifest.files.refs ? manifest.hashes[manifest.files.refs]?.sha256 ?? 'missing' : null
  if (refs(from.manifest) !== refs(to.manifest)) return []

  const byResonator = (rows: ScenarioRow[]) => {
    const out = new Map<string, Map<string, ScenarioRow>>()
    for (const row of rows) {
      const board = out.get(row.resonator_id) ?? new Map<string, ScenarioRow>()
      board.set(scenarioKey(row), row)
      out.set(row.resonator_id, board)
    }
    return out
  }
  const before = byResonator(from.scenarios)
  const after = byResonator(to.scenarios)
  const carried: string[] = []
  for (const [resonator, next] of after) {
    const old = before.get(resonator)
    if (!old || old.size !== next.size) continue
    const unchanged = [...next].every(([key, row]) => {
      const was = old.get(key)
      if (!was || cellShape(was) !== cellShape(row)) return false
      if (!row.fingerprint || row.fingerprint !== was.fingerprint) return false
      return scenarioUnits(row).every((unit) => (fromUnits.get(unit) ?? null) === (toUnits.get(unit) ?? null))
    })
    if (unchanged && sameMap(anchorHashes(from.manifest, resonator), anchorHashes(to.manifest, resonator))) carried.push(resonator)
  }
  return carried.sort()
}

// a ruleset's side of the comparison from its published files, or null when one is missing
export async function carrySide(env: Pick<ApiEnv, 'LB' | 'LB_DATA'>, rulesetId: string): Promise<CarrySide | null> {
  const manifest = await (await env.LB_DATA.get(rulesetKey(rulesetId, 'manifest.json')))?.json<RulesetManifest>()
  if (!manifest) return null
  const path = manifest.files.units
  const units = path ? (await (await env.LB_DATA.get(rulesetKey(rulesetId, path)))?.json<{ units: Record<string, string> }>())?.units ?? null : null
  return { manifest, units, scenarios: await rulesetScenarios(env.LB, rulesetId) }
}
