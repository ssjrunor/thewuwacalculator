/*
  Author: Runor Ewhro
  description: preserves the scored team input across the leaderboard API and card adapter.
*/

import { describe, expect, it } from 'vitest'
import type { BuildDetailResponse, ScenarioCell } from '@/domain/leaderboard/api'
import type { ScenarioInput } from '@/domain/leaderboard/scenarioInput'
import { makeEnemy } from '@/engine/runtime/defaults'
import { CardBuildError, cardInput } from '../cardBuild'

function fixture() {
  const echoes = [{ uid: 'stored-echo', id: '6000199', set: 30, mainEcho: true,
    mainStats: { primary: { key: 'critDmg', value: 44 }, secondary: { key: 'atkFlat', value: 150 } },
    substats: { critRate: 6.3, energyRegen: 12.4 } }]
  const input: ScenarioInput = { v: 1, scenarioId: 'ruleset:1108:t197:21020086', teamId: 't197', scoredSlot: 2,
    enemy: makeEnemy(), members: [
      { slot: 0, resonatorId: '1110', role: 'teammate', mode: null, sequence: 4,
        weapon: { id: '21050096', rank: 2 }, echoes: structuredClone(echoes) },
      { slot: 1, resonatorId: '1109', role: 'teammate', mode: 'glacio_chafe', sequence: 2,
        weapon: { id: '21050086', rank: 5 }, echoes: structuredClone(echoes) },
      { slot: 2, resonatorId: '1108', role: 'scored', mode: null, sequence: 6,
        weapon: { id: '21020086', rank: 3 }, echoes: structuredClone(echoes) },
    ] }
  const cell: ScenarioCell = { scenario: { id: input.scenarioId, resonatorId: '1108', teamKey: '1108-1109-1110', teamRank: 1,
    members: ['1108', '1109', '1110'], weaponId: '21020086', weaponRole: 'signature' }, status: 'ok',
    reason: null, score: 134.93, damage: 10_000_000, dpr: null, rank: 1, total: 1 }
  const detail: BuildDetailResponse = { rulesetId: 'ruleset', buildId: 'build', uid: null, name: null,
    scoringStatus: 'scored', submittedAt: 1, drawnAt: 1, stats: null, best: cell, cells: [cell], scoredInput: input,
    notes: null, card: null,
    snapshot: { v: 1, gameVer: 'test', uid: '', name: null, resonator: { id: '1108', level: 1, sequence: 6, skillLevels: {} },
      weapon: { id: '21020086', level: 1 }, echoes: [] } }
  return { detail, cell, input }
}

describe('leaderboard card input', () => {
  it('keeps authored seats, teammate gear, sequences, modes and the scored weapon rank exactly as served', () => {
    const { detail, cell, input } = fixture()
    expect(cardInput(detail, cell)).toEqual(input)
  })

  it('does not mutate the API response when the card runtime is built', () => {
    const { detail, cell, input } = fixture()
    const result = cardInput(detail, cell)
    result.members[0].weapon.rank = 1
    result.members[1].echoes[0]!.substats.energyRegen = 0
    expect(input.members[0].weapon.rank).toBe(2)
    expect(input.members[1].echoes[0]!.substats.energyRegen).toBe(12.4)
  })

  it('refuses missing or mismatched stored context instead of fabricating a team', () => {
    const { detail, cell } = fixture()
    expect(() => cardInput({ ...detail, scoredInput: null }, cell)).toThrow(CardBuildError)
    expect(() => cardInput(detail, { ...cell, scenario: { ...cell.scenario, id: 'another-scenario' } })).toThrow(CardBuildError)
    expect(() => cardInput({ ...detail, scoredInput: { ...detail.scoredInput!, scoredSlot: 0 } }, cell)).toThrow(CardBuildError)
  })
})
