/*
  Author: Runor Ewhro
  Description: Verifies the savedRotationList.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import type { RotationComparisonSummary } from '@/domain/entities/rotationSummary.ts'
import { defaultSavedPrefs, makeResProfile, makeScenarioFromProfiles } from '@/engine/runtime/defaults.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  formatSavedFigure,
  formatSavedTick,
  makeSavedAxis,
  makeSavedEntry as buildSvdLstEnt,
  makeSavedEntries as buildSvdLstEnts,
  groupSavedEntries,
  makeMemberTakes,
  rankSavedEntries,
  makeSavedRoster,
  makeSavedScale,
  makeSavedTicks,
  savedAxisWindow,
  resolveSavedAxis,
  savedEntryLabel,
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
  it('rounds row damage with the same precision as the detailed read', () => {
    expect(formatSavedFigure(2_023_614.511)).toBe('2,023,615')
    expect(formatSavedFigure(99.999)).toBe('100')
    expect(formatSavedFigure(2_023_614.519, 2)).toBe('2,023,614.52')
    expect(formatSavedTick(2_023_614.519, 2)).toBe('2.02M')
  })

  it('apportions member figures to the displayed rounded total', () => {
    const row = makeSavedEntry(entry({
      id: 'hiyuki',
      name: 'Hiyuki team',
      resonatorId: '1108',
      resonatorName: 'Hiyuki',
      summary: {
        total: { normal: 0, avg: 2_713_051.825620837, crit: 0 },
        members: [
          { id: '1108', name: 'Hiyuki', contribution: { normal: 0, avg: 2_206_828.4076496963, crit: 0 } },
          { id: '1109', name: 'Lucilla', contribution: { normal: 0, avg: 390_383.74877510796, crit: 0 } },
          { id: '1110', name: 'Suisui', contribution: { normal: 0, avg: 115_839.6691960342, crit: 0 } },
        ],
      },
    }))

    expect(row.members.reduce((sum, member) => sum + (member.figure ?? 0), 0))
      .toBe(Number(formatSavedFigure(row.avg).replaceAll(',', '')))
  })

  it('apportions member figures at the configured decimal precision', () => {
    const row = makeSavedEntry(entry({
      id: 'precise',
      name: 'Precise team',
      resonatorId: '1108',
      resonatorName: 'Hiyuki',
      summary: {
        total: { normal: 0, avg: 100.129, crit: 0 },
        members: [
          { id: '1108', name: 'Hiyuki', contribution: { normal: 0, avg: 33.376, crit: 0 } },
          { id: '1109', name: 'Lucilla', contribution: { normal: 0, avg: 66.753, crit: 0 } },
        ],
      },
    }), undefined, 2)

    const displayedMembers = row.members.reduce(
      (sum, member) => sum + Number(formatSavedFigure(member.figure ?? 0, 2).replaceAll(',', '')),
      0,
    )
    const displayedTotal = Number(formatSavedFigure(row.avg, 2).replaceAll(',', ''))

    expect(displayedMembers).toBeCloseTo(displayedTotal, 2)
  })

  it('strips the squad prefix so the row only keeps what the lead column does not already say', () => {
    const members = [
      { id: 'a', name: 'Augusta', accent: '', profile: '', sprite: '', faceX: 0, faceY: 0, faceScale: 1, share: 0.5, from: 0, to: 50 },
      { id: 'b', name: 'Iuno', accent: '', profile: '', sprite: '', faceX: 0, faceY: 0, faceScale: 1, share: 0.3, from: 50, to: 80 },
      { id: 'c', name: 'Shorekeeper', accent: '', profile: '', sprite: '', faceX: 0, faceY: 0, faceScale: 1, share: 0.2, from: 80, to: 100 },
    ] as const

    expect(savedEntryLabel(entry({
      id: '1',
      name: 'Augusta/Iuno/Shorekeeper Rotation 2',
      resonatorId: 'a',
      resonatorName: 'Augusta',
    }), [...members])).toBe('Rotation 2')

    expect(savedEntryLabel(entry({
      id: '2',
      name: 'Augusta Rotation',
      resonatorId: 'a',
      resonatorName: 'Augusta',
    }), [...members])).toBe('Rotation')
  })

  it('keeps one axis from zero in both views, so the backdrop cannot rebuild per section', () => {
    const rows = [
      makeSavedEntry(entry({
        id: 'low',
        name: 'Low',
        resonatorId: 'a',
        resonatorName: 'A',
        summary: { total: { normal: 100_000, avg: 120_000, crit: 150_000 } },
      })),
      makeSavedEntry(entry({
        id: 'high',
        name: 'High',
        resonatorId: 'b',
        resonatorName: 'B',
        summary: { total: { normal: 800_000, avg: 900_000, crit: 1_000_000 } },
      })),
    ]

    const axis = makeSavedAxis(rows)
    expect(axis.lo).toBe(0)
    expect(axis.at(0)).toBe(0)
    expect(axis.at(axis.hi)).toBe(1)
    expect(axis.at(1_000_000)).toBeCloseTo(1 / 1.02, 5)
    expect(makeSavedTicks(axis)[0]).toBe(0)
    expect(makeSavedScale(100, 200).lo).toBe(0)
  })

  it('lays the member runs end to end so the last one closes on the average', () => {
    const row = makeSavedEntry(entry({
      id: 'team',
      name: 'Team take',
      resonatorId: 'a',
      resonatorName: 'A',
      summary: {
        total: { normal: 700, avg: 1000, crit: 1300 },
        members: [
          { id: 'a', name: 'A', contribution: { normal: 420, avg: 600, crit: 780 } },
          { id: 'b', name: 'B', contribution: { normal: 210, avg: 300, crit: 390 } },
          { id: 'c', name: 'C', contribution: { normal: 70, avg: 100, crit: 130 } },
        ],
      },
    }))

    expect(row.members.map((member) => [member.from, member.to]))
      .toEqual([[0, 600], [600, 900], [900, 1000]])
    expect(row.members.at(-1)?.to).toBe(row.avg)
    expect(row.members.map((member) => Number(member.share.toFixed(2))))
      .toEqual([0.6, 0.3, 0.1])
  })

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

  it('finds a rotation by any contributing resonator, not only its lead', () => {
    const rotations = [entry({
      id: 'team',
      name: 'Opening sequence',
      resonatorId: 'a',
      resonatorName: 'Augusta',
      summary: {
        total: { normal: 700, avg: 1000, crit: 1300 },
        members: [
          { id: 'a', name: 'Augusta', contribution: { normal: 420, avg: 600, crit: 780 } },
          { id: 'b', name: 'Iuno', contribution: { normal: 280, avg: 400, crit: 520 } },
        ],
      },
    })]

    expect(makeSavedEntries(rotations, defaultSavedPrefs(), 'iuno').map((row) => row.id))
      .toEqual(['team'])
  })

  it('zooms from zero through the picked entry and pulls in a nearby higher take', () => {
    const rows = makeSavedEntries([
      entry({
        id: 'low',
        name: 'Low',
        resonatorId: 'a',
        resonatorName: 'A',
        summary: { total: { normal: 180_000, avg: 200_000, crit: 240_000 } },
      }),
      entry({
        id: 'mid',
        name: 'Mid',
        resonatorId: 'b',
        resonatorName: 'B',
        summary: { total: { normal: 700_000, avg: 800_000, crit: 900_000 } },
      }),
      entry({
        id: 'high',
        name: 'High',
        resonatorId: 'c',
        resonatorName: 'C',
        summary: { total: { normal: 1_000_000, avg: 1_100_000, crit: 1_200_000 } },
      }),
    ], { ...defaultSavedPrefs(), sortBy: 'avg', sortOrder: 'asc' })

    const full = makeSavedAxis(rows)
    const mid = rows.find((row) => row.id === 'mid')!

    expect(savedAxisWindow(rows, null, full)).toBe(full)

    const win = savedAxisWindow(rows, mid, full)
    /* the take just above is within a span of the picked entry's ceiling, so
       the window reaches for it while keeping the complete run from zero. */
    expect(win.lo).toBe(0)
    expect(win.at(0)).toBe(0)
    expect(win.hi).toBeLessThan(full.hi)
    expect(win.at(200_000)).toBeGreaterThan(0)
    expect(win.hi).toBeGreaterThanOrEqual(1_100_000)
    expect(win.at(mid.avg)).toBeGreaterThan(0)
    expect(win.at(mid.avg)).toBeLessThan(1)
  })

  it('keeps the full flat axis when selected-entry scaling is off', () => {
    const rows = makeSavedEntries([
      entry({
        id: 'low',
        name: 'Low',
        resonatorId: 'a',
        summary: { total: { normal: 100_000, avg: 120_000, crit: 150_000 } },
      }),
      entry({
        id: 'high',
        name: 'High',
        resonatorId: 'b',
        summary: { total: { normal: 800_000, avg: 900_000, crit: 1_000_000 } },
      }),
    ], defaultSavedPrefs())
    const full = makeSavedAxis(rows)

    expect(resolveSavedAxis(rows, rows[0]!, full, false)).toBe(full)
    expect(resolveSavedAxis(rows, rows[0]!, full, true)).not.toBe(full)
  })

  it('does not let one outsized take hand the window back to the full range', () => {
    const rows = makeSavedEntries([
      entry({
        id: 'pack-a',
        name: 'Pack A',
        resonatorId: 'a',
        resonatorName: 'A',
        summary: { total: { normal: 992_020, avg: 2_964_486, crit: 3_172_708 } },
      }),
      entry({
        id: 'pack-b',
        name: 'Pack B',
        resonatorId: 'b',
        resonatorName: 'B',
        summary: { total: { normal: 900_000, avg: 2_781_447, crit: 3_000_000 } },
      }),
      entry({
        id: 'outlier',
        name: 'Outlier',
        resonatorId: 'c',
        resonatorName: 'C',
        summary: { total: { normal: 8_000_000, avg: 10_275_299, crit: 11_000_000 } },
      }),
    ], defaultSavedPrefs())

    const full = makeSavedAxis(rows)
    const picked = rows.find((row) => row.id === 'pack-a')!
    const win = savedAxisWindow(rows, picked, full)

    /* the outlier is far past the picked entry's own spread, so it stays off
       the window instead of dragging the ceiling out to meet it */
    expect(win.hi).toBeLessThan(4_000_000)
    expect(win.lo).toBe(0)
    expect(win.at(0)).toBe(0)
    expect(win.at(10_275_299)).toBeGreaterThan(1)
    /* and the window is a real zoom rather than the full range again */
    expect(win.hi - win.lo).toBeLessThan((full.hi - full.lo) * 0.5)
    expect(win.at(picked.avg)).toBeGreaterThan(0.5)
  })

  it('never zooms two identical takes into nothing', () => {
    const rows = makeSavedEntries([
      entry({
        id: 'one',
        name: 'One',
        resonatorId: 'a',
        resonatorName: 'A',
        summary: { total: { normal: 500_000, avg: 500_000, crit: 500_000 } },
      }),
      entry({
        id: 'two',
        name: 'Two',
        resonatorId: 'b',
        resonatorName: 'B',
        summary: { total: { normal: 500_000, avg: 500_000, crit: 500_000 } },
      }),
    ], defaultSavedPrefs())

    const full = makeSavedAxis(rows)
    const win = savedAxisWindow(rows, rows[0]!, full)

    expect(win.hi - win.lo).toBeGreaterThanOrEqual((full.hi - full.lo) * 0.08 - 1)
    expect(Number.isFinite(win.at(500_000))).toBe(true)
  })

  it('groups by the active resonator and orders sections by their own best', () => {
    const prefs = defaultSavedPrefs()
    const rows = makeSavedEntries([
      entry({
        id: 'a-weak',
        name: 'A weak',
        resonatorId: 'a',
        resonatorName: 'A',
        updatedAt: 1,
        summary: { total: { normal: 1, avg: 100, crit: 120 } },
      }),
      entry({
        id: 'b-best',
        name: 'B best',
        resonatorId: 'b',
        resonatorName: 'B',
        updatedAt: 2,
        summary: { total: { normal: 1, avg: 400, crit: 500 } },
      }),
      entry({
        id: 'a-strong',
        name: 'A strong',
        resonatorId: 'a',
        resonatorName: 'A',
        updatedAt: 3,
        summary: { total: { normal: 1, avg: 300, crit: 350 } },
      }),
    ], prefs)

    const groups = groupSavedEntries(rows)
    expect(groups.map((group) => group.lead.id)).toEqual(['b', 'a'])
    expect(groups[1]?.takes.map((take) => take.id)).toEqual(['a-strong', 'a-weak'])
  })

  it('keeps simulated rotations only and sorts with the shared preferences', () => {
    const entries = [
      entry({
        id: 'older',
        name: 'Older take',
        resonatorId: 'a',
        resonatorName: 'A',
        updatedAt: 10,
        summary: { total: { normal: 1, avg: 200, crit: 250 } },
      }),
      entry({
        id: 'recent',
        name: 'Recent take',
        resonatorId: 'b',
        resonatorName: 'B',
        updatedAt: 20,
        summary: { total: { normal: 1, avg: 50, crit: 80 } },
      }),
    ]

    expect(makeSavedEntries(entries, defaultSavedPrefs()).map((row) => row.id))
      .toEqual(['recent', 'older'])

    expect(makeSavedEntries(entries, {
      ...defaultSavedPrefs(),
      sortBy: 'avg',
      sortOrder: 'desc',
    }).map((row) => row.id)).toEqual(['older', 'recent'])
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

  it('filters by members that actually contributed damage', () => {
    const rotations = [
      entry({
        id: 'solo',
        name: 'Solo',
        resonatorId: 'a',
        summary: {
          total: { normal: 0, avg: 100, crit: 0 },
          members: [
            { id: 'a', name: 'A', contribution: { normal: 0, avg: 100, crit: 0 } },
            { id: 'b', name: 'B', contribution: { normal: 0, avg: 0, crit: 0 } },
          ],
        },
      }),
      entry({
        id: 'duo',
        name: 'Duo',
        resonatorId: 'a',
        summary: {
          total: { normal: 0, avg: 100, crit: 0 },
          members: [
            { id: 'a', name: 'A', contribution: { normal: 0, avg: 60, crit: 0 } },
            { id: 'b', name: 'B', contribution: { normal: 0, avg: 40, crit: 0 } },
          ],
        },
      }),
    ]

    expect(makeSavedEntries(rotations, {
      ...defaultSavedPrefs(),
      contributionFilter: 'solo',
    }).map((row) => row.id)).toEqual(['solo'])
    expect(makeSavedEntries(rotations, {
      ...defaultSavedPrefs(),
      contributionFilter: 'duo',
    }).map((row) => row.id)).toEqual(['duo'])
  })

  it('numbers the archive by what is in it and gives the live take the rank it would take', () => {
    const rows = makeSavedEntries([
      entry({
        id: 'best',
        name: 'Best',
        resonatorId: 'a',
        summary: { total: { normal: 0, avg: 300, crit: 300 } },
      }),
      entry({
        id: 'live-rotation:a',
        name: 'Live',
        resonatorId: 'a',
        summary: { total: { normal: 0, avg: 200, crit: 200 } },
      }),
      entry({
        id: 'worst',
        name: 'Worst',
        resonatorId: 'a',
        summary: { total: { normal: 0, avg: 100, crit: 100 } },
      }),
    ], { ...defaultSavedPrefs(), sortBy: 'avg', sortOrder: 'desc' })

    expect(rows.map((row) => [row.id, row.live])).toEqual([
      ['best', false],
      ['live-rotation:a', true],
      ['worst', false],
    ])

    const ranks = rankSavedEntries(rows)
    /* the live take prints the rank it would take, and the take under it keeps
       the rank it already has rather than being pushed down by a preview */
    expect(ranks.get('best')).toBe(1)
    expect(ranks.get('live-rotation:a')).toBe(2)
    expect(ranks.get('worst')).toBe(2)
  })

  it('places a bank by the work kept in it, not by the live take standing in it', () => {
    const rows = makeSavedEntries([
      entry({
        id: 'live-rotation:a',
        name: 'Live',
        resonatorId: 'a',
        summary: { total: { normal: 0, avg: 500, crit: 500 } },
      }),
      entry({
        id: 'kept-a',
        name: 'Kept A',
        resonatorId: 'a',
        summary: { total: { normal: 0, avg: 100, crit: 100 } },
      }),
      entry({
        id: 'kept-b',
        name: 'Kept B',
        resonatorId: 'b',
        summary: { total: { normal: 0, avg: 300, crit: 300 } },
      }),
    ], { ...defaultSavedPrefs(), sortBy: 'avg', sortOrder: 'desc' })

    const groups = groupSavedEntries(rows)

    /* b's bank holds better saved work than a's, so it leads, even though a's
       bank is the one the unsaved 500 is standing in */
    expect(groups.map((group) => group.lead.id)).toEqual(['b', 'a'])
    expect(groups.find((group) => group.lead.id === 'a')?.best).toBe(100)
  })

  it('filters the live take with the rest of the archive', () => {
    const rotations = [
      entry({
        id: 'live-rotation:a',
        name: 'Carlotta Live Rotation',
        resonatorId: 'a',
        resonatorName: 'Carlotta',
        summary: { total: { normal: 0, avg: 200, crit: 200 } },
      }),
      entry({
        id: 'kept',
        name: 'Jinhsi Concerto',
        resonatorId: 'b',
        resonatorName: 'Jinhsi',
        summary: { total: { normal: 0, avg: 100, crit: 100 } },
      }),
    ]

    expect(makeSavedEntries(rotations, defaultSavedPrefs(), 'jinhsi').map((row) => row.id))
      .toEqual(['kept'])
    expect(makeSavedEntries(rotations, defaultSavedPrefs(), 'carlotta').map((row) => row.id))
      .toEqual(['live-rotation:a'])
  })
})
