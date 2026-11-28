/*
  Author: Runor Ewhro
  description: which boards a rollout carries over: a board whose scenarios, cells, fingerprints, anchors and read
               units all match is carried; a new board, or a changed scenario fingerprint, anchor or scenario unit, is
               not carried, and a change to a unit every build may read (an echo) carries nothing.
*/

import { describe, expect, it } from 'vitest'
import type { RulesetManifest } from '@lb/contract/ruleset'
import { carriedResonators, type CarrySide } from '../src/api/moderation/carry.ts'
import type { ScenarioRow } from '../src/db/rulesets.ts'

function row(rulesetId: string, resonator: string, team: string, cell: number, fingerprint: string | null = `fp-${resonator}-${team}`): ScenarioRow {
  return { id: `${rulesetId}:${resonator}:${team}:21020086`, rs: 1, ruleset_id: rulesetId, resonator_id: resonator, cell, team_id: team,
    recipe_sha256: 'r', team_key: team, team_rank: cell, weapon_id: '21020086', weapon_rank: 1, weapon_role: 'signature',
    members: JSON.stringify([resonator, '1205']), fingerprint, data_fingerprint: null }
}

const UNITS = { 'echo:6000001': 'e1', 'set:1': 's1', 'shared:actions.json': 'a', 'enemy:1': 'n', 'def:1108:t1:21020086': 'd1',
  'def:1506:t1:21020086': 'd2', 'plan:t1': 'p', 'selection:1108': 'x', 'selection:1506': 'y', 'selection-team:t1': 'st',
  'weapon:21020086': 'w', 'resonator:1108': 'r1', 'resonator:1506': 'r2', 'resonator:1205': 'r3', 'teammates:1205': 't' }

function side(id: string, { units = UNITS as Record<string, string> | null, anchors = { '1108': 'a1', '1506': 'a2' } as Record<string, string>,
  scenarios = [row(id, '1108', 't1', 0), row(id, '1506', 't1', 0)] } = {}): CarrySide {
  const hashes: RulesetManifest['hashes'] = {}
  for (const [resonator, sha256] of Object.entries(anchors)) hashes[`anchors/${resonator}/t1-21020086.json`] = { bytes: 1, sha256 }
  const manifest = { id, files: { anchors: 'anchors/', units: 'units.json', refs: null }, hashes, scenarios: [] } as unknown as RulesetManifest
  return { manifest, units, scenarios }
}

describe('carried boards', () => {
  it('carries every board whose scenarios and reads match', () => {
    expect(carriedResonators(side('old'), side('new'))).toEqual(['1108', '1506'])
  })

  it('excludes a board with a changed fingerprint, anchor, scenario unit or cell, and a new board', () => {
    expect(carriedResonators(side('old'), side('new', { scenarios: [row('new', '1108', 't1', 0, 'other'), row('new', '1506', 't1', 0)] })))
      .toEqual(['1506'])
    expect(carriedResonators(side('old'), side('new', { anchors: { '1108': 'a1', '1506': 'changed' } }))).toEqual(['1108'])
    expect(carriedResonators(side('old'), side('new', { units: { ...UNITS, 'selection:1506': 'changed' } }))).toEqual(['1108'])
    expect(carriedResonators(side('old'), side('new', { scenarios: [row('new', '1108', 't1', 1), row('new', '1506', 't1', 0)] })))
      .toEqual(['1506'])
    expect(carriedResonators(side('old'), side('new', { scenarios: [row('new', '1108', 't1', 0), row('new', '1506', 't1', 0),
      row('new', '1609', 't1', 0)] }))).toEqual(['1108', '1506'])
    // an unrecorded fingerprint proves nothing
    expect(carriedResonators(side('old', { scenarios: [row('old', '1108', 't1', 0, null), row('old', '1506', 't1', 0)] }), side('new')))
      .toEqual(['1506'])
  })

  it('carries nothing when a unit every build may read changed, or units are missing', () => {
    expect(carriedResonators(side('old'), side('new', { units: { ...UNITS, 'echo:6000001': 'changed' } }))).toEqual([])
    expect(carriedResonators(side('old'), side('new', { units: { ...UNITS, 'echo:6000002': 'added' } }))).toEqual([])
    expect(carriedResonators(side('old'), side('new', { units: null }))).toEqual([])
  })
})
