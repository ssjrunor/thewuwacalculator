/*
  Author: Runor Ewhro
  description: verifies the savedRotationList.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import type { RotationComparisonSummary } from '@/domain/entities/rotationSummary.ts'
import { defaultSavedPrefs, makeResProfile, makeScenarioFromProfiles } from '@/engine/runtime/defaults.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  makeSavedEntry as buildSvdLstEnt,
  makeSavedEntries as buildSvdLstEnts,
  makeMemberTakes,
  makeSavedRoster,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/savedRotationList.ts'

const calculatedSummaries = new WeakMap<SavedRotation, RotationComparisonSummary>()

function entry(
  partial: Partial<Omit<SavedRotation, 'scenario'>>
    & Pick<SavedRotation, 'id' | 'name'>
    & { resonatorId: string; resonatorName?: string; items?: RotationNode[] }
    & { summary?: RotationComparisonSummary },
): SavedRotation {
  const { summary, resonatorId, items = [], ...savedFields } = partial
  const seed = getResSeedBy('1108')
  if (!seed) throw new Error('Missing fixture resonator 1108')
  const profile = makeResProfile(seed)
  const scenario = makeScenarioFromProfiles({ [seed.id]: profile }, null, 0, seed.id)
  scenario.team.members[0].resonatorId = resonatorId
  scenario.program.program = items
  const saved: SavedRotation = {
    duration: 20,
    note: '',
    scenario,
    createdAt: 1,
    updatedAt: 1,
    ...savedFields,
  }
  if (summary) calculatedSummaries.set(saved, summary)
  return saved
}

function makeSavedEntry(...args: Parameters<typeof buildSvdLstEnt>) {
  const [saved, summary = calculatedSummaries.get(saved), decimals] = args
  return buildSvdLstEnt(saved, summary, decimals)
}

function makeSavedEntries(...args: Parameters<typeof buildSvdLstEnts>) {
  const [entries, prefs, query = '', summaries, decimals] = args
  const calculated = summaries ?? new Map(entries.flatMap((saved) => {
    const summary = calculatedSummaries.get(saved)
    return summary ? [[saved.id, summary] as const] : []
  }))
  return buildSvdLstEnts(entries, prefs, query, calculated, decimals)
}

describe('saved rotation list', () => {
  it('indexes every team member and keeps their damage attached to each saved entry', () => {
    const rows = [
      makeSavedEntry(entry({
        id: 'first',
        name: 'First take',
        resonatorId: 'a',
        summary: {
          total: { normal: 700, avg: 1000, crit: 1300 },
          members: [
            { id: 'a', name: 'A', contribution: { normal: 420, avg: 600, crit: 780 } },
            { id: 'b', name: 'B', contribution: { normal: 280, avg: 400, crit: 520 } },
          ],
        },
      })),
      makeSavedEntry(entry({
        id: 'second',
        name: 'Second take',
        resonatorId: 'c',
        summary: {
          total: { normal: 600, avg: 800, crit: 1000 },
          members: [
            { id: 'b', name: 'B', contribution: { normal: 150, avg: 200, crit: 250 } },
            { id: 'c', name: 'C', contribution: { normal: 450, avg: 600, crit: 750 } },
          ],
        },
      })),
    ]

    expect(makeSavedRoster(rows).map((member) => [member.id, member.damage, member.entries]))
      .toEqual([['a', 600, 1], ['b', 600, 2], ['c', 600, 1]])
    expect(makeMemberTakes(rows, 'b').map((take) => [take.id, take.damage, take.share]))
      .toEqual([['first', 400, 0.4], ['second', 200, 0.25]])
  })

  it('uses recalculated summaries exclusively when the archive supplies them', () => {
    const saved = entry({
      id: 'team',
      name: 'Current result',
      resonatorId: 'a',
      resonatorName: 'A',
      summary: { total: { normal: 900, avg: 999, crit: 1_100 } },
    })
    const recalculated = new Map([[
      saved.id,
      { total: { normal: 100, avg: 123, crit: 150 } },
    ]])

    expect(makeSavedEntries([saved], defaultSavedPrefs(), '', recalculated)[0]?.avg).toBe(123)
    expect(makeSavedEntries([saved], defaultSavedPrefs(), '', new Map())).toEqual([])
  })
})
